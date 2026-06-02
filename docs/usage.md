# laraboxs Usage

laraboxs stores user data under `%USERPROFILE%\.config\laraboxs` by default. Set `LARABOXS_HOME` to use another location.

## CLI

```powershell
npm install
npm run build
npm link

laraboxs park C:\www --dry-run-hosts
laraboxs sites
laraboxs site:entry my-app.test public
laraboxs site:entry:reset my-app.test
laraboxs use 8.4
laraboxs isolate 8.5 my-app.test
laraboxs secure my-app.test
laraboxs ssl:status
laraboxs ssl:trust
laraboxs start
laraboxs mysql:status
laraboxs mysql:init
laraboxs mysql:use 8.0
laraboxs mysql:port --auto
laraboxs mysql:create-db app_name
laraboxs mysql:env app_name
laraboxs mysql:password
laraboxs mysql:change-password "new-secure-password"
laraboxs mongodb:status
laraboxs mongodb:start
laraboxs mongodb:port --auto
laraboxs redis:status
laraboxs redis:start
laraboxs php-fcgi:status
laraboxs php:settings
laraboxs php:settings:set memory_limit=512M upload_max_filesize=128M post_max_size=128M extensions=curl,mbstring,openssl,pdo_mysql
laraboxs phpmyadmin:status
laraboxs phpmyadmin:install --dry-run-hosts
```

Hosts file writes require an elevated shell. Use `--dry-run-hosts` to preview the managed block.

## UI

Run the helper API and dashboard:

```powershell
npm run api
npm run dev
```

Open `http://127.0.0.1:5173`.

After a production build, the helper API also serves the built dashboard:

```powershell
npm run build
npm start
```

Open `http://127.0.0.1:47899`.

Use the Setup section first. It installs selected PHP versions, MySQL versions, MongoDB, Nginx, Redis, Node.js, and Composer into `%USERPROFILE%\.config\laraboxs` so users do not need to install runtimes manually.

The Sites section includes a Nginx Entry panel for each site. Laravel projects default to `public`; PHP/static projects default to `.`. Set a relative entry such as `public`, `web`, or `dist`, then save to regenerate per-site Nginx configs. The CLI equivalent is `laraboxs site:entry <site> <entry>`, or `laraboxs site:entry <entry>` from inside a parked site.

CLI equivalents:

```powershell
laraboxs install php 8.4
laraboxs install php 8.5
laraboxs install mysql 8.4
laraboxs install mysql 8.0
laraboxs install mongodb
laraboxs install redis
laraboxs install node
laraboxs install composer
laraboxs install --force php 8.4
laraboxs uninstall mongodb
laraboxs uninstall redis
laraboxs runtimes
```

phpMyAdmin installs into laraboxs app data and is served through Nginx at `http://phpmyadmin.test`. Run `laraboxs phpmyadmin:install` to install it and sync hosts, or add `--no-hosts` when you want to sync hosts later.

## Runtime Placement

laraboxs can download runtimes into app data and starts services when the matching binaries are present:

- Nginx: `%USERPROFILE%\.config\laraboxs\services\nginx\nginx.exe`
- PHP: `%USERPROFILE%\.config\laraboxs\runtimes\php\8.4\php.exe`
- MySQL 8.4: `%USERPROFILE%\.config\laraboxs\services\mysql\8.4\bin\mysqld.exe`
- MySQL 8.0: `%USERPROFILE%\.config\laraboxs\services\mysql\8.0\bin\mysqld.exe`
- MongoDB: `%USERPROFILE%\.config\laraboxs\services\mongodb\8.2\bin\mongod.exe`
- Redis: `%USERPROFILE%\.config\laraboxs\services\redis\8.8\redis-server.exe`
- phpMyAdmin: `%USERPROFILE%\.config\laraboxs\tools\phpmyadmin\5.2.3`

All generated service configs bind to `127.0.0.1`.

Per-site HTTPS is controlled from the Sites table lock icon or with `laraboxs secure <site>` and `laraboxs unsecure <site>`. laraboxs creates a local CA under app data and signs site certificates with SAN entries for each domain. Run `laraboxs ssl:trust` or use the Sites/Nginx `Trust CA` button once, then approve the Windows certificate prompt so browsers trust generated HTTPS sites. Use `laraboxs ssl:trust --wait` only when you want the CLI to wait for that Windows prompt to close.

## Desktop Wrapper

The Tauri wrapper is scaffolded and uses the same React dashboard. For development, start the helper API separately with `npm run api` before opening the UI. After `npm run build`, `npm start` serves the built dashboard and API from the same localhost port. A production desktop build still needs Rust/Cargo for the Tauri wrapper and a bundled runtime strategy.

## Helper Service

Build first, then install the helper service from an elevated PowerShell:

```powershell
npm run build
npm run helper:install
Start-Service LaraboxsHelper
npm run helper:status
```

Remove it with:

```powershell
npm run helper:uninstall
```

This service wrapper uses the local Node runtime and the built API server, which serves both the helper API and built dashboard on `127.0.0.1:47899`. The next production phase should replace it with a native Rust/.NET service.
