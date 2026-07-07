# Architecture

laraboxs is split into small layers so the dashboard, CLI, and future desktop package can share the same service logic.

## Layers

- `src/core`: framework detection, config storage, path resolution, hosts rendering, Nginx generation, PHP settings, FastCGI process control, MySQL/MariaDB logic, Redis logic, phpMyAdmin integration, local SSL, logs, runtime installs, site health, and update checks.
- `src/api`: localhost helper API used by the React dashboard. After `npm run build`, this process also serves the built dashboard from `dist-ui`. Route handlers live in `src/api/routes/` and are dispatched through `src/api/router.ts`.
- `src/cli`: command-line interface that calls the same core modules as the dashboard.
- `src/ui`: React dashboard built with Vite, TanStack Query, React Router, and lucide-react icons. Page components live in `src/ui/pages/`, shared UI helpers in `src/ui/shared/`, and hooks in `src/ui/hooks/`.
- `src-tauri`: Tauri v2 wrapper scaffold for a Windows desktop package.
- `helper-service`: Native Rust Windows service that supervises the Node helper API.
- `scripts`: Windows packaging, code signing, and helper-service install scripts.
- `tests`: Vitest coverage for core behavior and request security.

## Runtime Model

User data is stored under `%USERPROFILE%\.config\laraboxs` by default. Set `LARABOXS_HOME` to use a different directory during development or testing.

The app installs and runs local runtimes from app data:

- PHP: `%USERPROFILE%\.config\laraboxs\runtimes\php\<version>\php.exe`
- Nginx: `%USERPROFILE%\.config\laraboxs\services\nginx\nginx.exe`
- MySQL: `%USERPROFILE%\.config\laraboxs\services\mysql\<version>\bin\mysqld.exe`
- MariaDB: `%USERPROFILE%\.config\laraboxs\services\mariadb\<version>\bin\mysqld.exe`
- Redis: `%USERPROFILE%\.config\laraboxs\services\redis\<version>\redis-server.exe`
- Node.js: `%USERPROFILE%\.config\laraboxs\runtimes\node\<version>\node.exe`
- Composer: `%USERPROFILE%\.config\laraboxs\runtimes\composer\composer.phar`
- phpMyAdmin: `%USERPROFILE%\.config\laraboxs\tools\phpmyadmin\<version>`

Generated service configs bind to `127.0.0.1`. The default public web TLD is `.test`.

## Configuration

The main config file is `config.json` inside the laraboxs home directory. It stores:

- Setup state.
- Parked folders.
- Global PHP version.
- Per-site isolated PHP versions.
- Per-site document root entries.
- Secured domains.
- Nginx, MySQL/MariaDB, Redis, startup, and PHP settings.

Config saves create timestamped backups in the app data backup directory and keep the latest backups pruned.

## Sites

Site discovery scans parked folders and classifies projects as Laravel, generic PHP, or static. Laravel projects default their Nginx entry path to `public`; PHP and static projects default to `.`. Users can override a site entry path from the dashboard or CLI.

When Nginx configs are regenerated, laraboxs writes:

- The main `nginx.conf`.
- Per-site server blocks.
- A phpMyAdmin server block when phpMyAdmin is installed.
- HTTPS blocks for secured domains when certificates exist.

## API

The helper API listens on `127.0.0.1:47899` by default. Set `LARABOXS_API_PORT` to use another port.

The API accepts trusted loopback and Tauri origins only. It validates Host and Origin headers for `/api/*` routes and can enforce an optional `X-Laraboxs-Token` header when `LARABOXS_HELPER_TOKEN` is set.

The API exposes endpoints for:

- Dashboard summary and live updates through `GET /api/events` (Server-Sent Events).
- Runtime installation jobs.
- Site creation and per-site commands.
- Laravel `.env` profiles.
- Site workers.
- Service start/stop/restart actions.
- PHP, Nginx, MySQL/MariaDB, Redis, phpMyAdmin, SSL, logs, ports, settings, and updates.

## Secrets

Secrets such as generated database passwords are stored through Windows DPAPI when available. Tests and non-Windows development can use the portable fallback format by setting `LARABOXS_SECRET_FALLBACK=1`.

Passwords are not passed to MySQL client commands as command-line arguments. The code uses environment variables such as `MYSQL_PWD` where supported to avoid exposing passwords through process argument lists.

## Desktop And Service Packaging

The current Tauri wrapper loads the same React dashboard and bundles a prepared Node helper payload. A native Rust supervisor (`helper-service/laraboxs-helper-svc.exe`) can register as the `LaraboxsHelper` Windows service to start, monitor, and restart the Node helper API.

Release builds can be Authenticode-signed when `WINDOWS_CERTIFICATE_THUMBPRINT` is configured. See [docs/code-signing.md](code-signing.md).

The admin helper scheduled task still handles elevated hosts, CA trust, and Defender exclusions. A hardened release should add signed binaries, a stable update channel, and installer-level validation.
