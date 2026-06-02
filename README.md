# laraboxs Windows MVP

laraboxs is an original Windows-first local development environment manager for PHP and Laravel projects. It is inspired by the category of local dev managers, but this codebase uses its own name, UI, assets, and implementation.

## What Works Now

- TypeScript CLI with the requested MVP commands.
- JSON config storage under `%USERPROFILE%\.config\laraboxs`.
- Parked folder discovery for Laravel, PHP, and static projects.
- Hosts file block generation and syncing.
- Nginx main and per-site config generation.
- PHP global version selection and per-site isolation.
- MySQL `my.ini`, local-only binding, command specs, status probing, generated root password storage, and Laravel `.env` output.
- Local helper API for the React dashboard.
- React dashboard for Sites, PHP, MySQL, SSL, Logs, and Settings.
- Tauri v2 wrapper scaffold.
- Vitest coverage for site detection, hosts merging, Nginx config, and MySQL command logic.

## Quick Start

```powershell
npm install
npm run test
npm run build
npm run api
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

For the CLI:

```powershell
npm run cli -- sites
npm run cli -- park C:\www --dry-run-hosts
npm run cli -- mysql:status
```

After `npm run build`, `npm link` exposes `laraboxs` from this workspace.

## Notes

Rust/Cargo are required to run the Tauri desktop wrapper. They were not available in the current environment, so the wrapper is scaffolded but not compiled here. The browser dashboard is the verified MVP surface; packaged Tauri startup still needs a native helper-service launcher.

See [docs/usage.md](docs/usage.md) and [docs/architecture.md](docs/architecture.md).
