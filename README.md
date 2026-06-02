# laraboxs Windows

laraboxs is an original Windows-first local development environment manager for PHP and Laravel projects. It is inspired by the category of local dev managers, but this codebase uses its own name, UI, assets, and implementation.

## What Works Now

- TypeScript CLI for sites, runtimes, services, logs, PHP settings, MySQL/MariaDB, Redis, and phpMyAdmin.
- JSON config storage under `%USERPROFILE%\.config\laraboxs`.
- Parked folder discovery for Laravel, PHP, and static projects.
- Hosts file block generation and syncing.
- Nginx main and per-site config generation, including editable per-site entry/document-root paths.
- PHP global version selection, per-site isolation, FastCGI workers, generated `php.ini`, and Laravel-friendly extension/settings controls.
- MySQL and MariaDB `my.ini`, local-only binding, side-by-side MySQL 9.7/8.4/8.0 and MariaDB 11.8.6 runtime support, per-runtime data directories, data-dir initialization command, status probing, generated root password storage, password reset/change, port selection, database creation command, and Laravel `.env` output.
- Redis runtime install and app-local start/stop/restart controls.
- App-local phpMyAdmin install exposed at `phpmyadmin.test`.
- First-run desktop setup for choosing a sites folder, choosing MySQL or MariaDB, and automatically installing PHP 8.5, the selected database runtime, Nginx, Composer, Node.js, and phpMyAdmin into laraboxs app data.
- Local helper API for the React dashboard.
- React dashboard for Sites, Nginx, PHP, MySQL/MariaDB, Redis, phpMyAdmin, Logs, Settings, and inline per-site SSL toggles.
- Local SSL CA generation, CA-signed per-site certificates, SSL trust status, and an explicit Windows trust command/prompt.
- Windows helper service install/status/uninstall scripts.
- Tauri v2 wrapper scaffold.
- Vitest coverage for site detection, hosts merging, Nginx config, CLI parsing, runtime installs, logs, PHP settings, MySQL, Redis, and phpMyAdmin logic.

## Quick Start

```powershell
npm install
npm run test
npm run build
npm run api
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

For a built single-server run:

```powershell
npm run build
npm start
```

Open [http://127.0.0.1:47899](http://127.0.0.1:47899).

On first launch, choose a sites folder and database runtime. laraboxs installs the default PHP, selected database, Nginx, Composer, and Node.js stack automatically.

For the CLI:

```powershell
npm run cli -- sites
npm run cli -- park C:\www --dry-run-hosts
npm run cli -- mysql:status
npm run cli -- site:entry my-app.test public
npm run cli -- mysql:init
npm run cli -- mysql:env app_name
npm run cli -- mysql:use 9.7
npm run cli -- mysql:use mariadb-11.8.6
npm run cli -- mysql:password
npm run cli -- php-fcgi:status
npm run cli -- php:settings
npm run cli -- ssl:status
npm run cli -- ssl:trust
npm run cli -- redis:status
npm run cli -- phpmyadmin:status
npm run cli -- install php 8.4
npm run cli -- install mysql 9.7
npm run cli -- install mysql mariadb-11.8.6
npm run cli -- install redis
npm run cli -- install node
npm run cli -- install composer
```

After `npm run build`, `npm link` exposes `laraboxs` from this workspace.

## Notes

Rust/Cargo are required to run the Tauri desktop wrapper. They were not available in the current environment, so the wrapper is scaffolded but not compiled here. The browser dashboard and built single-server mode are the verified surfaces; packaged Tauri startup still needs a native helper-service launcher.

See [docs/usage.md](docs/usage.md) and [docs/architecture.md](docs/architecture.md).
