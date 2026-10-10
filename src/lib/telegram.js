/**
 * Small helpers around the Telegram Bot API.
 * Docs: https://core.telegram.org/bots/api
 */

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Call a Telegram Bot API method with a JSON body.
 * Always resolves with Telegram's own JSON envelope: { ok, result | description }.
 */
export async function callTelegram(env, method, params = {}) {
  const res = await fetch(TELEGRAM_API + "/bot" + env.API_KEY + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  return res.json();
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
