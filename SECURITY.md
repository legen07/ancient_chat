# Security Policy

## Reporting a Vulnerability

We take the security of **Ancient Chat** seriously. If you believe you have found a security vulnerability, we encourage you to report it to us.

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Instead, please send an email to **[your-email@example.com](mailto:your-email@example.com)** with the subject line `Security Vulnerability — Ancient Chat`.

## What to Include

- A description of the vulnerability
- Steps to reproduce the issue
- Any relevant log files or output
- The version of the project affected
- Any proposed fix or mitigation steps

## Response Timeline

- **Acknowledgment**: We will acknowledge receipt within 48 hours.
- **Investigation**: We will investigate the reported vulnerability within 7 days.
- **Resolution**: We will work to resolve the issue as quickly as possible and provide a patch.
- **Disclosure**: After a fix is released, we will publish a security advisory.

## Security Practices

- API keys and sensitive credentials are managed via environment variables (`.dev.vars`)
- `.dev.vars` is listed in `.gitignore` and will never be committed to the repository
- The project follows least-privilege principles for API access
- Dependencies are kept up to date and monitored for known vulnerabilities
- Cloudflare Workers provides built-in DDoS protection and rate limiting

## Responsible Disclosure

We appreciate the efforts of security researchers in helping keep our project and users safe. We are committed to working with the researcher to understand and resolve the issue promptly and responsibly.
