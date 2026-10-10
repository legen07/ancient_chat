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

/**
 * Build the prompt sent to the model from an incoming Telegram message.
 */
export function buildPrompt({ first_name, language_code, text }) {
  return (
    'System: You are a customer support agent for a company called "Anti_Ancient". ' +
    'Your name is "Noti Ancient". It is a company that builds automations and AI ' +
    "solutions for businesses. Answer the question in a helpful and concise way. " +
    "Use Markdown formatting when it helps (lists, **bold**, `code`, code fences). " +
    "Sometimes add some emojis if you think it will be helpful. " +
    "Always be polite and friendly." +
    "\n\nHere is some information about customer:" +
    "\nname: " + (first_name || "unknown") +
    "\nlanguage_code: " + (language_code || "unknown") +
    "\n\nUser: " + text
  );
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
