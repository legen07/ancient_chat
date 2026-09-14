# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project setup with Cloudflare Workers
- Telegram bot webhook integration
- Google Gemini AI-powered customer support
- Markdown to HTML conversion for Telegram
- Vitest test suite with Cloudflare Workers pool
- Vite+ development configuration
- Environment-based API key management

## [0.1.0] - 2026-09-09

### Added

- Initial release of Ancient Chat
- Telegram bot webhook handling (`/api/webhook/`)
- Gemini AI integration (`/api/webhook/` asks Gemini)
- Telegram bot initialization (`/api/init/`)
- Webhook setup/listen (`/api/listen`)
- Webhook deletion (`/api/deleteWebhook/`)
- Markdown-to-HTML conversion for Telegram compatibility
- Basic Vitest test coverage
- Cloudflare Workers configuration via Wrangler
- `.gitignore` with comprehensive exclusions
- Project documentation (README, LICENSE)

### Changed

- Migrated from markdown rendering to Telegram-compatible HTML
- Configured Cloudflare Workers observability and source maps
- Added `nodejs_compat` compatibility flag

### Fixed

- Resolved webhook URL configuration issues
- Improved error handling in Gemini API responses

### Removed

- Legacy markdown-based response handling
- Unused HTTP hosting files

## [0.0.1] - Initial Commit

### Added

- Initial project structure
- Worker source code (`src/index.js`)
- Wrangler configuration (`wrangler.jsonc`)
- Vite and Vitest configuration files
- `.gitignore` with standard Node.js exclusions
- `.vscode` workspace settings
- `.editorconfig` for consistent editor formatting
