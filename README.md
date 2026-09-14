# Ancient Chat

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Worksers-009CFF?logo=cloudflare)](https://workers.cloudflare.com/)
[![Built with Bun](https://img.shields.io/badge/Bun-000000?logo=bun)](https://bun.sh/)
[![Vite+](https://img.shields.io/badge/Vite%2B-646CFF?logo=vite)](https://viteplus.dev/)
[![GitHub last commit](https://img.shields.io/github/last-commit/legen07/ancient_chat)](https://github.com/legen07/ancient_chat/commits/main)
[![Commits](https://img.shields.io/github/commit-activity/m/legen07/ancient_chat)](https://github.com/legen07/ancient_chat/commits/main)

A Cloudflare Workers-powered Telegram AI chat bot that leverages Google Gemini to deliver intelligent customer support. Built for speed, deployed globally, and designed for the modern web.

---

## Features

- 🤖 **AI-Powered Responses** — Google Gemini integration for smart, conversational replies
- ⚡ **Edge-Runtime Performance** — Deployed on Cloudflare Workers' global network
- 📱 **Telegram Bot Integration** — Webhook-based Telegram bot handling
- 📝 **Markdown Support** — Converts markdown messages to Telegram-compatible HTML
- 🔒 **Secure by Default** — Environment-based API key management

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Package Manager**: [Bun](https://bun.sh/)
- **Build Tool**: [Vite+](https://viteplus.dev/)
- **Testing**: [Vitest](https://vitest.dev/) + Cloudflare Workers test pool
- **Linting/Formatting**: Oxlint & Oxfmt
- **Language**: JavaScript (ES Modules)

## Quick Start

```bash
# Install dependencies
bun install

# Start local development
bun run dev

# Run tests
bun test

# Deploy to Cloudflare
bun run deploy
```

## Environment Variables

Copy `.dev.vars.example` to `.dev.vars` and fill in your keys:

```env
API_KEY=your_telegram_bot_token
GEN_KEY=your_google_generative_ai_key
```

## Scripts

| Command       | Description                          |
| ------------- | ------------------------------------ |
| `bun run dev` | Start local development server       |
| `bun test`    | Run Vitest suite                     |
| `bun run ui`  | Open Vitest UI                       |
| `bun run deploy` | Deploy to Cloudflare Workers     |

## Project Structure

```
├── src/               # Worker source code
├── test/              # Vitest test files
├── .github/           # GitHub workflows and templates
├── wrangler.jsonc     # Cloudflare Workers configuration
├── vite.config.js     # Vite+ configuration
└── vitest.config.js   # Vitest configuration
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.
