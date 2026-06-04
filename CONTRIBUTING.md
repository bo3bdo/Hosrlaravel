# Contributing

Thank you for helping improve laraboxs.

## Before You Start

- Open an issue for large changes so the direction can be discussed first.
- Keep pull requests focused. Smaller PRs are easier to review and merge.
- Use Windows for service, hosts, certificate, and runtime behavior. Some pure TypeScript work can be done elsewhere, but Windows is the target platform.

## Local Setup

```powershell
npm install
npm run check
```

For dashboard development:

```powershell
npm run api
npm run dev
```

Open `http://127.0.0.1:5173`.

## Pull Request Expectations

- Run `npm run check` before opening the PR.
- Add tests for behavior changes.
- Update docs when commands, runtime behavior, setup steps, or security boundaries change.
- Keep generated output out of commits unless it is an intentional checked-in asset.
- Include screenshots for visible dashboard changes.

## Commit Style

Use clear, imperative commit messages:

```text
Add Redis port conflict checks
Fix MySQL password reset status handling
Document Tauri resource packaging
```

## Security

Do not open public issues for vulnerabilities. Follow [SECURITY.md](SECURITY.md).
