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
 * the fallbacks in `answer.js` cover the rest: Markdown → Telegram HTML
 * (`parse_mode: "HTML"`), then a marker-stripped plain text.
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

/* ------------------------------------------------- plain-text fallbacks */

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const escapeHtml = (text) => String(text).replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch]);

/**
 * Convert the model's Markdown into Telegram's own **HTML** parse mode.
 *
 * Used by the fallback chain in `answer.js`: when `sendRichMessage` is
 * rejected (e.g. the business account's user cannot send rich messages —
 * Bot API 10.1+ clients only), the reply is re-sent with
 * `sendMessage(parse_mode: "HTML")` so bold/italic/code/links still render
 * on every client instead of showing raw `**markers**`.
 *
 * Only the constructs the model is prompted to emit are converted; markers
 * are matched on word boundaries so `snake_case` and `5 * 3` stay literal.
 * Anything unparseable makes Telegram reject the send, which drops the
 * pipeline to the final stripped-plain fallback — never worse than before.
 */
export function markdownToTelegramHtml(raw) {
  const text = normalizeNewlines(raw);
  const stash = [];
  const hold = (html) => {
    stash.push(html);
    return "\u0000" + (stash.length - 1) + "\u0000";
  };

  // 1. Code first: its content must never be interpreted as markup.
  let out = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, (match, code) =>
    hold("<pre>" + escapeHtml(code.replace(/\n$/, "")) + "</pre>"),
  );
  out = out.replace(/`([^`\n]+)`/g, (match, code) => hold("<code>" + escapeHtml(code) + "</code>"));

  // 2. Escape the remaining text; the \0-digit\0 placeholders survive.
  out = escapeHtml(out);

  // 3. Links (& is already an entity inside the href — that is valid HTML).
  out = out.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|tg:\/\/[^)\s]+)\)/g,
    (match, label, url) => '<a href="' + url + '">' + label + "</a>",
  );

  // 4. Inline styles, word-bounded; bold before italic so ** wins over *.
  out = out.replace(/\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, "<b>$1</b>");
  out = out.replace(/__(?!\s)([^_\n]+?)(?<!\s)__/g, "<b>$1</b>");
  out = out.replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, "<i>$1</i>");
  out = out.replace(/(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/g, "<i>$1</i>");
  out = out.replace(/~~(?!\s)([^~\n]+?)(?<!\s)~~/g, "<s>$1</s>");
  out = out.replace(/\|\|([^|\n]+)\|\|/g, "<tg-spoiler>$1</tg-spoiler>");
  out = out.replace(/==([^=\n]+?)==/g, "$1"); // HTML has no highlight tag

  // 5. Block-level polish: headings bold, list bullets as "•".
  out = out.replace(/^#{1,6}[ \t]+(.+)$/gm, "<b>$1</b>");
  out = out.replace(/^[ \t]*[-*+][ \t]+/gm, "• ");

  // 6. Restore the code placeholders (their content is already escaped).
  return out.replace(/\u0000(\d+)\u0000/g, (match, index) => stash[Number(index)] || "");
}

/**
 * Remove every formatting marker from the text, keeping the words.
 *
 * Last-resort fallback: when even the HTML retry is rejected, the reply
 * still goes out readable instead of littered with `**`, `_`, backticks
 * and link URLs. Same word-boundary rules as `markdownToTelegramHtml`.
 */
export function stripMarkdown(raw) {
  let text = normalizeNewlines(raw);

  text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, (match, code) => code.replace(/\n$/, ""));
  text = text.replace(/`([^`\n]+)`/g, "$1");
  text = text.replace(/\[([^\]\n]+)\]\((?:https?:\/\/|tg:\/\/)[^)\s]+\)/g, "$1");
  text = text.replace(/\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, "$1");
  text = text.replace(/__(?!\s)([^_\n]+?)(?<!\s)__/g, "$1");
  text = text.replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, "$1");
  text = text.replace(/(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/g, "$1");
  text = text.replace(/~~(?!\s)([^~\n]+?)(?<!\s)~~/g, "$1");
  text = text.replace(/==([^=\n]+?)==/g, "$1");
  text = text.replace(/\|\|([^|\n]+?)\|\|/g, "$1");
  text = text.replace(/^#{1,6}[ \t]+/gm, "");
  text = text.replace(/^[ \t]*[-*+][ \t]+/gm, "• ");

  return text;
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
