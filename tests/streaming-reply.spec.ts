import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { answerMessage, stopGeneration } from "../src/lib/answer.js";
import { streamTokens } from "../src/lib/ai.js";
import { finalRichMarkdown, partialRichMarkdown, plainText } from "../src/lib/rich.js";

const encoder = new TextEncoder();

/** Build an SSE ReadableStream that emits `data: {"response":"..."}` frames. */
function sseStream(tokens, { gate }: { gate?: Promise<void> } = {}) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const token of tokens) {
        if (gate) await gate;
        controller.enqueue(encoder.encode(`data: {"response":${JSON.stringify(token)}}\n\n`));
      }
      controller.close();
    },
  });
}

/** Stub the Telegram Bot API and record every call. */
function stubTelegram(overrides: Record<string, () => Response> = {}) {
  const calls: { method: string; body: any }[] = [];
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    const url = String(typeof input === "string" ? input : input.url);
    const method = url.slice(url.lastIndexOf("/") + 1);
    calls.push({ method, body: init.body ? JSON.parse(init.body) : null });

    // A fresh Response per call: bodies are single-use.
    if (overrides[method]) return overrides[method]();
    return json({ ok: true, result: true });
  });
  return calls;
}

/** Run the worker with a waitUntil-collecting context and wait for the background task. */
async function runWorker(env: any, body: unknown) {
  let pending: Promise<unknown> | undefined;
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending = p; } };
  const res = await worker.fetch(
    new Request("http://example.com/api/webhook/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  );
  await pending;
  return res;
}

const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  stubTelegram();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Workers AI SSE parsing", () => {
  it("yields every token from the event stream", async () => {
    const tokens: string[] = [];
    for await (const token of streamTokens(sseStream(["Hel", "lo ", "wor", "ld"]))) {
      tokens.push(token);
    }
    expect(tokens.join("")).toBe("Hello world");
  });

  it("reassembles frames split across chunks and skips junk frames", async () => {
    const frame = 'data: {"response":"tok"}\n\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frame.slice(0, 12)));
        controller.enqueue(encoder.encode(frame.slice(12) + "data: [DONE]\n\n" + "data: not-json\n\n"));
        controller.close();
      },
    });

    const tokens: string[] = [];
    for await (const token of streamTokens(stream)) tokens.push(token);
    expect(tokens).toEqual(["tok"]);
  });

  it("stops reading when the signal is aborted", async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(encoder.encode(`data: {"response":"t${pulls}"}\n\n`));
      },
    });

    const signal = { aborted: false };
    const tokens: string[] = [];
    for await (const token of streamTokens(stream, { signal })) {
      tokens.push(token);
      if (tokens.length === 2) signal.aborted = true;
    }

    expect(tokens).toEqual(["t1", "t2"]);
  });
});

describe("Rich Markdown stabilisation", () => {
  it("closes a code fence that is still open in a live preview", () => {
    const draft = partialRichMarkdown("Here:\n```python\nprint('hi'");
    expect(draft.markdown.endsWith("\n```")).toBe(true);
  });

  it("keeps completed formatting intact", () => {
    const text = "**Bold** and a `code` span";
    expect(partialRichMarkdown(text).markdown).toBe(text);
  });

  it("drops a marker that is still open mid-stream", () => {
    expect(partialRichMarkdown("this is **bo").markdown).toBe("this is bo");
    expect(partialRichMarkdown("back `tick").markdown).toBe("back tick");
  });

  it("closes open fences in the final reply too", () => {
    expect(finalRichMarkdown("```\ncode").markdown).toBe("```\ncode\n```");
  });

  it("truncates plain text to the message limit", () => {
    expect(plainText("x".repeat(5000)).length).toBe(4096);
    expect(plainText("short")).toBe("short");
  });
});

describe("webhook: streamed private-chat reply", () => {
  it("streams draft updates and persists the reply as a Rich Message", async () => {
    const calls = stubTelegram();
    const env = {
      API_KEY: "123:test-token",
      AI: { run: vi.fn(async () => sseStream(["**Hi**", " there ", "friend"])) },
    };

    const res = await runWorker(env, {
      message: {
        message_id: 42,
        chat: { id: 777, type: "private" },
        from: { id: 777, first_name: "Ada", language_code: "en" },
        text: "Hello!",
      },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");

    // The model is called with the requested model and streaming enabled.
    expect(env.AI.run).toHaveBeenCalledWith(
      "@cf/meta/llama-3.2-1b-instruct",
      expect.objectContaining({ stream: true, prompt: expect.stringContaining("Hello!") }),
    );

    const drafts = calls.filter((c) => c.method === "sendRichMessageDraft");
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    // First draft is the "Thinking…" placeholder; the last carries the text.
    expect(drafts[0].body.rich_message.markdown).toContain("<tg-thinking>");
    const last = drafts[drafts.length - 1].body;
    expect(last.chat_id).toBe(777);
    expect(last.draft_id).toBe(42);
    expect(last.can_stop).toBe(true);
    expect(last.rich_message.markdown).toContain("**Hi**");

    // The finished reply is persisted with Rich Markdown (not the ephemeral draft).
    const final = calls.find((c) => c.method === "sendRichMessage");
    expect(final?.body.chat_id).toBe(777);
    expect(final?.body.rich_message.markdown).toBe("**Hi** there friend");
  });

  it("pushes drafts as the reply grows", async () => {
    const calls = stubTelegram();
    const env = {
      API_KEY: "123:test-token",
      AI: {
        run: vi.fn(async () => {
          let i = 0;
          return new ReadableStream<Uint8Array>({
            async pull(controller) {
              if (i >= 3) return controller.close();
              await new Promise((r) => setTimeout(r, 5));
              controller.enqueue(encoder.encode(`data: {"response":"part${i++} "}\n\n`));
            },
          });
        }),
      },
    };

    await answerMessage({
      env,
      chat: { id: 5, type: "private" },
      draftId: 9,
      from: { first_name: "Bo" },
      text: "hi",
      draftIntervalMs: 0,
    });

    const drafts = calls.filter((c) => c.method === "sendRichMessageDraft");
    // Placeholder + one growing draft per token.
    expect(drafts.length).toBe(4);
    expect(drafts[3].body.rich_message.markdown).toBe("part0 part1 part2 ");
  });

  it("falls back to a plain draft when Telegram rejects the partial markdown", async () => {
    const calls = stubTelegram({
      sendRichMessageDraft: () =>
        json({
          ok: false,
          description: "Bad Request: can't parse entities",
        }),
    });
    const env = {
      API_KEY: "123:test-token",
      AI: { run: vi.fn(async () => sseStream(["plain reply"])) },
    };

    await answerMessage({
      env,
      chat: { id: 7, type: "private" },
      draftId: 3,
      from: {},
      text: "hi",
    });

    const plain = calls.filter((c) => c.method === "sendMessageDraft");
    expect(plain.length).toBeGreaterThanOrEqual(1);
    expect(plain[plain.length - 1].body.text).toContain("plain reply");
  });

  it("falls back to plain sendMessage when the final rich message is rejected", async () => {
    const calls = stubTelegram({
      sendRichMessage: () =>
        json({
          ok: false,
          description: "Bad Request: can't parse entities: unclosed node",
        }),
    });
    const env = {
      API_KEY: "123:test-token",
      AI: { run: vi.fn(async () => sseStream(["final answer"])) },
    };

    await answerMessage({
      env,
      chat: { id: 11, type: "private" },
      draftId: 4,
      from: {},
      text: "hi",
    });

    const plain = calls.find((c) => c.method === "sendMessage");
    expect(plain?.body.chat_id).toBe(11);
    expect(plain?.body.text).toBe("final answer");
    // The fallback must not re-parse markdown.
    expect(plain?.body.parse_mode).toBeUndefined();
  });

  it("reports an error message when the model produced nothing", async () => {
    const calls = stubTelegram();
    const env = {
      API_KEY: "123:test-token",
      AI: {
        run: vi.fn(async () => {
          throw new Error("model unavailable");
        }),
      },
    };

    await answerMessage({
      env,
      chat: { id: 13, type: "private" },
      draftId: 6,
      from: {},
      text: "hi",
    });

    const plain = calls.find((c) => c.method === "sendMessage");
    expect(plain?.body.text).toContain("could not generate");
  });
});

describe("webhook: group chats", () => {
  it("skips private-only drafts and sends the final Rich Message", async () => {
    const calls = stubTelegram();
    const env = {
      API_KEY: "123:test-token",
      AI: { run: vi.fn(async () => sseStream(["group answer"])) },
    };

    await runWorker(env, {
      message: {
        message_id: 5,
        chat: { id: -100, type: "supergroup" },
        from: { id: 1, first_name: "Cy" },
        text: "question",
      },
    });

    expect(calls.some((c) => c.method === "sendRichMessageDraft")).toBe(false);
    expect(calls.some((c) => c.method === "sendMessageDraft")).toBe(false);

    const final = calls.find((c) => c.method === "sendRichMessage");
    expect(final?.body.chat_id).toBe(-100);
    expect(final?.body.rich_message.markdown).toBe("group answer");
  });
});

describe("webhook: Stop button", () => {
  it("cancels an in-flight generation and keeps the draft ephemeral", async () => {
    const calls = stubTelegram();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const env = {
      API_KEY: "123:test-token",
      AI: { run: vi.fn(async () => sseStream(["never shown"], { gate })) },
    };

    let pending!: Promise<unknown>;
    const ctx = { waitUntil: (p: Promise<unknown>) => { pending = p; } };
    await worker.fetch(
      new Request("http://example.com/api/webhook/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            message_id: 77,
            chat: { id: 88, type: "private" },
            from: { id: 88 },
            text: "stop me",
          },
        }),
      }),
      env,
      ctx,
    );

    // The user presses Stop — a separate webhook update on another request.
    const stopRes = await worker.fetch(
      new Request("http://example.com/api/webhook/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stopped_message_generation: { chat: { id: 88 }, draft_id: 77 },
        }),
      }),
      env,
      ctx,
    );
    expect(stopRes.status).toBe(200);

    release();
    await pending;

    // Nothing is persisted after a stop.
    expect(calls.some((c) => c.method === "sendRichMessage")).toBe(false);
    expect(calls.some((c) => c.method === "sendMessage")).toBe(false);
  });

  it("ignores a stop for a draft that is not running here", () => {
    expect(stopGeneration(1, 2)).toBe(false);
  });
});
