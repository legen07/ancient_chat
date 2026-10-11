/**
 * Streaming reply pipeline.
 *
 * Private chat: the bot posts an ephemeral Rich Message draft
 * (sendRichMessageDraft) that is refreshed while Workers AI streams tokens,
 * then persists the finished reply with sendRichMessage. Drafts support the
 * Rich Markdown grammar (GFM + supported HTML tags) and a Stop button.
 *
 * Group/channel chats: drafts are private-chat only, so the tokens are
 * simply collected and the finished Rich Message is sent once.
 *
 * Docs: https://core.telegram.org/bots/api#streaming-replies
 */

import { buildPrompt, streamCompletion, DEFAULT_BOT_NAME, DEFAULT_OWNER_NAME } from "./ai.js";
import { finalRichMarkdown, partialRichMarkdown, plainText } from "./rich.js";
import {
  editMessageReplyMarkup,
  sendMessage,
  sendMessageDraft,
  sendRichMessage,
  sendRichMessageDraft,
} from "./telegram.js";

/** Minimum gap between draft updates (~Telegram's 1 edit/second per chat). */
const DRAFT_INTERVAL_MS = 800;

/** Only push a draft when it actually grew since the previous push. */
const DRAFT_MIN_NEW_CHARS = 2;

/** Placeholder shown before the first token arrives. */
const THINKING_RICH = { markdown: "<tg-thinking>Thinking…</tg-thinking>" };

/**
 * In-flight generations by `${chat_id}:${draft_id}`.
 *
 * A pressed Stop button arrives as its own webhook update
 * (`stopped_message_generation`), i.e. on a *different* HTTP request that
 * may hit another Worker isolate. This registry is the best-effort
 * cancellation path: it always works for requests landing on the same
 * isolate and never breaks anything when they do not.
 */
const activeGenerations = new Map();

const generationKey = (chatId, draftId) => chatId + ":" + draftId;

/** Cancel the in-flight generation for a draft. Returns true if one was found. */
export function stopGeneration(chatId, draftId) {
  const generation = activeGenerations.get(generationKey(chatId, draftId));
  if (!generation) return false;

  generation.stopped = true;
  return true;
}

/** Cancel every in-flight generation for a chat (used by the /stop command). */
export function stopChatGeneration(chatId) {
  let stopped = 0;
  for (const [key, generation] of activeGenerations) {
    if (key.startsWith(chatId + ":")) {
      generation.stopped = true;
      stopped += 1;
    }
  }
  return stopped;
}

/**
 * Inline keyboard attached to every secretary reply (spec §7).
 * The message id in the callback data is the reply's own id, so pressing
 * Delete removes exactly the message the customer pressed it on.
 */
export function actionKeyboard(chatId, messageId) {
  return {
    inline_keyboard: [
      [
        { text: "🗑 Delete", callback_data: "d:" + chatId + ":" + messageId },
        { text: "👋 Request Human", callback_data: "h:" + chatId + ":" + messageId },
      ],
    ],
  };
}

/** Refresh the live preview; falls back to a plain-text draft on parse errors. */
async function pushDraft(env, chatId, draftId, threadId, text) {
  const params = { chat_id: chatId, draft_id: draftId, can_stop: true };
  if (threadId) params.message_thread_id = threadId;

  const rich = await sendRichMessageDraft(env, {
    ...params,
    rich_message: partialRichMarkdown(text),
  });

  if (rich && rich.ok) return;

  console.log(
    "sendRichMessageDraft failed: " + ((rich && rich.description) || "no response") +
      " — falling back to a plain draft",
  );

  // A plain draft (no parse mode) always renders: partial Markdown that
  // Telegram cannot parse yet simply shows up as literal characters.
  await sendMessageDraft(env, { ...params, text: plainText(text) });
}

/**
 * Answer one Telegram text message with a streamed Rich Markdown reply.
 *
 * @param {object} options
 * @param {{ API_KEY: string, AI: { run: Function } }} options.env
 * @param {{ id: number, type: string }} options.chat
 * @param {number} options.draftId  Non-zero draft id; updates with the same id animate.
 * @param {{ first_name?: string, language_code?: string }} options.from
 * @param {string} options.text     The user's message text.
 * @param {number} [options.threadId]
 * @param {number} [options.draftIntervalMs]  Throttle between draft refreshes.
 */
export async function answerMessage({
  env,
  chat,
  draftId,
  from,
  text,
  threadId,
  draftIntervalMs = DRAFT_INTERVAL_MS,
}) {
  const chatId = chat.id;
  const isPrivate = chat.type === "private";
  const key = generationKey(chatId, draftId);
  // `aborted` mirrors `stopped` so the same object can be handed to the
  // stream reader as an AbortSignal-like cancellation flag.
  const generation = {
    stopped: false,
    get aborted() {
      return this.stopped;
    },
  };
  activeGenerations.set(key, generation);

  try {
    if (isPrivate) {
      // "Thinking…" placeholder while the first tokens are generated.
      const thinking = await sendRichMessageDraft(env, {
        chat_id: chatId,
        draft_id: draftId,
        rich_message: THINKING_RICH,
        can_stop: true,
        ...(threadId ? { message_thread_id: threadId } : {}),
      });

      if (!thinking || !thinking.ok) {
        // Empty text renders Telegram's own "Thinking…" placeholder.
        await sendMessageDraft(env, {
          chat_id: chatId,
          draft_id: draftId,
          text: "",
          can_stop: true,
          ...(threadId ? { message_thread_id: threadId } : {}),
        });
      }
    }

    const prompt = buildPrompt({
      mode: "direct",
      botName: env.BOT_NAME || DEFAULT_BOT_NAME,
      ownerName: env.OWNER_NAME || DEFAULT_OWNER_NAME,
      customer: from,
      text,
    });
    let full = "";
    let lastPushedAt = 0;
    let lastPushedLength = 0;

    try {
      for await (const token of streamCompletion(env, prompt, {}, { signal: generation })) {
        if (generation.stopped) break;

        full += token;

        const now = Date.now();
        if (
          isPrivate &&
          now - lastPushedAt >= draftIntervalMs &&
          full.length - lastPushedLength >= DRAFT_MIN_NEW_CHARS
        ) {
          lastPushedAt = now;
          lastPushedLength = full.length;
          await pushDraft(env, chatId, draftId, threadId, full);
        }
      }
    } catch (err) {
      console.log("AI stream failed: " + (err && err.message ? err.message : String(err)));
    }

    // The user pressed Stop: drop whatever was generated (keep_on_stop is
    // false, so Telegram removes the draft on its own).
    if (generation.stopped) {
      console.log("Generation stopped by the user for draft " + draftId);
      return { ok: false, stopped: true, text: full };
    }

    if (!full.trim()) {
      await sendMessage(env, {
        chat_id: chatId,
        text: "⚠️ Sorry, I could not generate a reply just now. Please try again in a moment.",
        ...(threadId ? { message_thread_id: threadId } : {}),
      });
      return { ok: false, text: full };
    }

    // Persist the finished reply; the ephemeral draft disappears by itself.
    const sent = await sendRichMessage(env, {
      chat_id: chatId,
      rich_message: finalRichMarkdown(full),
      ...(threadId ? { message_thread_id: threadId } : {}),
    });

    if (!sent || !sent.ok) {
      console.log(
        "sendRichMessage failed: " + ((sent && sent.description) || "no response") +
          " — falling back to plain text",
      );
      await sendMessage(env, {
        chat_id: chatId,
        text: plainText(full),
        ...(threadId ? { message_thread_id: threadId } : {}),
      });
    }

    return { ok: true, text: full };
  } finally {
    activeGenerations.delete(key);
  }
}

/**
 * Send one one-shot reply on behalf of the business account (secretary mode).
 *
 * Streaming drafts do NOT support business_connection_id (Bot API 10.3, see
 * spec §0), so this collects nothing and just delivers: Rich Message first,
 * plain-text fallback, then the action buttons are attached with a follow-up
 * edit once the reply's own message_id is known.
 *
 * @param {object} options
 * @param {string} options.businessConnectionId
 * @param {number} options.chatId          Customer chat id.
 * @param {string} options.text            Reply body (without sign-off).
 * @param {number} [options.replyToMessageId]  Triggering message to quote.
 * @param {string} [options.signOffLine]   Appended assistant sign-off, if any.
 * @param {boolean} [options.withButtons]  Attach Delete / Request Human (default true).
 * @returns {Promise<{ ok: boolean, messageId: number }>}
 */
export async function sendBusinessReply({
  env,
  businessConnectionId,
  chatId,
  text,
  replyToMessageId,
  signOffLine = "",
  withButtons = true,
}) {
  const body = (text || "") + signOffLine;

  const sent = await sendRichMessage(env, {
    business_connection_id: businessConnectionId,
    chat_id: chatId,
    rich_message: finalRichMarkdown(body),
    ...(replyToMessageId
      ? { reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true } }
      : {}),
  });

  let messageId = sent && sent.ok && sent.result ? sent.result.message_id : 0;

  if (!sent || !sent.ok) {
    console.log(
      "business sendRichMessage failed: " + ((sent && sent.description) || "no response") +
        " — falling back to plain text",
    );
    const fallback = await sendMessage(env, {
      business_connection_id: businessConnectionId,
      chat_id: chatId,
      text: plainText(body),
      ...(replyToMessageId
        ? { reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true } }
        : {}),
    });

    if (!fallback || !fallback.ok) {
      console.log(
        "business sendMessage failed too: " + ((fallback && fallback.description) || "no response"),
      );
      return { ok: false, messageId: 0 };
    }

    // Buttons still belong on the plain fallback (some business accounts
    // cannot send rich messages at all) — attach them to the sent message.
    messageId = fallback.result ? fallback.result.message_id : 0;
    await attachActionButtons({ env, businessConnectionId, chatId, messageId, withButtons });
    return { ok: true, messageId };
  }

  // Buttons need the reply's own message_id, so they ride on a follow-up edit.
  await attachActionButtons({ env, businessConnectionId, chatId, messageId, withButtons });

  return { ok: true, messageId };
}

/**
 * Attach the Delete / Request Human keyboard to an already-sent business
 * message (best-effort: the reply stands without buttons if the edit fails).
 */
async function attachActionButtons({ env, businessConnectionId, chatId, messageId, withButtons }) {
  if (!withButtons || !messageId) return;

  const edited = await editMessageReplyMarkup(env, {
    business_connection_id: businessConnectionId,
    chat_id: chatId,
    message_id: messageId,
    reply_markup: actionKeyboard(chatId, messageId),
  });

  if (!edited || !edited.ok) {
    console.log(
      "editMessageReplyMarkup failed: " + ((edited && edited.description) || "no response") +
        " — reply stands without buttons",
    );
  }
}
