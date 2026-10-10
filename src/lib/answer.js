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

import { buildPrompt, streamCompletion } from "./ai.js";
import { finalRichMarkdown, partialRichMarkdown, plainText } from "./rich.js";
import {
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

    const prompt = buildPrompt({ ...from, text });
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
