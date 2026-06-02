# laraboxs Architecture

laraboxs is an original local development manager for Windows PHP projects. This repository contains the app layers that can be built and tested on the current Node toolchain:

- `src/core`: config storage, site discovery, hosts rendering, Nginx config generation, PHP command resolution/settings/FastCGI logic, MySQL, MongoDB, and Redis service command logic, phpMyAdmin integration, logs, and dashboard summary.
- `src/core/runtimes.ts`: runtime manifest and app-data installer for PHP, MySQL, MongoDB, Nginx, Redis, Node.js, and Composer.
- `src/cli`: the `laraboxs` command surface.
- `src/api`: a localhost-only helper API used by the UI. After `npm run build`, it also serves the built dashboard from `dist-ui` so a single helper process can host the app.
- `src/ui`: React dashboard for Sites, Nginx, PHP, MySQL, MongoDB, Redis, phpMyAdmin, Logs, Settings, and inline per-site SSL toggles.
- `src-tauri`: Tauri v2 wrapper scaffold. It requires Rust/Cargo to run or build.

The helper API listens on `127.0.0.1` and the generated Nginx/MySQL/MongoDB/Redis configs bind services to `127.0.0.1`. Passwords use Windows DPAPI when available, with a portable fallback for development and tests.

The Windows service scripts in `scripts/` install the built Node helper API through `sc.exe`. The built API serves both JSON endpoints and the dashboard on `127.0.0.1:47899`. This is a practical bridge for local testing, not the final native helper service.

## Current Boundaries

The current implementation generates configs and service commands, downloads selected runtimes into the laraboxs data directory, and starts binaries from app data when installed. Per-site Nginx entry paths are stored as relative paths inside each project so Laravel can default to `public` while other PHP/static projects can use `.` or a custom folder such as `web` or `dist`. MySQL 8.4 and 8.0 can be installed side by side, with one active version selected in config at a time. MongoDB is managed as an app-local `mongod.exe` runtime with localhost-only bind and app-local data/log paths. phpMyAdmin is installed app-locally and exposed through generated Nginx and hosts entries at `phpmyadmin.test`.

Per-site SSL creates a laraboxs local CA, writes CA-signed site certificate/key files with SAN entries, and updates site state/config generation. Trusting the CA is explicit: the CLI and dashboard expose a Windows CurrentUser Root trust action so the user can approve the certificate prompt instead of running a hidden import that may hang.
