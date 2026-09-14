# CONTRIBUTING.md

# Contributing to Ancient Chat

Thank you for your interest in contributing to **Ancient Chat**! 🎉

This document provides guidelines and instructions for contributing to the project.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
   ```bash
   git clone https://github.com/legen07/ancient_chat.git
   cd ancient_chat
   ```
3. **Install** dependencies
   ```bash
   bun install
   ```
4. **Create** a feature branch
   ```bash
   git checkout -b feat/your-feature-name
   ```

## Commit Guidelines

This project follows **[Conventional Commits](https://www.conventionalcommits.org/)**. All commit messages must adhere to this format:

```
<type>(<scope>): <subject>
```

### Types

| Type       | Description                                |
| ---------- | ------------------------------------------ |
| `feat`     | New feature                                |
| `fix`      | Bug fix                                    |
| `docs`     | Documentation changes                      |
| `style`    | Code style changes (formatting, etc.)      |
| `refactor` | Code refactoring                           |
| `perf`     | Performance improvement                    |
| `test`     | Adding or updating tests                   |
| `build`    | Build system or dependency changes         |
| `ci`       | CI configuration changes                   |
| `chore`    | Maintenance tasks                          |
| `revert`   | Revert a previous commit                   |

### Examples

```bash
git commit -m "feat(worker): add Gemini AI response handling"
git commit -m "fix(api): resolve webhook payload parsing error"
git commit -m "docs(readme): update setup instructions"
git commit -m "test: add unit tests for Telegram webhook handler"
```

## Development Workflow

1. **Pull** the latest changes from `main`
   ```bash
   git pull origin main
   ```
2. **Create** a new branch for your feature or fix
3. **Make** your changes following the code style
4. **Add** tests for any new functionality
5. **Run** the test suite to verify everything passes
   ```bash
   bun test
   ```
6. **Lint** and format your code
   ```bash
   vp check
   ```
7. **Commit** using conventional commit format
8. **Push** to your fork and open a **Pull Request**

## Pull Request Process

1. Ensure all tests pass (`bun test`)
2. Update documentation if needed
3. Fill out the PR template completely
4. Request review from maintainers
5. Wait for CI checks to pass
6. Merge after approval

## Code Style

- Use **Bun** as the package manager
- Use **Oxlint** for linting and **Oxfmt** for formatting
- Run `vp check` before submitting
- Follow the existing code structure and patterns
- All new code must include unit tests
- Write descriptive, imperative commit messages

## Reporting Issues

- Use the issue templates provided in `.github/ISSUE_TEMPLATE/`
- Check existing issues before creating a new one
- Include reproduction steps and environment details

## Questions?

Feel free to open a discussion or reach out to the maintainers.

Thank you for contributing! 🚀
