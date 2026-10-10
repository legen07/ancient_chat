/**
 * Helpers that turn raw model output into Telegram **Rich Markdown**
 * (Bot API 10.1+ InputRichMessage.markdown — GitHub Flavored Markdown
 * plus supported HTML tags).
 *
 * Docs: https://core.telegram.org/bots/api#rich-message-formatting-options
 *
 * Rich messages allow up to 32768 UTF-8 characters, but a *partial*
 * generation can end in the middle of a code fence or an inline marker.
 * These helpers stabilise such previews so Telegram never has to parse a
 * half-written entity; the finished reply is sanitised the same way and
 * everything else is covered by a plain-text fallback in `answer.js`.
 */

/** Telegram allows 32768 characters per rich message; keep a small margin. */
export const RICH_TEXT_LIMIT = 30000;

/** Markers that stream in pairs and must not end a live preview. */
const INLINE_MARKERS = ["**", "__", "~~", "==", "||", "`"];

const normalizeNewlines = (text) => String(text).replace(/\r\n?/g, "\n");

/** Number of non-overlapping occurrences of `needle` in `haystack`. */
const countOccurrences = (haystack, needle) => haystack.split(needle).length - 1;

/** True when the text ends inside an unterminated ``` code fence. */
export function hasOpenCodeFence(text) {
  return countOccurrences(text, "```") % 2 !== 0;
}

/**
 * Remove the opening marker of any inline construct that is still
 * unterminated (e.g. "some **bo" → "some bo"), so neither a live preview
 * nor the final reply ends up with a half-written entity. Markers that are
 * opened *and* closed are left untouched.
 */
function stripUnclosedMarkers(text) {
  let out = text;

  for (let pass = 0; pass <= INLINE_MARKERS.length; pass += 1) {
    let changed = false;

    for (const marker of INLINE_MARKERS) {
      const occurrences = out.split(marker).length - 1;
      if (occurrences % 2 === 0) continue;

      // The last occurrence is the opener that will never be closed.
      const at = out.lastIndexOf(marker);
      if (at === -1) continue;

      out = out.slice(0, at) + out.slice(at + marker.length);
      changed = true;
    }

    if (!changed) break;
  }

  return out;
}

/** Cut text to the Telegram limit, marking the cut with an ellipsis. */
function truncate(text, max = RICH_TEXT_LIMIT) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

/**
 * Build the `InputRichMessage` for a *live* streaming preview: closes an
 * unterminated code fence, drops markers that are still open at the end,
 * and respects the rich message length limit.
 */
export function partialRichMarkdown(raw) {
  let text = normalizeNewlines(raw);

  text = hasOpenCodeFence(text) ? text + "\n```" : stripUnclosedMarkers(text);

  return { markdown: truncate(text) };
}

/**
 * Build the `InputRichMessage` for the finished reply. The model's own
 * Markdown (lists, tables, bold, code, …) is passed through — Rich Markdown
 * is GFM-compatible — but a generation that stopped mid-block is closed so
 * Telegram can always parse the final message.
 */
export function finalRichMarkdown(raw) {
  let text = normalizeNewlines(raw);

  text = hasOpenCodeFence(text) ? text + "\n```" : stripUnclosedMarkers(text);

  return { markdown: truncate(text.trim()) };
}

/**
 * Plain-text version of a reply, used when Telegram rejects the rich
 * formatting. No parse mode is applied, so the raw text renders verbatim.
 */
export function plainText(raw, max = 4096) {
  const text = normalizeNewlines(raw).trim();
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
