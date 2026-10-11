import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { resetIntakeState } from "../src/lib/secretary.js";

// ---------------------------------------------------------------------------
// Stubs (same pattern as streaming-reply.spec.ts: fresh Response per call)
// ---------------------------------------------------------------------------

const calls: Array<{ method: string; body: any }> = [];

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
  });
}

function sseStream(tokens: string[]) {
  return new Response(
    tokens.map((token) => `data: ${JSON.stringify({ response: token })}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

interface StubOptions {
  aiTokens?: string[];
  /** Simulate a business account that cannot send rich messages. */
  richFails?: boolean;
  /** BusinessConnection object returned by getBusinessConnection. */
  connection?: Record<string, unknown> | null;
}

function stubTelegram({ aiTokens = ["ok"], richFails = false, connection = null }: StubOptions = {}) {
  calls.length = 0;

  globalThis.fetch = vi.fn(async (input: Request | string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (!url.includes("api.telegram.org")) {
      return jsonResponse({ ok: false, description: "unexpected host: " + url });
    }

    const matched = url.match(/\/bot[^/]+\/(\w+)$/);
    const method2 = matched ? matched[1] : "unknown";
    calls.push({ method: method2, body });

    // Rich sends return a real message so the follow-up button edit has an id.
    if (method2 === "sendRichMessage" && richFails) {
      return jsonResponse({
        ok: false,
        error_code: 400,
        description: "Bad Request: RICH_MESSAGE_UNSUPPORTED",
      });
    }
    if (method2 === "sendRichMessage") {
      return jsonResponse({ ok: true, result: { message_id: 111 } });
    }

    if (method2 === "getBusinessConnection") {
      if (!connection) {
        return jsonResponse({
          ok: false,
          error_code: 400,
          description: "Bad Request: business connection not found",
        });
      }
      return jsonResponse({ ok: true, result: connection });
    }

    // Plain sendMessage also returns a real message id (buttons need it).
    if (method2 === "sendMessage") {
      return jsonResponse({ ok: true, result: { message_id: 112 } });
    }

    return jsonResponse({ ok: true, result: true });
  }) as typeof fetch;

  globalThis.AI = {
    run: vi.fn(async () => sseStream(aiTokens)),
  } as any;
}

async function runWorker(update: unknown, env: Record<string, unknown> = {}, queued: any[] = []) {
  const request = new Request("https://bot.example/api/webhook/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof update === "string" ? update : JSON.stringify(update),
  });

  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      queued.push(promise);
    },
    passThroughOnException: () => {},
  };

  const response = await worker.fetch(request, env as any, ctx as any);
  await Promise.allSettled(queued);
  return response;
}

const OWNER_DM = 555;
const CONN = {
  update_id: 1,
  business_connection: {
    id: "BC1",
    user: { id: OWNER_DM, is_bot: false, first_name: "Kwame" },
    user_chat_id: OWNER_DM,
    date: 1700000000,
    rights: { can_reply: true, can_delete_sent_messages: true },
    is_enabled: true,
  },
};

function businessMessage(over: Record<string, unknown> = {}) {
  return {
    update_id: 2,
    business_message: {
      message_id: 1,
      date: 1700000001,
      chat: { id: 9001, type: "private", first_name: "Ama" },
      from: { id: 9001, is_bot: false, first_name: "Ama", language_code: "en" },
      text: "How much be logo design?",
      ...over,
    },
  };
}

const sentRich = () => calls.filter((c) => c.method === "sendRichMessage");
const sentPlain = () => calls.filter((c) => c.method === "sendMessage");
const sentEdits = () => calls.filter((c) => c.method === "editMessageReplyMarkup");
const sentAcks = () => calls.filter((c) => c.method === "answerCallbackQuery");

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  // The dedup LRU is module-level; isolate it between test cases.
  resetIntakeState();
});

// ---------------------------------------------------------------------------
// The spec (docs/chats-specs.md §13)
// ---------------------------------------------------------------------------

describe("secretary intake", () => {
  it("stores the connection, welcomes a first-timer AND answers their question", async () => {
    stubTelegram({ aiTokens: ["We dey do logo design from GH₵ 300 🙌"] });
    const env = { API_KEY: "t", OWNER_NAME: "Kwame", BOT_NAME: "Noti", AI: globalThis.AI };

    await runWorker(CONN, env);
    await runWorker(businessMessage(), env);

    const rich = sentRich();
    expect(rich).toHaveLength(1);
    expect(rich[0].body.business_connection_id).toBe("BC1");
    expect(rich[0].body.chat_id).toBe(9001);
    expect(rich[0].body.reply_parameters).toEqual({ message_id: 1, allow_sending_without_reply: true });
    expect(rich[0].body.rich_message.markdown).toContain("Heyyy"); // welcome
    expect(rich[0].body.rich_message.markdown).toContain("We dey do logo design"); // answer
    expect(rich[0].body.rich_message.markdown).toContain("on behalf of Kwame"); // sign-off

    // Buttons ride on a follow-up edit with the reply's own message id.
    expect(sentEdits()).toHaveLength(1);
    expect(sentEdits()[0].body.business_connection_id).toBe("BC1");
    expect(sentEdits()[0].body.reply_markup.inline_keyboard[0][0].callback_data).toBe(
      "d:9001:111",
    );
    expect(sentEdits()[0].body.reply_markup.inline_keyboard[0][1].callback_data).toBe(
      "h:9001:111",
    );
  });

  it("still attaches the action buttons when the account cannot send rich messages", async () => {
    // Regression: RICH_MESSAGE_UNSUPPORTED → plain-text fallback used to return
    // early, dropping the Delete / Request Human buttons entirely.
    stubTelegram({ aiTokens: ["We dey do logo design from GH₵ 300 🙌"], richFails: true });
    const env = { API_KEY: "t", OWNER_NAME: "Kwame", BOT_NAME: "Noti", AI: globalThis.AI };

    await runWorker(CONN, env);
    await runWorker(businessMessage(), env);

    // Rich failed → the plain fallback carried the reply…
    expect(sentRich()).toHaveLength(1);
    const plain = sentPlain();
    expect(plain).toHaveLength(1);
    expect(plain[0].body.business_connection_id).toBe("BC1");
    expect(plain[0].body.text).toContain("We dey do logo design");
    expect(plain[0].body.text).toContain("on behalf of Kwame");

    // …and the buttons still ride on a follow-up edit of that plain message
    // (id 112 — the plain send's id, not the rejected rich message's).
    const edits = sentEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0].body.business_connection_id).toBe("BC1");
    expect(edits[0].body.message_id).toBe(112);
    expect(edits[0].body.reply_markup.inline_keyboard[0][0].callback_data).toBe("d:9001:112");
  });

  it("recovers a missed business_connection via getBusinessConnection (owner DM + reply)", async () => {
    // Regression: the one-shot connection update can be lost (webhook was on a
    // dead tunnel). The message still carries business_connection_id, so intake
    // must recover the snapshot — otherwise owner alerts are dropped silently.
    stubTelegram({
      aiTokens: ["VERDICT: PERSONAL", "\nHe dey handle am himself."],
      connection: CONN.business_connection,
    });
    // CONTACTS pre-saves chat 9001 so intake takes the verdict path, not welcome.
    const env = {
      API_KEY: "t",
      OWNER_NAME: "Kwame",
      BOT_NAME: "Noti",
      CONTACTS: "9001",
      AI: globalThis.AI,
    };

    // No CONN update — straight to a message carrying the connection id.
    await runWorker(businessMessage({ business_connection_id: "BC1" }), env);

    // The snapshot was pulled from Telegram…
    const lookups = calls.filter((c) => c.method === "getBusinessConnection");
    expect(lookups).toHaveLength(1);
    expect(lookups[0].body.business_connection_id).toBe("BC1");

    // …the customer still got the deflection reply…
    expect(sentRich()).toHaveLength(1);
    expect(sentRich()[0].body.business_connection_id).toBe("BC1");

    // …and the personal-question alert reached the owner's DM (user_chat_id).
    const owner = sentPlain().find((c) => c.body.chat_id === OWNER_DM);
    expect(owner).toBeTruthy();
    expect(owner!.body.text).toContain("Personal question");
  });

  it("uses the last-6 memory as context on the next message (after the cooldown)", async () => {
    stubTelegram({ aiTokens: ["Yes, we dey do that too."] });
    const env = { API_KEY: "t", OWNER_NAME: "Kwame", BOT_NAME: "Noti", AI: globalThis.AI };

    const baseNow = Date.now();
    await runWorker(CONN, env);
    await runWorker(businessMessage(), env);

    // Jump past the reply cooldown, then message the same chat again.
    vi.spyOn(Date, "now").mockReturnValue(baseNow + 5000);
    await runWorker(businessMessage({ message_id: 2, text: "And delivery time?" }), env);

    const aiCall = (globalThis.AI.run as ReturnType<typeof vi.fn>).mock.calls;
    expect(aiCall).toHaveLength(2);
    const secondPrompt = aiCall[1][1].prompt as string;
    expect(secondPrompt).toContain("How much be logo design?"); // their last text
    expect(secondPrompt).toContain("Yes, we dey do that too."); // our last reply
    expect(secondPrompt).toContain("Recent messages in this chat:"); // memory block
  });

  it("answers a pre-saved contact with a PERSONAL verdict: deflection + owner DM", async () => {
    stubTelegram({ aiTokens: ["VERDICT: PERSONAL", "\nHe dey handle am himself."] });
    const env = {
      API_KEY: "t",
      OWNER_NAME: "Kwame",
      BOT_NAME: "Noti",
      CONTACTS: "9002",
      AI: globalThis.AI,
    };

    await runWorker(CONN, env);
    await runWorker(
      businessMessage({
        chat: { id: 9002, type: "private", first_name: "Kofi" },
        from: { id: 9002, is_bot: false, first_name: "Kofi" },
        text: "Charlie, I need to talk to your boss about the money.",
      }),
      env,
    );

    const rich = sentRich();
    expect(rich).toHaveLength(1);
    const markdown = rich[0].body.rich_message.markdown as string;
    expect(markdown).toContain("pass am give am"); // canned deflection
    expect(markdown).not.toContain("He dey handle am himself"); // model verdict not leaked

    // The owner got DM'd the actual question.
    const ownerDm = sentPlain().find((c) => c.body.chat_id === OWNER_DM);
    expect(ownerDm).toBeTruthy();
    expect(ownerDm!.body.text).toContain("money");
    expect(ownerDm!.body.text).toContain("Kofi");
  });

  it("answers a GENERAL verdict with the model's reply (no owner DM)", async () => {
    stubTelegram({ aiTokens: ["VERDICT: GENERAL", "\nYes, we dey do logo design 🙌"] });
    const env = {
      API_KEY: "t",
      OWNER_NAME: "Kwame",
      BOT_NAME: "Noti",
      CONTACTS: "9003",
      AI: globalThis.AI,
    };

    await runWorker(CONN, env);
    await runWorker(
      businessMessage({
        chat: { id: 9003, type: "private", first_name: "Ama" },
        from: { id: 9003, is_bot: false, first_name: "Ama" },
        text: "Do you do logo design?",
      }),
      env,
    );

    const rich = sentRich();
    expect(rich).toHaveLength(1);
    expect(rich[0].body.rich_message.markdown).toContain("we dey do logo design 🙌");
    expect(sentPlain().find((c) => c.body.chat_id === OWNER_DM)).toBeUndefined();
  });

  it("treats a missing/invalid verdict line as PERSONAL (safe default)", async () => {
    stubTelegram({ aiTokens: ["Sure! I go book am for you for Friday."] });
    const env = {
      API_KEY: "t",
      OWNER_NAME: "Kwame",
      BOT_NAME: "Noti",
      CONTACTS: "9004",
      AI: globalThis.AI,
    };

    await runWorker(CONN, env);
    await runWorker(
      businessMessage({
        chat: { id: 9004, type: "private", first_name: "Ama" },
        from: { id: 9004, is_bot: false, first_name: "Ama" },
        text: "Book the appointment for me",
      }),
      env,
    );

    const markdown = sentRich()[0].body.rich_message.markdown as string;
    expect(markdown).toContain("pass am give am");
    expect(markdown).not.toContain("book am for you");
    expect(sentPlain().find((c) => c.body.chat_id === OWNER_DM)).toBeTruthy();
  });

  it("silences blacklisted chats", async () => {
    stubTelegram();
    const env = {
      API_KEY: "t",
      BLACKLIST_CHATS: "9005, @blockedguy",
      AI: globalThis.AI,
    };

    await runWorker(CONN, env);
    await runWorker(
      businessMessage({
        chat: { id: 9005, type: "private" },
        from: { id: 9005, is_bot: false, first_name: "Bad" },
      }),
      env,
    );

    expect(calls.filter((c) => c.method === "sendRichMessage")).toHaveLength(0);
    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
  });

  it("ignores non-whitelisted bot senders and answers whitelisted ones plainly", async () => {
    stubTelegram({ aiTokens: ["VERDICT: PERSONAL", "\nsecret"] });
    const env = {
      API_KEY: "t",
      OWNER_NAME: "Kwame",
      BOT_NAME: "Noti",
      AI: globalThis.AI,
    };

    await runWorker(CONN, env);

    // Not whitelisted → silence.
    await runWorker(
      businessMessage({
        chat: { id: 9006, type: "private" },
        from: { id: 777, is_bot: true, username: "RandomBot", first_name: "Random" },
      }),
      env,
    );
    expect(sentRich()).toHaveLength(0);

    // Whitelisted → plain AI answer: no welcome, no deflection, no owner DM.
    // (Mutate the same env object — the memory store is keyed per env.)
    env.WHITELISTED_BOTS = "@RandomBot";
    await runWorker(
      businessMessage({
        chat: { id: 9006, type: "private" },
        from: { id: 777, is_bot: true, username: "RandomBot", first_name: "Random" },
        text: "ping",
        message_id: 10,
      }),
      env,
    );
    const rich = sentRich();
    expect(rich).toHaveLength(1);
    expect(rich[0].body.rich_message.markdown).toContain("secret"); // whole reply used
    expect(rich[0].body.rich_message.markdown).not.toContain("pass am give");
    expect(sentPlain().find((c) => c.body.chat_id === OWNER_DM)).toBeUndefined();
  });

  it("dedupes redelivered updates (same chat + message id)", async () => {
    stubTelegram();
    const env = { API_KEY: "t", OWNER_NAME: "Kwame", AI: globalThis.AI };

    await runWorker(CONN, env);
    const update = businessMessage({
      chat: { id: 9007, type: "private" },
      from: { id: 9007, is_bot: false, first_name: "Ama" },
    });
    await runWorker(update, env);
    await runWorker(update, env); // Telegram redelivery

    expect(sentRich()).toHaveLength(1);
  });

  it("silences when the connection cannot reply, and warns the owner only once", async () => {
    stubTelegram();
    const env = { API_KEY: "t", AI: globalThis.AI };

    await runWorker(
      {
        update_id: 1,
        business_connection: {
          ...CONN.business_connection,
          id: "BC2",
          rights: { can_reply: false },
        },
      },
      env,
    );
    await runWorker(businessMessage(), env);
    await runWorker(businessMessage({ message_id: 2 }), env);

    expect(sentRich()).toHaveLength(0);
    const warnings = sentPlain().filter((c) => c.body.chat_id === OWNER_DM);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].body.text).toContain("can_reply");
  });
});

describe("action buttons (callback queries)", () => {
  async function seed(env: Record<string, unknown>) {
    await runWorker(CONN, env);
    await runWorker(
      businessMessage({
        chat: { id: 9100, type: "private" },
        from: { id: 9100, is_bot: false, first_name: "Ama" },
        text: "Hello there",
      }),
      env,
    );
  }

  it("Delete: deletes via deleteBusinessMessages with the STORED connection id", async () => {
    stubTelegram();
    const env = { API_KEY: "t", OWNER_NAME: "Kwame", AI: globalThis.AI };
    await seed(env);

    await runWorker(
      {
        update_id: 3,
        callback_query: {
          id: "cb-del",
          from: { id: 9100, is_bot: false, first_name: "Ama" },
          chat_instance: "ci",
          data: "d:9100:111",
        },
      },
      env,
    );

    const del = calls.find((c) => c.method === "deleteBusinessMessages");
    expect(del).toBeTruthy();
    expect(del!.body).toEqual({ business_connection_id: "BC1", message_ids: [111] });

    const ack = sentAcks();
    expect(ack).toHaveLength(1);
    expect(ack[0].body.callback_query_id).toBe("cb-del");
    expect(ack[0].body.text).toContain("delete");
  });

  it("Request Human: DMs the owner and never posts to the customer chat", async () => {
    stubTelegram();
    const env = { API_KEY: "t", OWNER_NAME: "Kwame", AI: globalThis.AI };
    await seed(env);

    await runWorker(
      {
        update_id: 4,
        callback_query: {
          id: "cb-hum",
          from: { id: 9100, is_bot: false, first_name: "Ama" },
          chat_instance: "ci",
          data: "h:9100:111",
        },
      },
      env,
    );

    const ownerDm = sentPlain().find((c) => c.body.chat_id === OWNER_DM);
    expect(ownerDm).toBeTruthy();
    expect(ownerDm!.body.text).toContain("Request human");
    expect(ownerDm!.body.text).toContain("Hello there"); // last customer text from memory

    // No new message into the customer's chat.
    const toCustomer = sentPlain().filter((c) => c.body.chat_id === 9100);
    expect(toCustomer).toHaveLength(0);

    const ack = sentAcks();
    expect(ack).toHaveLength(1);
    expect(ack[0].body.text).toContain("boss");
  });

  it("always answers malformed callback data (progress bar) with no toast", async () => {
    stubTelegram();
    const env = { API_KEY: "t", AI: globalThis.AI };

    await runWorker(
      {
        update_id: 5,
        callback_query: {
          id: "cb-junk",
          from: { id: 1, is_bot: false, first_name: "X" },
          chat_instance: "ci",
          data: "garbage",
        },
      },
      env,
    );

    const ack = sentAcks();
    expect(ack).toHaveLength(1);
    expect(ack[0].body.callback_query_id).toBe("cb-junk");
    expect(ack[0].body.text).toBeUndefined();
    expect(calls.find((c) => c.method === "deleteBusinessMessages")).toBeUndefined();
  });
});

describe("direct mode (owner ↔ bot)", () => {
  it("answers /start with the canned greeting and handles unknown commands", async () => {
    stubTelegram();
    const env = { API_KEY: "t", OWNER_NAME: "Kwame", BOT_NAME: "Noti", AI: globalThis.AI };

    await runWorker(
      {
        update_id: 6,
        message: {
          message_id: 1,
          date: 1700000000,
          chat: { id: OWNER_DM, type: "private" },
          from: { id: OWNER_DM, is_bot: false, first_name: "Kwame" },
          text: "/start bizChat9990",
        },
      },
      env,
    );
    await runWorker(
      {
        update_id: 7,
        message: {
          message_id: 2,
          date: 1700000000,
          chat: { id: OWNER_DM, type: "private" },
          from: { id: OWNER_DM, is_bot: false, first_name: "Kwame" },
          text: "/jump",
        },
      },
      env,
    );

    const texts = sentPlain().map((c) => c.body.text as string);
    expect(texts[0]).toContain("secretary bot");
    expect(texts[1]).toContain("/help");
    // The deep link stored the owner DM chat for notifications.
    expect(sentRich()).toHaveLength(0);
  });

  it("keeps streaming replies for normal direct messages", async () => {
    stubTelegram({ aiTokens: ["Hello ", "boss 👊"] });
    const env = { API_KEY: "t", OWNER_NAME: "Kwame", AI: globalThis.AI };

    await runWorker(
      {
        update_id: 8,
        message: {
          message_id: 5,
          date: 1700000000,
          chat: { id: OWNER_DM, type: "private" },
          from: { id: OWNER_DM, is_bot: false, first_name: "Kwame" },
          text: "Anything new?",
        },
      },
      env,
    );

    // Drafts + final rich message, no business id, no buttons.
    expect(calls.some((c) => c.method === "sendRichMessageDraft")).toBe(true);
    const final = calls.find((c) => c.method === "sendRichMessage");
    expect(final!.body.business_connection_id).toBeUndefined();
    expect(final!.body.rich_message.markdown).toContain("Hello boss 👊");
  });
});

describe("memory lifecycle", () => {
  it("clears a chat transcript when its messages are deleted", async () => {
    stubTelegram({ aiTokens: ["VERDICT: GENERAL", "\nanswer one"] });
    const env = { API_KEY: "t", OWNER_NAME: "Kwame", CONTACTS: "9200", AI: globalThis.AI };

    await runWorker(CONN, env);
    await runWorker(
      businessMessage({
        chat: { id: 9200, type: "private" },
        from: { id: 9200, is_bot: false, first_name: "Ama" },
        text: "First question",
      }),
      env,
    );
    await runWorker(
      {
        update_id: 9,
        deleted_business_messages: {
          message_ids: [1],
          chat: { id: 9200, type: "private" },
        },
      },
      env,
    );

    // Next message should not carry the old transcript into the prompt.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 99999);
    await runWorker(
      businessMessage({
        chat: { id: 9200, type: "private" },
        from: { id: 9200, is_bot: false, first_name: "Ama" },
        text: "Second question",
        message_id: 3,
      }),
      env,
    );

    const aiCalls = (globalThis.AI.run as ReturnType<typeof vi.fn>).mock.calls;
    expect(aiCalls).toHaveLength(2);
    const prompt = aiCalls[1][1].prompt as string;
    expect(prompt).not.toContain("First question");
  });
});
