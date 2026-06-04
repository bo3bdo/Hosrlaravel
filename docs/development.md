# Development Guide

This guide explains how to work on laraboxs as an open-source project.

## Setup

Install dependencies:

```powershell
npm install
```

Run the full local validation suite:

```powershell
npm run check
```

The project is Windows-first. Some tests use temporary `LARABOXS_HOME` and `LARABOXS_HOSTS_FILE` values so they do not touch your real app data or hosts file.

## Daily Workflow

Run the helper API:

```powershell
npm run api
```

Run the dashboard:

```powershell
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

Run the CLI during development:

```powershell
npm run cli -- sites
npm run cli -- paths
```

Build and link the CLI:

```powershell
npm run build
npm link
laraboxs sites
```

## Quality Checks

Use the narrowest command while iterating, then run the full check before opening a pull request.

```powershell
npm run typecheck
npm run test
npm run build
npm run check
```

Clean generated files:

```powershell
npm run clean
```

## Development Environment Variables

- `LARABOXS_HOME`: Override the app data directory.
- `LARABOXS_HOSTS_FILE`: Override the hosts file path for tests or safe dry runs.
- `LARABOXS_API_PORT`: Override the helper API port. Default: `47899`.
- `LARABOXS_HELPER_TOKEN`: Require dashboard/API requests to include `X-Laraboxs-Token`.
- `LARABOXS_SECRET_FALLBACK=1`: Use portable local secret files instead of Windows DPAPI.
- `LARABOXS_SKIP_CA_TRUST=1`: Skip certificate trust changes in tests.
- `LARABOXS_SKIP_PATH_UPDATE=1`: Skip user PATH updates in tests.
- `LARABOXS_SKIP_DEFENDER_EXCLUSION=1`: Skip Windows Defender exclusion attempts.
- `LARABOXS_PREVIEW_BROWSER`: Override the browser executable used for site previews.
- `LARABOXS_DESKTOP_EXE`: Override the desktop executable path used by startup settings.

## Coding Guidelines

- Keep shared behavior in `src/core` so the dashboard and CLI stay consistent.
- Keep API handlers thin. Validate input, call core modules, and return explicit JSON payloads.
- Prefer typed request/response shapes over unstructured objects.
- Keep Windows service, certificate, hosts, and runtime mutations explicit and user-visible.
- Avoid passing secrets in command-line arguments. Use environment variables or secret storage where possible.
- Add or update tests when changing service command generation, config migration, API security, SSL, hosts, runtime installs, or CLI parsing.
- Keep dashboard copy concise and action-oriented. The app is an operational tool, not a marketing page.

## Testing Strategy

The Vitest suite covers:

- API host/origin/token checks.
- CLI parsing and command surfaces.
- Hosts file managed block generation.
- Nginx config generation.
- PHP version and settings logic.
- MySQL/MariaDB commands, config, ports, and password handling.
- Redis and phpMyAdmin integration.
- Runtime installer status and command behavior.
- SSL certificate and trust flow logic.
- Site discovery and site open behavior.
- Logging and local tool helpers.

When adding a new feature, test the core module first. Add API or UI tests only when the behavior is not fully covered at the core layer.

## Release Preparation

Before a release:

```powershell
npm run check
npm run package:preview
```

For Tauri resources:

```powershell
npm run build
npm run package:tauri-resources
```

Release-grade desktop packaging still needs:

- A hardened native helper service.
- Signed installer and binaries.
- A clear update channel.
- Runtime download verification with checksums where upstreams provide stable hashes.
- Manual smoke testing on a clean Windows machine.

## Pull Request Checklist

- The change is scoped to one clear problem or feature.
- `npm run check` passes.
- New behavior has tests or a documented reason tests were not practical.
- User-facing copy and docs are updated when behavior changes.
- Screenshots are updated when dashboard changes are visible.
- No local app data, logs, build output, runtime downloads, or secrets are committed.
