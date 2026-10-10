# Ancient Chat

Telegram AI customer-support bot running on Cloudflare Workers. A Telegram
webhook feeds each text message into Workers AI
(`@cf/meta/llama-3.2-1b-instruct`, streamed), and the reply is streamed back
to the user as a Telegram **Rich Message**.

## Module map

- `src/index.js` — Worker entry: webhook settings page, webhook setup/delete
  endpoints, and the `/api/webhook/` handler. The handler acks Telegram with
  `ok` immediately and runs the reply in `ctx.waitUntil(...)`.
- `src/lib/ai.js` — prompt builder + `streamCompletion`/`streamTokens`: an
  async generator over the SSE stream returned by
  `env.AI.run(model, { stream: true })` (frames look like
  `data: {"response":"<token>"}`).
- `src/lib/answer.js` — the streaming pipeline and its throttling/fallbacks.
  Exports `answerMessage` and `stopGeneration`.
- `src/lib/rich.js` — sanitises model Markdown into Telegram Rich Markdown
  (GFM): closes unterminated ``` fences, strips unclosed inline markers,
  enforces the 32768-char limit, provides a plain-text fallback.
- `src/lib/telegram.js` — thin Bot API helpers (`callTelegram`,
  `sendRichMessageDraft`, `sendMessageDraft`, `sendRichMessage`,
  `sendMessage`, `validateWebhookUrl`).
- `src/pages/webhook-settings.js` — server-rendered settings page (plain HTML
  string; no bundler module rules involved).

## Invariants (do not break these)

- Private chats stream through `sendRichMessageDraft` (ephemeral ~30s
  preview, animated when `draft_id` is reused); the finished reply MUST be
  persisted with `sendRichMessage`, because drafts disappear on their own.
  Drafts are **private-chat only** — group/channel chats skip drafts and send
  the final Rich Message once.
- The "Thinking…" placeholder is `<tg-thinking>…</tg-thinking>` in the rich
  draft, or an empty-text `sendMessageDraft` as fallback.
- Draft refreshes are throttled (~800 ms, see `DRAFT_INTERVAL_MS`); passing
  `draftIntervalMs: 0` exists for tests only.
- Every rich send has a plain-text fallback (no `parse_mode`): if Telegram
  rejects the Markdown, the reply must still arrive verbatim.
- `stopped_message_generation` updates cancel in-flight generations via an
  in-memory registry — best-effort only, since the update arrives on a
  different request that may hit another Worker isolate.
- Bot API reference (Rich Messages, streaming replies): https://core.telegram.org/bots/api
  and https://core.telegram.org/bots/features#streaming-replies

## Commands

This is a **Bun project** (`packageManager: bun@1.3.14`) — drive it with
`bun`/`bunx`, not `npm`/`npx`.

| Command | Purpose |
|---------|---------|
| `bun run test` | Run the Vitest suite (package.json script; picks up `tests/**`) |
| `bun run ui` | Vitest UI |
| `bun run dev` | Local development (`wrangler dev`) |
| `bunx wrangler deploy --dry-run` | Bundle-check without deploying |
| `bun run deploy` | Deploy to Cloudflare |
| `bunx wrangler types` | Regenerate `worker-configuration.d.ts` after binding changes |

Do NOT run bare `bun test` (Bun's own runner): it also picks up
`production/*.spec.ts`, which are legacy leftovers asserting against unrelated
files outside this repo. `bun run test` goes through Vitest and is safe.

## Testing notes

- Telegram is stubbed by replacing `globalThis.fetch`; return a **fresh
  `Response` per call** — bodies are single-use and reusing one throws
  "Body already used" mid-test.
- The worker must be invoked with a `ctx` exposing `waitUntil`; capture the
  promise and await it (see `runWorker` in `tests/streaming-reply.spec.ts`)
  so background generations finish before assertions.

## Telegram Secretary Bots & Chat Automation

Detailed Telegram Secretary Bot / Secretary Mode / Chat Automation architecture, docs and
usage: [docs/telegram-chat-automation/tg-secretary-chat-automation.md](./docs/telegram-chat-automation/tg-secretary-chat-automation.md).

That file is a super-compact orientation card — for proper lookup and reference follow its
**Detailed documentation** links (Bot Features guide, Bot API reference, Bot API changelog,
official announcement, TOS §5.4) and work from those pages, never from memory or from this
AGENTS.md. Refresh the verbatim local extracts with
`python3 .telegram-docs-src/extract.py`.

# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command | Purpose |
|---------|---------|
| `npx wrangler dev` | Local development |
| `npx wrangler deploy` | Deploy to Cloudflare |
| `npx wrangler types` | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Best Practices (conditional)

If the application uses Durable Objects or Workflows, refer to the relevant best practices:

- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows: https://developers.cloudflare.com/workflows/build/rules-of-workflows/

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
