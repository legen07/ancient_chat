/**
 * Workers AI streaming helpers.
 *
 * `env.AI.run(model, { stream: true })` returns a ReadableStream of
 * server-sent events where every `data:` frame is a JSON object carrying
 * one incremental token, e.g. `data: {"response":"Hello"}`.
 *
 * Docs: https://developers.cloudflare.com/workers-ai/models/llama-3.2-1b-instruct/
 */

/** Model used for the streamed customer-support replies. */
export const AI_MODEL = "@cf/meta/llama-3.2-1b-instruct";

/** Generation defaults (values are bounded by the model's input schema). */
export const GENERATION = {
  max_tokens: 1024,
  temperature: 0.4,
  top_p: 0.9,
};

/** Default identity when env does not say otherwise (spec §1). */
export const DEFAULT_BOT_NAME = "Noti";
export const DEFAULT_OWNER_NAME = "the boss";

/**
 * Dynamic prompt builder (spec §9).
 *
 * Modes:
 *   - "secretary": customer chat → must open with `VERDICT: GENERAL|PERSONAL`,
 *     answer only when GENERAL.
 *   - "welcome":   first-time customer → greet and answer in one go, no verdict.
 *   - "direct":    the owner talking to the bot → plain assistant, no verdict.
 *
 * Voice: warm Ghanaian English with light pidgin; mirror the customer's
 * language. Memory transcript: last messages labelled them/you.
 */
export function buildPrompt({
  mode = "secretary",
  botName = DEFAULT_BOT_NAME,
  ownerName = DEFAULT_OWNER_NAME,
  customer = {},
  memory = [],
  text,
  saved = true,
}) {
  const persona =
    "System: You are " + botName + ", the personal Telegram assistant of " + ownerName + ". " +
    "You speak inside " + ownerName + "'s own chats with his customers. " +
    "Be friendly, warm and human — like a young Ghanaian guy: natural Ghanaian English " +
    "with light pidgin where it fits naturally (e.g. \"no wahala\", \"I go check\", \"soon come\"). " +
    "Mirror the customer's language: if they write pure English, stay English; French stays French; " +
    "Twi/pidgin is welcome. Use Markdown when it helps (lists, **bold**, `code`). " +
    "Add a friendly emoji only when it fits.";

  const boundaries =
    "Rules: Never invent prices, promises, bookings, dates or commitments " + ownerName +
    " has not made. If you are not sure, or the matter needs " + ownerName + "'s own " +
    "knowledge or decision (money, complaints, personal requests, \"is he around?\"), " +
    "it is PERSONAL.";

  const transcript =
    memory && memory.length
      ? "Recent messages in this chat:\n" +
        memory
          .map((entry) => (entry.role === "them" ? "them: " : "you (boss's reply): ") + entry.text)
          .join("\n")
      : "";

  const facts =
    "\n\nCustomer:\n" +
    "name: " + (customer.first_name || "unknown") + "\n" +
    "language_code: " + (customer.language_code || "unknown") + "\n" +
    "known_contact: " + (saved ? "yes" : "no (first time)") + "\n" +
    "today: " + new Date().toISOString().slice(0, 10);

  const message = "\n\nMessage:\n" + text;

  if (mode === "direct") {
    return (
      persona +
      "\nYou are talking to " + ownerName + " himself right now — answer him directly " +
      "and helpfully, no assistant theatrics." +
      (transcript ? "\n\n" + transcript : "") +
      message
    );
  }

  const contract =
    mode === "welcome"
      ? "This customer is messaging for the very first time: greet them warmly as " +
        ownerName + "'s assistant, ask how you can help, and ALSO answer the question " +
        "they just asked — all in one reply. Do NOT start with any VERDICT line."
      : mode === "plain"
        ? "Answer the customer's message helpfully and briefly. Do NOT start with any " +
          "VERDICT line."
        : "The first line of your reply MUST be exactly one of:\n" +
          "VERDICT: GENERAL\n" +
          "VERDICT: PERSONAL\n" +
          "GENERAL = a normal question you can answer from the message, the transcript " +
          "above, or common knowledge. PERSONAL = needs " + ownerName + " himself.";

  return (
    persona + "\n" + boundaries + "\n" + contract + (transcript ? "\n\n" + transcript : "") + facts + message
  );
}

/**
 * Split a model reply into its verdict and answer (secretary mode).
 * A missing/invalid verdict line is treated as PERSONAL — the safe default:
 * never blunder a commitment as the owner (spec §9).
 */
export function parseVerdict(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/^VERDICT:\s*(GENERAL|PERSONAL)\b[ \t]*\r?\n?/i);

  if (!match) return { verdict: "PERSONAL", answer: text };

  return {
    verdict: match[1].toUpperCase(),
    answer: text.slice(match[0].length).trim(),
  };
}

/**
 * Run a completion to the end and return the full text (secretary mode has
 * no streaming drafts — see spec §0).
 */
export async function collectCompletion(env, prompt, parameters = {}, options = {}) {
  let full = "";
  for await (const token of streamCompletion(env, prompt, parameters, options)) {
    full += token;
  }
  return full;
}

/**
 * Consume a Workers AI SSE stream and yield every generated token.
 *
 * @param {ReadableStream|Response} readable  Result of env.AI.run(..., { stream: true })
 * @param {{ signal?: { aborted: boolean } }} [options]
 */
export async function* streamTokens(readable, options = {}) {
  const { signal } = options;
  const body = readable && typeof readable.getReader === "function" ? readable : readable && readable.body;

  if (!body || typeof body.getReader !== "function") {
    throw new Error("Workers AI did not return a readable stream");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      // Cancelled mid-read (e.g. the user pressed Stop on the draft):
      // release the upstream generation instead of leaving it unread.
      if (signal && signal.aborted) {
        try {
          await reader.cancel();
        } catch {
          // Already closed.
        }
        return;
      }

      if (done) break;

      buffer += typeof value === "string" ? value : decoder.decode(value, { stream: true });

      // Drain every complete SSE line in the buffer; keep the (possibly
      // partial) tail for the next chunk.
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue; // tolerate keep-alive/comment frames
        }

        const token =
          event && (event.response ?? event.text ?? (event.result && event.result.response));
        if (typeof token === "string" && token.length > 0) yield token;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream may already be closed or cancelled.
    }
  }
}

/**
 * Start a streamed completion and yield its tokens as they are generated.
 *
 * @param {{ AI: { run: (model: string, payload: object) => Promise<any> } }} env
 * @param {string} prompt
 * @param {{ max_tokens?: number, temperature?: number, top_p?: number }} [parameters]
 * @param {{ signal?: { aborted: boolean } }} [options]
 */
export async function* streamCompletion(env, prompt, parameters = {}, options = {}) {
  const stream = await env.AI.run(AI_MODEL, {
    prompt,
    stream: true,
    max_tokens: parameters.max_tokens ?? GENERATION.max_tokens,
    temperature: parameters.temperature ?? GENERATION.temperature,
    top_p: parameters.top_p ?? GENERATION.top_p,
  });

  yield* streamTokens(stream, options);
}
