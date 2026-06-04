# laraboxs

laraboxs is a Windows-first local development manager for PHP and Laravel projects. It provides a desktop-style dashboard, a localhost helper API, and a CLI for managing sites, Nginx, PHP, MySQL/MariaDB, Redis, phpMyAdmin, SSL certificates, logs, and development runtimes from one workspace.

The project is original open-source software. It is inspired by the broader category of local development managers, but it uses its own name, implementation, UI, and assets.

## Screenshots

![Site entry settings](docs/screenshots/site-entry-settings.png)

![Nginx settings](docs/screenshots/nginx-settings.png)

![PHP settings](docs/screenshots/php-settings.png)


## Features

- React dashboard for sites, services, tools, logs, settings, and first-run setup.
- TypeScript CLI exposed as `laraboxs` after a production build and `npm link`.
- Parked folder discovery for Laravel, PHP, and static projects.
- Nginx configuration generation with per-site entry/document-root paths.
- Global and per-site PHP version selection with FastCGI worker management.
- Generated `php.ini` settings and Laravel-friendly extension controls.
- MySQL 9.7, MySQL 8.4, MySQL 8.0, and MariaDB 11.8.6 runtime support.
- Database initialization, root password management, port selection, database creation, and Laravel `.env` output.
- Redis install and local start/stop/restart controls.
- App-local phpMyAdmin exposed at `phpmyadmin.test`.
- Local CA generation, per-site HTTPS certificates, and explicit Windows trust flow.
- Localhost-only helper API with trusted host/origin checks and optional helper token support.
- Tauri v2 desktop wrapper scaffold and Windows helper-service scripts.
- Vitest coverage for API security, CLI parsing, hosts merging, runtime installs, service logic, SSL, logs, and site detection.

## Requirements

- Windows 10 or newer.
- Node.js 22 or newer for development.
- npm 10 or newer.
- PowerShell 5.1 or newer.
- Administrator privileges for hosts file writes, service installation, and certificate trust prompts.
- Rust and Cargo only when running or packaging the Tauri desktop wrapper.

Runtime packages for PHP, MySQL/MariaDB, Nginx, Redis, Node.js, Composer, and phpMyAdmin are downloaded into the laraboxs app data directory when installed through the app or CLI.

## Quick Start

```powershell
npm install
npm run check
npm run api
npm run dev
```

Open `http://127.0.0.1:5173`.

For a built single-server run:

```powershell
npm run build
npm start
```

Open `http://127.0.0.1:47899`.

On first launch, choose a sites folder and database runtime. laraboxs can install the default PHP runtime, selected database runtime, Nginx, Composer, Node.js, and phpMyAdmin into `%USERPROFILE%\.config\laraboxs`.

## CLI Examples

```powershell
npm run build
npm link

laraboxs sites
laraboxs park C:\www --dry-run-hosts
laraboxs site:entry my-app.test public
laraboxs use 8.5
laraboxs isolate 8.4 my-app.test
laraboxs secure my-app.test
laraboxs ssl:trust
laraboxs mysql:status
laraboxs mysql:init
laraboxs mysql:create-db app_name
laraboxs mysql:env app_name
laraboxs redis:start
laraboxs phpmyadmin:install --dry-run-hosts
laraboxs install php 8.5
laraboxs install mysql mariadb-11.8.6
laraboxs install redis
```

## Project Layout

```text
src/core      Shared domain logic for config, sites, runtimes, services, SSL, logs, and tools.
src/api       Localhost helper API used by the dashboard.
src/cli       Command-line interface.
src/ui        React dashboard.
src-tauri     Tauri v2 desktop wrapper scaffold.
scripts       Windows packaging and helper-service scripts.
tests         Vitest test suite.
docs          Usage, architecture, development notes, and screenshots.
```

## Development

Common commands:

```powershell
npm run typecheck
npm run test
npm run build
npm run check
npm run clean
```

Local development usually uses two processes:

```powershell
npm run api
npm run dev
```

The Vite dev server proxies `/api` calls to the helper API on `127.0.0.1:47899`. Production mode builds the dashboard into `dist-ui` and serves both the API and dashboard from the helper process.

Read [docs/development.md](docs/development.md) for contribution workflow, test strategy, architecture rules, and release preparation.

## Documentation

- [Usage Guide](docs/usage.md)
- [Architecture](docs/architecture.md)
- [Development Guide](docs/development.md)
- [Security Policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Current Status

The browser dashboard, helper API, CLI, runtime installer logic, and tests are the most mature surfaces. The Tauri wrapper is scaffolded and wired to the same dashboard, but production desktop packaging still needs continued native helper-service hardening and release signing work.

## License

laraboxs is released under the [MIT License](LICENSE).
