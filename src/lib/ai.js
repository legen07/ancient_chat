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
    (mode === "direct"
      ? ""
      : "You speak inside " + ownerName + "'s own chats with his customers. ") +
    "Be friendly, warm and human — like a young Ghanaian guy: natural Ghanaian English " +
    "with light pidgin where it fits naturally (e.g. \"no wahala\", \"I go check\", \"soon come\"). " +
    "Mirror the customer's language: if they write pure English, stay English; French stays French; " +
    "Twi/pidgin is welcome. Use Markdown when it helps (lists, **bold**, `code`). " +
    "Add a friendly emoji only when it fits.";

  // Output shape (spec §9): ONE message, ONE voice. A 1B model shown a
  // labelled transcript happily continues it as a two-hand "Boss: / You:"
  // script — and that script then gets stored as memory, so the next reply
  // doubles down. Say it plainly: speak only as yourself, no speaker labels.
  const format =
    "Format: reply as a single message spoken only by you. " +
    "NEVER write a two-sided script or dialogue, and never label lines with " +
    "\"Boss:\", \"You:\", \"Me:\", \"Customer:\" or any name followed by a colon — " +
    "you do not speak for " + ownerName + " or the customer, only for yourself. " +
    "Ignore any speaker labels you see in the CONVERSATION CONTEXT above; " +
    "they are just how earlier messages were logged, not a script to continue.";

  const boundaries =
    "Rules: Never invent prices, promises, bookings, dates or commitments " + ownerName +
    " has not made. If you are not sure, or the matter needs " + ownerName + "'s own " +
    "knowledge or decision (money, complaints, personal requests, \"is he around?\"), " +
    "it is PERSONAL.";

  const transcriptLabel = (entry) =>
    mode === "direct"
      ? (entry.role === "them" ? "you: " : "me: ")
      : (entry.role === "them" ? "them: " : "you (boss's reply): ");

  // Earlier messages in the chat, deliberately separated from the message
  // being answered now. The model must treat them as *context* — something
  // to understand what is going on — never as the current question. That one
  // is labelled ACTIVE MESSAGE below. Past assistant replies are re-sanitised
  // on the way out: replies stored before the no-script rule existed may
  // contain hallucinated "Boss:/You:" scripts that the model would imitate.
  const transcript =
    memory && memory.length
      ? "\n\nCONVERSATION CONTEXT (earlier messages in this chat — read these to " +
        "understand what is going on; do not repeat them word for word):\n" +
        memory
          .map((entry) =>
            "- " +
            transcriptLabel(entry) +
            (entry.role === "them"
              ? entry.text
              : stripSpeakerLabels(entry.text, { botName, ownerName }))
          )
          .join("\n")
      : "";

  const facts =
    "\n\nCustomer:\n" +
    "name: " + (customer.first_name || "unknown") + "\n" +
    "language_code: " + (customer.language_code || "unknown") + "\n" +
    "known_contact: " + (saved ? "yes" : "no (first time)") + "\n" +
    "today: " + new Date().toISOString().slice(0, 10);

  const message = "\n\nACTIVE MESSAGE (the one to answer now):\n" + text;

  if (mode === "direct") {
    return (
      persona +
      "\n" + format +
      "\nYou are talking to " + ownerName + " himself right now — answer him directly " +
      "and helpfully, no assistant theatrics." +
      transcript +
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
    persona + "\n" + format + "\n" + boundaries + "\n" + contract + transcript + facts + message
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
 * Remove hallucinated dialogue scripts from a model reply.
 *
 * The 1B model sometimes answers with a two-hand script ("Boss: … / You: …"),
 * inventing lines the owner never sent. The bot must speak with ONE voice:
 * turns attributed to anyone else are dropped, and speaker labels are stripped.
 * A reply without such labels is returned unchanged.
 */
export function stripSpeakerLabels(text, { botName = DEFAULT_BOT_NAME, ownerName = DEFAULT_OWNER_NAME } = {}) {
  const raw = String(text || "");
  if (!raw.trim()) return raw;

  const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = (list) =>
    list.filter((n) => n && String(n).trim()).map((n) => escapeRegex(String(n).trim())).join("|");

  // "You"/"Me"/the bot's name = the assistant's own turns; "Boss"/the owner's
  // name/customer words = lines the model fabricated for other people.
  const assistantRe = new RegExp("^\\s*(" + names(["you", "me", botName]) + ")\\s*:\\s*", "i");
  const otherRe = new RegExp(
    "^\\s*(" + names(["boss", "owner", "customer", "client", "user", "them", ownerName]) + ")\\s*:\\s*",
    "i",
  );
  const anyLabelRe = new RegExp(
    "^\\s*(" + names(["you", "me", botName, "boss", "owner", "customer", "client", "user", "them", ownerName]) + ")\\s*:\\s*",
    "i",
  );

  const lines = raw.split("\n");
  const turns = [];
  let current = { who: "preamble", lines: [] };

  for (const line of lines) {
    if (anyLabelRe.test(line)) {
      if (current.lines.join("").trim() || current.who !== "preamble") turns.push(current);
      current = {
        who: assistantRe.test(line) ? "assistant" : "other",
        lines: [line.replace(anyLabelRe, "")],
      };
    } else {
      current.lines.push(line);
    }
  }
  turns.push(current);

  const labelled = turns.filter((t) => t.who !== "preamble");

  // Not a script (≤1 labelled line): just drop that one label.
  if (labelled.length < 2) {
    return lines.map((l) => l.replace(anyLabelRe, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim() || raw.trim();
  }

  // A script: keep only the assistant's own turns. If none were labelled as
  // the assistant, keep everything (labels stripped) rather than swallow the reply.
  const kept = turns.filter((t) => t.who === "assistant");
  const body = (kept.length ? kept : turns)
    .map((t) => t.lines.join("\n"))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return body || raw.trim();
}

/**
 * Run a completion to the end and return the full text (secretary mode has
 * no streaming drafts — see spec §0). Speaker labels/scripts are stripped
 * before the text reaches the caller.
 */
export async function collectCompletion(env, prompt, parameters = {}, options = {}) {
  let full = "";
  for await (const token of streamCompletion(env, prompt, parameters, options)) {
    full += token;
  }
  return stripSpeakerLabels(full, {
    botName: (env && env.BOT_NAME) || DEFAULT_BOT_NAME,
    ownerName: (env && env.OWNER_NAME) || DEFAULT_OWNER_NAME,
  });
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
