# Telegram Secretary Bots & Chat Automation — compact card

*Pulled 2026-10-10 from Telegram's official pages · current Bot API **10.3** (Aug 24, 2026) ·
this feature last changed in **Bot API 10.0** (May 8, 2026).*

> **Agents: this card is orientation only — not a reference.**
> For proper lookup and reference (exact fields, parameters, rights, edge conditions), open
> the detailed documentation listed under [Detailed documentation](#detailed-documentation)
> below and work from those pages. Never implement from this card or from memory.

## One feature, four names

**Chat Automation** (app UI: *Settings → Chat Automation*) = **Secretary Mode** (toggle in
[@BotFather](https://t.me/botfather)) = **Secretary Bots** (docs anchor `#secretary-bots`,
a redirect stub that lands on `#business-bots`) = **Business Bots** (current heading in the
Bot Features page). Transport: Business Connection API (`business_connection_id`),
unchanged since Bot API 7.2.

## Quick start (official)

1. Enable **Secretary Mode** for your bot in @BotFather.
2. Handle `business_connection` updates (established / edited / ended).
3. Handle `business_message`, `edited_business_message`, `deleted_business_messages`.
4. Read permissions from `rights` (`BusinessBotRights`) on the latest `BusinessConnection` —
   `can_reply` covers private chats with an incoming message in the last **24 h**.
5. Send as the user: pass `business_connection_id` to `sendMessage`, `sendChatAction` and
   other send methods.

**User flow:** *Settings → Chat Automation* → owner picks which chats the bot may access →
"Manage Bot" quick action deep-links `/start bizChat<user_chat_id>`.

**`BusinessBotRights` fields:** `can_reply`, `can_read_messages`, `can_delete_sent_messages`,
`can_delete_all_messages`, `can_edit_name`, `can_edit_bio`, `can_edit_profile_photo`,
`can_edit_username`, `can_change_gift_settings`, `can_view_gifts_and_stars`,
`can_convert_gifts_to_stars`, `can_transfer_and_upgrade_gifts`, `can_transfer_stars`,
`can_manage_stories`.

## Superseded — do not use

- `BusinessConnection.can_reply` **as a top-level field** → replaced by
  `rights: BusinessBotRights` (Bot API 9.0, 2025-04-11); `can_reply` survives only *inside*
  `BusinessBotRights`.
- "The account owner needs Telegram Premium" → lifted in Bot API 10.0 (2026-05-08).
- Pre-9.0 docs lack `readBusinessMessage` / `deleteBusinessMessages`; pre-10.0 docs predate
  today's flow. Bot API 10.1–10.3 changed nothing in this feature.

## Compliance (TOS §5.4 — mandated reading)

Truthful service description; disclose which user data is kept and why; no secondary use of
message contents; no third-party disclosure without authorization; never hide the bot's
activity from the account owner; report service changes promptly. Violation = permanent ban
+ legal action.

## Detailed documentation

**Refer to these for proper lookup and reference:**

| What to look up | Where |
|---|---|
| Feature guide: Secretary Mode setup, quick start, rights model, deep link | https://core.telegram.org/bots/features#business-bots (legacy `#secretary-bots` lands here) |
| Types & methods: `Update`, `BusinessConnection`, `BusinessBotRights`, `BusinessMessagesDeleted`, `getBusinessConnection`, `readBusinessMessage`, `deleteBusinessMessages`, `sendMessage`, `sendChatAction`, `getUserPersonalChatMessages`, business-account methods | https://core.telegram.org/bots/api |
| Every change ever to this feature (Bot API 7.2 → 10.0) + full Bot API 10.0 entry | https://core.telegram.org/bots/api-changelog |
| Announcement & user-facing flow (May 7, 2026) | https://telegram.org/blog/ai-bot-revolution-11-new-features |
| Compliance obligations (TOS §5.4 Telegram Business) | https://telegram.org/tos/bot-developers#5-4-telegram-business |
| Platform context: AI agents, guest bots, bot-to-bot, streaming | https://core.telegram.org/bots/features#ai-agents |
| Verbatim local extracts of all of the above | `python3 .telegram-docs-src/extract.py` — re-downloads the five source pages and writes `01…08-*.md` + `README.md` into this directory |

All sources retrieved 2026-10-10. Re-run `extract.py` to refresh from the live pages.
Note: `.telegram-docs-src/build_compact.py` rewrites **this file** as a lossless merge —
back up this compact card first if you still want it.
