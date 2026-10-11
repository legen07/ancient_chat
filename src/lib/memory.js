/**
 * Secretary memory store (spec §10).
 *
 * Backend: the KV binding `MEMORY` when present; otherwise a per-isolate
 * in-memory Map (dev/tests — same best-effort semantics as the stop
 * generation registry in answer.js).
 *
 * Keys:
 *   chat:<chat_id> — { saved, bizConnId, history: [{role:"them"|"us",text}], lastAt }
 *   bizconn        — latest BusinessConnection snapshot
 *   ownerchat      — owner DM chat id fallback (deep-linked /start bizChat<id>)
 */

/** Transcript window: last 6 messages, at most 3 per role (spec §10). */
export const MEMORY_LIMIT = 6;
export const MEMORY_PER_ROLE = 3;
/** Per-entry truncation keeps the prompt small. */
export const MEMORY_ENTRY_CHARS = 300;

/** Per-isolate fallback stores, one Map per env object. */
const fallbackStores = new WeakMap();

function fallbackStore(env) {
  let store = fallbackStores.get(env);
  if (!store) {
    store = new Map();
    fallbackStores.set(env, store);
  }
  return store;
}

const kv = (env) => (env && env.MEMORY ? env.MEMORY : null);

async function readJson(env, key) {
  const namespace = kv(env);
  if (!namespace) {
    const raw = fallbackStore(env).get(key);
    return raw === undefined ? null : JSON.parse(raw);
  }
  try {
    const raw = await namespace.get(key);
    return raw === null || raw === undefined ? null : JSON.parse(raw);
  } catch (err) {
    console.log("memory read failed for " + key + ": " + (err && err.message));
    return null;
  }
}

async function writeJson(env, key, value) {
  const raw = JSON.stringify(value);
  const namespace = kv(env);
  if (!namespace) {
    fallbackStore(env).set(key, raw);
    return;
  }
  try {
    await namespace.put(key, raw);
  } catch (err) {
    console.log("memory write failed for " + key + ": " + (err && err.message));
  }
}

const chatKey = (chatId) => "chat:" + chatId;

/** Trim history to the last 6 entries, at most 3 per role (oldest dropped first). */
export function trimHistory(history) {
  let out = (history || []).slice(-MEMORY_LIMIT);

  for (const role of ["them", "us"]) {
    let over = out.filter((entry) => entry.role === role).length - MEMORY_PER_ROLE;
    if (over <= 0) continue;
    out = out.filter((entry) => {
      if (entry.role !== role || over <= 0) return true;
      over -= 1;
      return false; // drop the oldest entries of the over-quota role
    });
  }

  return out;
}

/** Load a chat record; returns a safe empty shape when unknown. */
export async function getChatRecord(env, chatId) {
  const record = await readJson(env, chatKey(chatId));
  return record && typeof record === "object"
    ? { saved: false, bizConnId: "", history: [], lastAt: 0, ...record }
    : { saved: false, bizConnId: "", history: [], lastAt: 0 };
}

export async function putChatRecord(env, chatId, record) {
  const next = {
    saved: !!record.saved,
    bizConnId: record.bizConnId || "",
    history: trimHistory(record.history),
    lastAt: record.lastAt || 0,
  };
  await writeJson(env, chatKey(chatId), next);
  return next;
}

/** Append one transcript entry and persist (read-modify-write). */
export async function appendHistory(env, chatId, role, text) {
  const record = await getChatRecord(env, chatId);
  const entry = String(text || "").slice(0, MEMORY_ENTRY_CHARS);
  if (!entry) return record;
  return putChatRecord(env, chatId, {
    ...record,
    history: trimHistory([...record.history, { role, text: entry }]),
  });
}

export async function clearChat(env, chatId) {
  const key = chatKey(chatId);
  const namespace = kv(env);
  if (!namespace) {
    fallbackStore(env).delete(key);
    return;
  }
  try {
    await namespace.delete(key);
  } catch (err) {
    console.log("memory delete failed for " + key + ": " + (err && err.message));
  }
}

/** Store the latest BusinessConnection snapshot (from a business_connection update). */
export async function saveConnection(env, connection) {
  const rights = connection.rights || {};
  const snapshot = {
    id: connection.id || "",
    userChatId: connection.user_chat_id || 0,
    enabled: connection.is_enabled !== false,
    canReply: rights.can_reply === true,
    canDeleteSent: rights.can_delete_sent_messages === true,
    at: Date.now(),
  };
  await writeJson(env, "bizconn", snapshot);
  return snapshot;
}

export async function getConnection(env) {
  return readJson(env, "bizconn");
}

/** Merge a patch into the stored connection snapshot (e.g. one-shot warn flags). */
export async function patchConnection(env, patch) {
  const current = await getConnection(env);
  const next = { ...(current || {}), ...patch };
  await writeJson(env, "bizconn", next);
  return next;
}

/** Owner DM target fallback, set by the /start bizChat<id> deep link. */
export async function setOwnerChatId(env, chatId) {
  await writeJson(env, "ownerchat", { id: chatId });
}

export async function getOwnerChatId(env) {
  const stored = await readJson(env, "ownerchat");
  return stored && stored.id ? stored.id : 0;
}
