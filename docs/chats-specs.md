# Chats Spec — Secretary Bot: Message Intake & Reply Policy

**Status:** draft v2 · **Scope:** the bot is a **Telegram Secretary** (Secretary Mode / Chat
Automation / Business Bots). It does **not** wait for users to message the bot directly. It
listens to new messages arriving in the **owner's own private chats** and replies **as the
owner**, with an assistant sign-off. This document is the contract for the intake filter
and reply pipeline; implement against it and update it when a decision changes.

Supersedes v1 (which assumed a standalone support bot in `message` updates).

---

## 0. Verified API facts (Bot API 10.3, checked 2026-10-10 against official docs)

Source: https://core.telegram.org/bots/api and https://core.telegram.org/bots/features#business-bots

| Fact | Why it matters |
|---|---|
| Secretary flow: enable in BotFather → handle `business_connection` → handle `business_message` / `edited_business_message` / `deleted_business_messages` → send with `business_connection_id`. | Defines the whole intake shape (§2). |
| `BusinessConnection` = `{ id, user, user_chat_id, date, rights: BusinessBotRights, is_enabled }`. | `user_chat_id` is where the owner gets DMs; `rights` gates actions (§7). |
| `rights.can_reply` covers **private chats with an incoming message in the last 24 h**. | We only ever reply right after an incoming message → always inside the window (§6). |
| `sendMessage`, `sendRichMessage`, `sendChatAction`, `deleteBusinessMessages` accept `business_connection_id`. | These are the only tools for speaking/deleting in customer chats. |
| **`sendRichMessageDraft` / `sendMessageDraft` have NO `business_connection_id`** → streaming drafts are impossible on behalf of a business account. | Secretary replies are **one-shot rich messages**; the streaming pipeline survives only in the direct owner↔bot chat (§5). |
| `sendRichMessage` with `business_connection_id` requires "the corresponding user can send rich messages"; falls back to plain `sendMessage` on failure. | Mandatory plain-text fallback (§8). |
| `sendRichMessage` accepts `reply_markup` (InlineKeyboardMarkup) and `reply_parameters`. | Buttons + quoting in customer chats (§7, §8). |
| `CallbackQuery` = `{ id, from, message, inline_message_id, chat_instance, data, game_short_name }` — **no `business_connection_id`**. Must call `answerCallbackQuery` (clients show a progress bar until you do). | Button presses must resolve the connection from stored memory; always ack (§7). |
| `deleteBusinessMessages(business_connection_id, message_ids)` requires `can_delete_sent_messages` (bot's own messages) or `can_delete_all_messages`. | The Delete button depends on the owner granting that right (§7). |
| Bot-to-bot private messages require **Bot-to-Bot Communication Mode** on both sides; business accounts can send to other bots under Chat Access Mode. | Explains how whitelisted bot senders can appear at all (§4). |
| Bots must never hide their activity from the account owner (TOS §5.4, Telegram Business). | Every secretary reply carries the assistant sign-off (§9). |

---

## 1. Roles & identity

| Thing | Value | Source |
|---|---|---|
| Bot name | `BOT_NAME` (default `Noti`) | env |
| Owner name | `OWNER_NAME` (default `the boss`) | env |
| Owner DM target | `OWNER_CHAT_ID`, else latest `BusinessConnection.user_chat_id` | env / connection |
| Customer | any human private-chat counterpart of the owner | incoming `business_message` |

The bot speaks **as the owner** (Telegram renders the message from the owner's account) but
signs every reply as the assistant so the customer always knows a bot is talking (§9).

---

## 2. Update intake filter

The webhook acks HTTP `200 ok` immediately and runs everything in `ctx.waitUntil(...)`.

| Update field | Action |
|---|---|
| `business_connection` | **Process** → store/refresh the connection (id, user_chat_id, rights, is_enabled) in memory (§10). No chat message. |
| `business_message` | **Process** → secretary intake (§3–§6). The main path. |
| `edited_business_message` | **Silence** (v1: edits are not new questions). |
| `deleted_business_messages` | **Process (quiet)** → purge that chat's history from memory. |
| `callback_query` | **Process** → button actions (§7). |
| `message` | **Process as direct mode** — this is the owner talking to the bot itself: `/start` (incl. the `bizChat<id>` deep link), `/help`, `/stop`, otherwise the existing AI streaming pipeline in the owner's persona. |
| `stopped_message_generation` | **Process** → cancel the matching direct-chat generation (existing best-effort registry). |
| `channel_post`, `edited_channel_post`, `edited_message`, `inline_query`, `message_reaction*`, `chat_member`, `my_chat_member`, `chat_join_request`, `poll*`, `guest_message`, unknown | **Silence** (log kind once). |

`setWebhook` calls must pass an explicit `allowed_updates`:
`["business_connection","business_message","edited_business_message","deleted_business_messages","callback_query","message","stopped_message_generation"]`.

---

## 3. What counts as a "new message"

A `business_message` starts a reply only if **all** gates pass, in order:

1. **Parse** — body must be valid JSON with `business_message`.
2. **Dedup** — key `chat.id + ":" + message.message_id`. Telegram delivers at-least-once;
   a redelivered update must not double-reply. Mechanism: in-memory LRU (TTL 5 min,
   cap 1000 keys) + an in-flight guard while a generation runs. Storage sits behind
   `isDuplicate(key)` / `markSeen(key)` so it can be swapped for KV later (§10).
3. **Chat type** — must be `private` (business messages always are; double-check anyway).
4. **Blacklist** — skip if the chat id or `@username` is in `BLACKLIST_CHATS` → `silence`.
5. **Sender rules** (§4).
6. **Cooldown** — per-chat minimum gap between AI replies (`REPLY_COOLDOWN_MS`, 1.5 s);
   within the gap → canned "give me small time ⏳" (private chat only, it always is).
7. **Content guard** — `text`, else `caption`; empty/whitespace after trim → `silence`;
   over `MAX_INPUT_CHARS` (2000) → truncate for the prompt.

---

## 4. Sender rules

| Sender | Condition | Action |
|---|---|---|
| Human | normal user | Continue to reply flow (§5–§6). |
| Bot | `from.is_bot === true` **and** `from.username` (or id) ∈ `WHITELISTED_BOTS` | **Treat as a general question** → AI answer as owner. No welcome flow, no personal-question deflection, no sign-off debate (bots don't need the customer-care act). |
| Bot | `from.is_bot === true`, not whitelisted | **Silence.** (Loop prevention; real bot-to-bot syntaxes come later.) |
| Anonymous/channel identity | `sender_chat` present | **Silence.** |

Note: bot senders can only appear at all if Bot-to-Bot Communication Mode is enabled — the
whitelist is the safety net, not the primary gate.

---

## 5. Reply routing: the two conversations

The bot runs two distinct conversation modes from one webhook:

### 5.1 Secretary mode (customer chats — `business_message`)

One-shot replies (drafts unsupported, §0). Flow per accepted message:

1. Load chat memory (§10): `saved` flag, `bizConnId`, history.
2. **Unsaved chat** (no record **and** chat not in `CONTACTS`): **welcome flow** — one
   message that (a) greets warmly as the owner's assistant, (b) asks how to help, and
   (c) **also answers the question they just asked**. Then mark the chat saved.
3. **Saved chat**: build the dynamic prompt (§9) with the last-6 memory, ask the model for
   a `general` or `personal` verdict, then:
   - **General** (plain question, or answerable from the previous chat context) → AI reply.
   - **Personal** (needs the owner: feelings, money, commitments, requests to talk to the
     boss, anything the context doesn't cover) → canned deflection
     ("I don pass am give the boss — e go reply you soon 🙏") **and** DM the owner the
     question (chat id, name, text) at `OWNER_CHAT_ID`/`user_chat_id`.
4. Append both sides of the exchange to memory (§10).
5. Every secretary reply quotes the triggering message (`reply_parameters`) and carries the
   action buttons (§7) and the sign-off (§9).

### 5.2 Direct mode (owner ↔ bot — `message`)

The owner's own chat keeps the **existing streaming pipeline**: Thinking draft → throttled
`sendRichMessageDraft` refreshes → final `sendRichMessage`, Stop button supported. No
buttons, no sign-off, no personal/general split — the boss is the boss. Commands:

| Command | Behaviour |
|---|---|
| `/start` | Owner greeting. If the arg matches `bizChat<id>` (Manage Bot deep link), store that id as the owner-DM fallback. |
| `/help` | Canned usage text. |
| `/stop` | Cancel the in-flight direct-chat generation; canned confirmation. |
| unknown `/cmd` | Canned "unknown command" — never sent to the AI. |

---

## 6. Message types & text extraction (secretary chats)

| Incoming | Behaviour |
|---|---|
| Plain text | Input = `text`. |
| Media with caption (photo/video/document/audio/voice/sticker) | Input = `caption`, same guards. |
| Media without caption | Canned hint: "I fit read text wella — send am as words 🙏" (first time), else **silence**. |
| Voice message | v1: same as media without caption (no STT yet). |
| Sticker / dice / contact / location / poll / game / service message | **Silence.** |
| Unknown type | **Silence** (log the type). |

Commands (`/start`, `/help`, `/stop`) are matched before the AI path in both modes; in
secretary chats they arrive as ordinary customer text — v1 treats them as normal questions
(customer-side command syntax is a later phase).

---

## 7. Buttons (every secretary reply)

Attached via `reply_markup` (InlineKeyboardMarkup) on the send call:

| Label | `callback_data` | On press |
|---|---|---|
| 🗑 Delete | `d:<chat_id>:<message_id>` | `answerCallbackQuery` toast; `deleteBusinessMessages(bizConnId, [message_id])` using the **stored** connection id from chat memory (CallbackQuery has none, §0). Success → toast "E don delete ✅"; failure (right not granted / expired) → toast "The boss no give me permission to delete am 😕". |
| 👋 Request Human | `h:<chat_id>:<message_id>` | `answerCallbackQuery` toast "I don alert the boss 🙏"; DM the owner (chat, customer name, last customer text). |

Rules:
- **Always** `answerCallbackQuery` — even for malformed/unknown data (clients block on a
  progress bar otherwise). Unknown/malformed → silent ack + log.
- `message_id` in the data is **the reply's own id** (returned by `sendRichMessage`) — so a
  customer deletes exactly the message whose button they pressed.
- The click **posts nothing to the chat** — that is precisely why callback buttons, not
  URL links, implement "call the webhook without sending".
- Delete requires the owner to have granted `can_delete_sent_messages` in BotFather; the
  failure path must stay friendly.

---

## 8. Reply kinds & delivery

| Kind | Where | Mechanics |
|---|---|---|
| `business-rich` | Secretary chats | `sendChatAction(typing)` best-effort → collect full AI text → `sendRichMessage{business_connection_id, rich_message, reply_parameters, reply_markup}`. On failure: `sendMessage` plain text (≤4096) with the same business id; if that also fails, log + DM owner once. |
| `streaming-rich` | Direct owner chat | Existing pipeline unchanged (drafts, Stop, throttling, fallbacks). |
| `canned` | Both | `sendMessage`, no parse mode, verbatim-safe; business id attached in secretary chats. |
| `silence` | Both | Ack + log reason only. |

Cross-cutting: fast ack (`waitUntil`); Rich Markdown sanitising and limits via `rich.js`
(fences closed, ≤ 30000 chars); every rich send has a plain fallback; 429 → read
`retry_after`, retry once; log decision + ≤ 120-char text preview, never full bodies.

---

## 9. Dynamic prompt & persona

`buildPrompt(...)` becomes fully dynamic. Blocks, in order:

1. **Persona** — "You are `BOT_NAME`, the personal assistant of `OWNER_NAME` speaking in
   his Telegram chats. Friendly, warm, human — like a young Ghanaian guy: natural Ghanaian
   English with light pidgin where it fits ('no wahala', 'I go check', 'soon come'). Mirror
   the customer's language: pure English stays English, French stays French."
2. **Role boundaries** — never invent prices, promises, bookings or commitments the owner
   hasn't made; unknown → personal.
3. **Classification contract** — the reply's **first line must be exactly** `VERDICT: GENERAL`
   or `VERDICT: PERSONAL`, then the answer (GENERAL only). Personal = needs the owner's
   own knowledge/decision or is sensitive (money, complaints, relationships, "is the boss
   around?"). Answerable from the transcript → GENERAL.
4. **Memory transcript** — last 6 messages labelled `them:` / `you (boss's reply):` (§10).
5. **Customer facts** — name, `language_code`, saved/first-time flag, today's date, the
   message text.

The verdict line is parsed server-side; on parse failure default to **PERSONAL** (safe:
never blunders as the owner). Canned texts live in `src/lib/canned.js`, English + light
pidgin, one place to translate later.

Sign-off: every secretary **AI** reply ends with `\n\n— _<BOT_NAME> 🤖, on behalf of <OWNER_NAME>_`.
Canned replies carry the same line. This satisfies TOS §5.4 (never hide bot activity).

---

## 10. Memory & storage

**Backend:** KV binding `MEMORY` when present; otherwise a per-isolate in-memory Map
(dev/tests, matches the best-effort semantics of the stop registry). KV caveat: eventual
consistency up to ~60 s across edges — acceptable for chat memory; races degrade, never
break (reads fall back to empty state).

| Key | Value |
|---|---|
| `chat:<chat_id>` | `{ saved: bool, bizConnId: string, history: [{ role: "them"\|"us", text }], lastAt: number }` |
| `bizconn` | Latest `BusinessConnection` snapshot: `{ id, user_chat_id, canReply, canDeleteSent, enabled, at }` |

**History rules:** keep the **last 6** entries, at most **3 `them` + 3 `us`**; trim oldest
per role first. Text truncated to 300 chars per entry (prompt headroom). History is
read-modify-write per message — fine at secretary volume.

**Contact state:** `saved = record.saved || CONTACTS contains chat.id/@username`. The
welcome flow marks `saved`. Blacklist is env-only (never stored).

---

## 11. Environment variables

| Var | Meaning | Default |
|---|---|---|
| `API_KEY` | Bot token (existing). | required |
| `OWNER_NAME` | Owner's name for sign-offs/prompts. | `the boss` |
| `BOT_NAME` | Assistant's name. | `Noti` |
| `BLACKLIST_CHATS` | Comma-separated chat ids or `@usernames` — never answered. | empty |
| `WHITELISTED_BOTS` | Comma-separated bot `@usernames`/ids — answered like general questions; all other bot senders silenced. | empty |
| `CONTACTS` | Comma-separated chat ids or `@usernames` pre-saved (skip welcome). | empty |
| `OWNER_CHAT_ID` | Where owner DMs go; falls back to `BusinessConnection.user_chat_id`. | unset |

---

## 12. Constants

| Constant | Default | Meaning |
|---|---|---|
| `MEMORY_LIMIT` | `6` (3+3) | Transcript window (§10). |
| `MEMORY_ENTRY_CHARS` | `300` | Per-entry truncation. |
| `MAX_INPUT_CHARS` | `2000` | Prompt input truncation. |
| `DEDUP_TTL_MS` | `300000` | Answered-key TTL. |
| `DEDUP_MAX_KEYS` | `1000` | LRU cap. |
| `REPLY_COOLDOWN_MS` | `1500` | Per-chat gap between AI replies. |
| `RICH_TEXT_LIMIT` | `30000` | Existing rich cap. |
| `PLAIN_TEXT_LIMIT` | `4096` | Existing plain fallback cap. |
| `DRAFT_INTERVAL_MS` | `800` | Existing (direct-chat streaming only). |

---

## 13. Acceptance criteria (testable)

1. `business_message` from a blacklisted chat → `silence`, no AI call.
2. `business_message` from a non-whitelisted bot → `silence`; from a whitelisted bot →
   AI answer, no welcome, no sign-off debate.
3. First message from an unknown human chat → welcome **including** an answer to their
   question; chat marked saved afterwards.
4. Second message from the same chat → AI reply with sign-off + both buttons + quoting.
5. A personal question → canned deflection in the chat **and** a DM to the owner containing
   the question text.
6. Redelivered `business_message` (same chat+message id) → second delivery silent.
7. `callback_query` with `d:...` → `deleteBusinessMessages` called with the **stored**
   connection id; `answerCallbackQuery` always called (also for malformed data).
8. `callback_query` with `h:...` → owner DM sent; chat untouched.
9. Direct-chat `message` → streaming pipeline (drafts + Stop) still works; `/stop`
   cancels.
10. `business_connection` update → connection stored; sends use its id; when
    `rights.can_reply` is false → no send attempted, owner DM'd once.
11. AI verdict parse failure → treated as PERSONAL (canned deflection, no AI answer).
12. Memory keeps ≤ 6 entries (≤ 3 per role) after 10 exchanges.

---

## 14. Out of scope for v1

- Bot-to-bot chat syntaxes & protocols (whitelisted bots get plain answers only).
- Secretary streaming replies (impossible per §0; revisit if the API gains support).
- Multi-connection management (v1 uses the latest connection).
- Voice transcription, media OCR.
- Customer-side commands, per-chat toggles, group/channel secretary chats.
- Cross-isolate dedup via KV/DO; multilingual canned texts.
