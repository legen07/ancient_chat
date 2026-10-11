/**
 * Small helpers around the Telegram Bot API.
 * Docs: https://core.telegram.org/bots/api
 */

const TELEGRAM_API = "https://api.telegram.org";

/** Cap for 429 retry_after waits — longer cool-downs are given up on. */
const MAX_RETRY_AFTER_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call a Telegram Bot API method with a JSON body.
 * Always resolves with Telegram's own JSON envelope: { ok, result | description }.
 *
 * On a 429 (flood control) waits `retry_after` and retries once, as long as
 * the wait is reasonable (spec §8).
 */
export async function callTelegram(env, method, params = {}, { retries = 1 } = {}) {
  const res = await fetch(TELEGRAM_API + "/bot" + env.API_KEY + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  const json = await res.json();

  const retryAfterMs =
    json && !json.ok && json.error_code === 429 && json.parameters
      ? (json.parameters.retry_after || 0) * 1000
      : 0;

  if (retries > 0 && retryAfterMs > 0 && retryAfterMs <= MAX_RETRY_AFTER_MS) {
    await sleep(retryAfterMs);
    return callTelegram(env, method, params, { retries: retries - 1 });
  }

  return json;
}

/**
 * Send (or update) an ephemeral streaming preview of a message that is
 * still being generated — Bot API 10.1+. Drafts live for ~30 seconds and
 * must be persisted with sendRichMessage once the reply is complete.
 *
 * https://core.telegram.org/bots/api#sendrichmessagedraft
 */
export async function sendRichMessageDraft(env, params) {
  return callTelegram(env, "sendRichMessageDraft", params);
}

/**
 * Plain-text variant of the streaming preview (no parse mode).
 * https://core.telegram.org/bots/api#sendmessagedraft
 */
export async function sendMessageDraft(env, params) {
  return callTelegram(env, "sendMessageDraft", params);
}

/**
 * Send a persistent Rich Message (Rich Markdown / Rich HTML / blocks).
 * https://core.telegram.org/bots/api#sendrichmessage
 */
export async function sendRichMessage(env, params) {
  return callTelegram(env, "sendRichMessage", params);
}

/**
 * Send a regular text message. No parse mode by default, so callers stay
 * in control of formatting (and always have a safe verbatim fallback).
 */
export async function sendMessage(env, params) {
  return callTelegram(env, "sendMessage", params);
}

/**
 * Show a chat action (e.g. "typing…"). Accepts business_connection_id.
 * https://core.telegram.org/bots/api#sendchataction
 */
export async function sendChatAction(env, params) {
  return callTelegram(env, "sendChatAction", params);
}

/**
 * Answer a callback query (always required — clients show a progress bar
 * until the query is answered). Accepts a toast text and/or an alert.
 * https://core.telegram.org/bots/api#answercallbackquery
 */
export async function answerCallbackQuery(env, params) {
  return callTelegram(env, "answerCallbackQuery", params);
}

/**
 * Delete messages on behalf of a business account. Requires the
 * can_delete_sent_messages (own messages) or can_delete_all_messages right.
 * https://core.telegram.org/bots/api#deletebusinessmessages
 */
export async function deleteBusinessMessages(env, params) {
  return callTelegram(env, "deleteBusinessMessages", params);
}

/**
 * Fetch a business connection snapshot by id. Used to recover the connection
 * lazily when the one-shot business_connection update was missed (e.g. the
 * webhook was pointed at a dead endpoint while the bot was being connected).
 * https://core.telegram.org/bots/api#getbusinessconnection
 */
export async function getBusinessConnection(env, businessConnectionId) {
  const res = await callTelegram(env, "getBusinessConnection", {
    business_connection_id: businessConnectionId,
  });
  if (!res || !res.ok || !res.result) return null;
  return res.result;
}

/**
 * Edit only the reply markup (buttons) of a sent message. Used to attach the
 * action buttons once the reply's own message_id is known.
 * https://core.telegram.org/bots/api#editmessagereplymarkup
 */
export async function editMessageReplyMarkup(env, params) {
  return callTelegram(env, "editMessageReplyMarkup", params);
}

/**
 * Validate a webhook URL coming from the settings page (or the API).
 * Returns { value } on success, { error } on failure.
 *
 * Telegram only accepts https:// endpoints; plain http is tolerated for
 * local development against localhost / 127.0.0.1.
 */
export function validateWebhookUrl(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";

  if (!value) {
    return { error: "Enter a webhook URL first." };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { error: "That does not look like a valid URL." };
  }

  const host = parsed.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  const allowedProtocol =
    parsed.protocol === "https:" || (parsed.protocol === "http:" && isLocal);

  if (!allowedProtocol) {
    return {
      error: "The webhook URL must use https:// (plain http is only allowed for localhost).",
    };
  }

  if (parsed.username || parsed.password) {
    return { error: "The webhook URL must not contain a username or password." };
  }

  return { value: parsed.toString() };
}
