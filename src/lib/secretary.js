/**
 * Secretary intake & routing (docs/chats-specs.md, spec v2).
 *
 * This is the brain that decides whether an update is a *new message* worth
 * answering, and how: welcome flow for first-timers, general vs personal
 * verdict for saved contacts, whitelist/blacklist for senders, and the
 * Delete / Request Human button actions.
 *
 * All replies go out as the owner via `business_connection_id` (one-shot —
 * streaming drafts do not support business chats, spec §0).
 */

import { sendBusinessReply } from "./answer.js";
import {
  buildPrompt,
  collectCompletion,
  parseVerdict,
  DEFAULT_BOT_NAME,
  DEFAULT_OWNER_NAME,
} from "./ai.js";
import * as canned from "./canned.js";
import * as memory from "./memory.js";
import {
  answerCallbackQuery,
  deleteBusinessMessages,
  getBusinessConnection,
  sendChatAction,
  sendMessage,
} from "./telegram.js";

/** Update kinds our webhook acts on (passed to setWebhook). */
export const ALLOWED_UPDATES = [
  "business_connection",
  "business_message",
  "edited_business_message",
  "deleted_business_messages",
  "callback_query",
  "message",
  "stopped_message_generation",
];

/** Answered-message keys are remembered for this long (spec §3). */
export const DEDUP_TTL_MS = 300000;
export const DEDUP_MAX_KEYS = 1000;
/** Per-chat minimum gap between AI replies (spec §3.6). */
export const REPLY_COOLDOWN_MS = 1500;
/** Prompt input truncation (spec §3.7). */
export const MAX_INPUT_CHARS = 2000;

/* ---------------------------------------------------------------- dedup */

const seenKeys = new Map(); // key -> first-seen timestamp

function pruneSeen(now) {
  for (const [key, at] of seenKeys) {
    if (now - at > DEDUP_TTL_MS) seenKeys.delete(key);
  }
  while (seenKeys.size > DEDUP_MAX_KEYS) {
    seenKeys.delete(seenKeys.keys().next().value); // evict oldest insertion
  }
}

/** True when this message was already handled (redelivery / in-flight). */
export function isDuplicate(key) {
  pruneSeen(Date.now());
  return seenKeys.has(key);
}

export function markSeen(key) {
  seenKeys.set(key, Date.now());
}

/** Forget the dedup LRU — test isolation only (module state leaks across cases). */
export function resetIntakeState() {
  seenKeys.clear();
}

/* ------------------------------------------------------------- env lists */

/** "A, b ,@C" -> Set("a","b","c") — ids and @usernames normalised. */
export function parseList(raw) {
  return new Set(
    String(raw || "")
      .split(",")
      .map((entry) => entry.trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean),
  );
}

function listHas(set, ...candidates) {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    if (set.has(String(candidate).replace(/^@/, "").toLowerCase())) return true;
  }
  return false;
}

export function isBlacklisted(env, chat) {
  return listHas(parseList(env.BLACKLIST_CHATS), chat.id, chat.username);
}

export function isWhitelistedBot(env, user) {
  return listHas(parseList(env.WHITELISTED_BOTS), user.id, user.username);
}

function isPreSavedContact(env, chat) {
  return listHas(parseList(env.CONTACTS), chat.id, chat.username);
}

const names = (env) => ({
  botName: env.BOT_NAME || DEFAULT_BOT_NAME,
  ownerName: env.OWNER_NAME || DEFAULT_OWNER_NAME,
});

/* ------------------------------------------------------- owner messaging */

/** DM the owner: OWNER_CHAT_ID → deep-link fallback → business user_chat_id. */
export async function notifyOwner(env, text) {
  const stored = await memory.getOwnerChatId(env);
  const conn = await memory.getConnection(env);
  const target = env.OWNER_CHAT_ID || stored || (conn ? conn.userChatId : 0);

  if (!target) {
    console.log("no owner chat to notify: " + text.slice(0, 80));
    return null;
  }

  const sent = await sendMessage(env, { chat_id: target, text });
  if (!sent || !sent.ok) {
    console.log("owner notify failed: " + ((sent && sent.description) || "no response"));
  }
  return sent;
}

/* --------------------------------------------------- connection updates */

/** business_connection update → store the latest connection snapshot. */
export async function handleBusinessConnection(env, connection) {
  const snapshot = await memory.saveConnection(env, connection);
  if (connection.user_chat_id) {
    await memory.setOwnerChatId(env, connection.user_chat_id);
  }
  console.log(
    "business connection " + snapshot.id + (snapshot.enabled ? " active" : " DISABLED") +
      (snapshot.canReply ? " (can_reply)" : " (NO can_reply)"),
  );
  return snapshot;
}

/**
 * Lazily recover a connection snapshot by id when the one-shot
 * business_connection update was missed. Stores it (and the owner DM target)
 * so the reply-rights gates and owner notifications work. Best-effort: any
 * failure returns null and the caller proceeds on the message's id alone.
 */
async function recoverConnection(env, bizConnId) {
  try {
    const connection = await getBusinessConnection(env, bizConnId);
    if (!connection) {
      console.log("getBusinessConnection empty for " + bizConnId);
      return null;
    }
    const snapshot = await memory.saveConnection(env, connection);
    if (connection.user_chat_id) {
      await memory.setOwnerChatId(env, connection.user_chat_id);
    }
    console.log(
      "recovered business connection " + snapshot.id +
        (snapshot.enabled ? " active" : " DISABLED") +
        (snapshot.canReply ? " (can_reply)" : " (NO can_reply)"),
    );
    return snapshot;
  } catch (err) {
    console.log("getBusinessConnection failed: " + (err && err.message));
    return null;
  }
}

/** deleted_business_messages update → forget that chat's transcript. */
export async function handleDeletedBusinessMessages(env, deleted) {
  const chat = deleted && deleted.chat;
  if (!chat || !chat.id) return;
  await memory.clearChat(env, chat.id);
  console.log("cleared memory for chat " + chat.id);
}

/* ------------------------------------------------------- the main intake */

/**
 * Handle one business_message. Returns { action, reason? } for logging/tests.
 * Never throws: the webhook was already acked.
 */
export async function handleBusinessMessage({ env, message }) {
  try {
    return await intake(env, message);
  } catch (err) {
    console.log(
      "secretary intake failed: " + (err && err.stack ? err.stack : String(err)),
    );
    return { action: "error" };
  }
}

async function intake(env, message) {
  const chat = message.chat || {};
  if (chat.type !== "private") {
    return { action: "silence", reason: "chat-type" };
  }

  const key = chat.id + ":" + message.message_id;
  if (isDuplicate(key)) {
    return { action: "silence", reason: "duplicate" };
  }
  markSeen(key); // doubles as the in-flight guard

  if (isBlacklisted(env, chat)) {
    console.log("blacklisted chat " + chat.id + " — silence");
    return { action: "silence", reason: "blacklist" };
  }

  const from = message.from || {};
  let botSender = false;
  if (from.is_bot) {
    if (!isWhitelistedBot(env, from)) {
      return { action: "silence", reason: "bot-not-whitelisted" };
    }
    botSender = true; // whitelisted bots get plain AI answers (spec §4)
  }
  if (message.sender_chat) {
    return { action: "silence", reason: "sender-chat" };
  }

  const record = await memory.getChatRecord(env, chat.id);
  const conn = await memory.getConnection(env);
  // The message itself carries the connection id (Bot API: Message
  // .business_connection_id) — prefer it, so replies still work even when the
  // business_connection update was missed (e.g. webhook pointed at a dead
  // tunnel while the bot was being connected).
  const bizConnId = message.business_connection_id || record.bizConnId || (conn ? conn.id : "");

  if (!bizConnId) {
    console.log("no business connection stored — cannot reply to chat " + chat.id);
    return { action: "silence", reason: "no-connection" };
  }

  // No snapshot yet (the one-shot connection update was missed) — recover it
  // from Telegram so the reply-rights gates and owner-DM target work.
  let live = conn;
  if (!live) {
    live = await recoverConnection(env, bizConnId);
    if (!live) {
      // No snapshot and not recoverable: proceed on the message's id alone
      // (we cannot know rights/enablement, but silence here would drop the
      // customer entirely).
      live = null;
    }
  }

  if (live && live.enabled === false) {
    return { action: "silence", reason: "connection-disabled" };
  }
  if (live && live.canReply === false) {
    if (!live.noReplyWarned) {
      await notifyOwner(env, canned.ownerNoReplyRights());
      await memory.patchConnection(env, { noReplyWarned: true });
    }
    return { action: "silence", reason: "no-reply-rights" };
  }

  const rawText = String(message.text || message.caption || "").trim();
  const { botName, ownerName } = names(env);

  if (!rawText) {
    // Media/voice without any text: hint the first time, stay quiet after.
    if (record.saved || botSender) {
      return { action: "silence", reason: "media-no-text" };
    }
    await sendBusinessReply({
      env,
      businessConnectionId: bizConnId,
      chatId: chat.id,
      text: canned.MEDIA_HINT,
      replyToMessageId: message.message_id,
      signOffLine: canned.signOff(botName, ownerName),
    });
    return { action: "canned", kind: "media-hint" };
  }

  const input = rawText.slice(0, MAX_INPUT_CHARS);
  const now = Date.now();

  if (record.lastAt && now - record.lastAt < REPLY_COOLDOWN_MS) {
    await sendBusinessReply({
      env,
      businessConnectionId: bizConnId,
      chatId: chat.id,
      text: canned.COOLDOWN,
      replyToMessageId: message.message_id,
      signOffLine: canned.signOff(botName, ownerName),
    });
    return { action: "canned", kind: "cooldown" };
  }

  // Best-effort "typing…" while the model works.
  try {
    await sendChatAction(env, {
      business_connection_id: bizConnId,
      chat_id: chat.id,
      action: "typing",
    });
  } catch (err) {
    console.log("typing action failed: " + (err && err.message));
  }

  const sign = botSender ? "" : canned.signOff(botName, ownerName);
  const saved = botSender || record.saved || isPreSavedContact(env, chat);

  let body;
  let kind;

  try {
    if (!saved) {
      // First-timer: greet AND answer in one message (spec §5.1).
      kind = "welcome";
      const prompt = buildPrompt({
        mode: "welcome",
        botName,
        ownerName,
        customer: from,
        memory: record.history,
        text: input,
        saved: false,
      });
      const answer = (await collectCompletion(env, prompt)).trim();
      body = canned.welcome(botName, ownerName) + (answer ? "\n\n" + answer : "");
    } else if (botSender) {
      // Whitelisted bot: general answer, no verdict theatre (spec §4).
      kind = "bot-general";
      const prompt = buildPrompt({
        mode: "plain",
        botName,
        ownerName,
        customer: from,
        memory: record.history,
        text: input,
        saved: true,
      });
      body = (await collectCompletion(env, prompt)).trim();
      if (!body) return { action: "error", reason: "empty-generation" };
    } else {
      // Saved contact: classify, then answer or deflect (spec §5.1).
      const prompt = buildPrompt({
        mode: "secretary",
        botName,
        ownerName,
        customer: from,
        memory: record.history,
        text: input,
        saved: true,
      });
      const parsed = parseVerdict(await collectCompletion(env, prompt));
      kind = parsed.verdict.toLowerCase();

      if (parsed.verdict === "PERSONAL") {
        body = canned.personalDeflection(ownerName);
        await sendBusinessReply({
          env,
          businessConnectionId: bizConnId,
          chatId: chat.id,
          text: body,
          replyToMessageId: message.message_id,
          signOffLine: sign,
        });
        await notifyOwner(
          env,
          canned.ownerPersonalAlert({
            customerName: from.first_name,
            chatId: chat.id,
            text: input,
          }),
        );
        await persist(env, chat.id, { record, bizConnId, saved: true, lastAt: now, input, body });
        return { action: "reply", kind };
      }

      body = parsed.answer || canned.errorReply(ownerName);
    }
  } catch (err) {
    // Model/Workers AI failure: canned apology so the customer is not left hanging.
    console.log("secretary AI failed: " + (err && err.message ? err.message : String(err)));
    body = canned.errorReply(ownerName);
    kind = "error";
  }

  const sent = await sendBusinessReply({
    env,
    businessConnectionId: bizConnId,
    chatId: chat.id,
    text: body,
    replyToMessageId: message.message_id,
    signOffLine: sign,
  });

  if (!sent.ok) {
    await notifyOwner(
      env,
      canned.ownerSendFailure({ customerName: from.first_name, chatId: chat.id }),
    );
    return { action: "error", reason: "send-failed" };
  }

  await persist(env, chat.id, { record, bizConnId, saved: true, lastAt: now, input, body });
  console.log("secretary replied (" + kind + ") to chat " + chat.id);
  return { action: "reply", kind };
}

/** Append both sides of the exchange and refresh the chat record. */
async function persist(env, chatId, { record, bizConnId, saved, lastAt, input, body }) {
  await memory.appendHistory(env, chatId, "them", input);
  await memory.appendHistory(env, chatId, "us", body);
  const fresh = await memory.getChatRecord(env, chatId);
  await memory.putChatRecord(env, chatId, {
    ...fresh,
    saved: saved || record.saved,
    bizConnId: bizConnId || record.bizConnId,
    lastAt,
  });
}

/* ------------------------------------------------------- button actions */

/**
 * Handle a callback query from the Delete / Request Human buttons
 * (spec §7). Always answers the query — clients block on a progress bar.
 */
export async function handleCallbackQuery({ env, query }) {
  try {
    const data = typeof query.data === "string" ? query.data : "";
    const parts = data.split(":");
    const action = parts[0];
    const chatId = Number(parts[1]);
    const messageId = Number(parts[2]);
    let ackText = "";

    if (action === "d" && chatId && messageId) {
      const record = await memory.getChatRecord(env, chatId);
      const conn = await memory.getConnection(env);
      const bizConnId = (record && record.bizConnId) || (conn ? conn.id : "");

      if (!bizConnId) {
        ackText = canned.TOAST_DELETE_FAIL;
      } else {
        const res = await deleteBusinessMessages(env, {
          business_connection_id: bizConnId,
          message_ids: [messageId],
        });
        ackText = res && res.ok ? canned.TOAST_DELETE_OK : canned.TOAST_DELETE_FAIL;
        console.log(
          "delete button for chat " + chatId + ": " + (res && res.ok ? "deleted" : "failed"),
        );
      }
    } else if (action === "h" && chatId) {
      const record = await memory.getChatRecord(env, chatId);
      const lastThem = (record.history || [])
        .slice()
        .reverse()
        .find((entry) => entry.role === "them");

      await notifyOwner(
        env,
        canned.ownerHumanRequest({
          customerName: query.from && query.from.first_name,
          chatId,
          text: lastThem ? lastThem.text : "",
        }),
      );
      ackText = canned.TOAST_HUMAN_OK;
      console.log("request-human button for chat " + chatId);
    } else {
      console.log("unknown callback data: " + data.slice(0, 64));
    }

    if (query.id) {
      await answerCallbackQuery(env, {
        callback_query_id: query.id,
        ...(ackText ? { text: ackText } : {}),
      });
    }

    return { action: "callback", kind: action || "unknown" };
  } catch (err) {
    console.log("callback handling failed: " + (err && err.message ? err.message : String(err)));
    return { action: "error" };
  }
}
