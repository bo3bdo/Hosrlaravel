# Usage Guide

This guide covers local development, the dashboard, the CLI, runtime placement, and Windows-specific actions.

## App Data

laraboxs stores user data under:

```text
%USERPROFILE%\.config\laraboxs
```

Set `LARABOXS_HOME` to use another location:

```powershell
$env:LARABOXS_HOME = "C:\Temp\laraboxs-dev-home"
```

Generated hosts file changes target the real Windows hosts file by default. For development tests, set `LARABOXS_HOSTS_FILE` to a temporary file.

## Dashboard

Start the helper API and Vite dashboard:

```powershell
npm run api
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

For production-style local hosting:

```powershell
npm run build
npm start
```

Open:

```text
http://127.0.0.1:47899
```

On first launch, the setup flow asks for a sites folder and database runtime. The dashboard can then install the default PHP, selected database runtime, Nginx, Composer, Node.js, and phpMyAdmin stack into laraboxs app data.

## CLI

Build and link the CLI:

```powershell
npm install
npm run build
npm link
```

Useful commands:

```powershell
laraboxs sites
laraboxs park C:\www --dry-run-hosts
laraboxs paths
laraboxs open my-app.test

laraboxs site:entry my-app.test public
laraboxs site:entry:reset my-app.test

laraboxs use 8.5
laraboxs isolate 8.4 my-app.test
laraboxs unisolate my-app.test
laraboxs which-php
laraboxs php -v

laraboxs start
laraboxs stop
laraboxs restart
laraboxs logs

laraboxs secure my-app.test
laraboxs unsecure my-app.test
laraboxs ssl:status
laraboxs ssl:trust

laraboxs mysql:status
laraboxs mysql:init
laraboxs mysql:start
laraboxs mysql:stop
laraboxs mysql:restart
laraboxs mysql:port --auto
laraboxs mysql:use 9.7
laraboxs mysql:use mariadb-11.8.6
laraboxs mysql:create-db app_name
laraboxs mysql:env app_name
laraboxs mysql:password
laraboxs mysql:reset-password
laraboxs mysql:change-password "new-secure-password"

laraboxs redis:status
laraboxs redis:start
laraboxs redis:stop
laraboxs redis:restart
laraboxs redis:port --auto

laraboxs php:settings
laraboxs php:settings:set memory_limit=512M upload_max_filesize=128M post_max_size=128M extensions=curl,mbstring,openssl,pdo_mysql

laraboxs phpmyadmin:status
laraboxs phpmyadmin:install --dry-run-hosts

laraboxs runtimes
laraboxs install php 8.5
laraboxs install mysql 9.7
laraboxs install mysql mariadb-11.8.6
laraboxs install nginx
laraboxs install redis
laraboxs install node
laraboxs install composer
laraboxs uninstall redis
```

Hosts file writes require an elevated shell. Use `--dry-run-hosts` when you want to preview the managed block before writing.

## Sites

Park a folder that contains projects:

```powershell
laraboxs park C:\www --dry-run-hosts
```

laraboxs discovers direct child folders and assigns domains using the configured TLD. For example, `C:\www\store` becomes `store.test`.

Default entry paths:

- Laravel: `public`
- PHP: `.`
- Static: `.`

Change a site entry path:

```powershell
laraboxs site:entry store.test public
```

Reset it:

```powershell
laraboxs site:entry:reset store.test
```

## Runtime Placement

Runtimes are installed inside app data:

- Nginx: `%USERPROFILE%\.config\laraboxs\services\nginx\nginx.exe`
- PHP: `%USERPROFILE%\.config\laraboxs\runtimes\php\8.5\php.exe`
- MySQL 9.7: `%USERPROFILE%\.config\laraboxs\services\mysql\9.7\bin\mysqld.exe`
- MySQL 8.4: `%USERPROFILE%\.config\laraboxs\services\mysql\8.4\bin\mysqld.exe`
- MySQL 8.0: `%USERPROFILE%\.config\laraboxs\services\mysql\8.0\bin\mysqld.exe`
- MariaDB 11.8.6: `%USERPROFILE%\.config\laraboxs\services\mariadb\11.8.6\bin\mysqld.exe`
- Redis: `%USERPROFILE%\.config\laraboxs\services\redis\8.8\redis-server.exe`
- Node.js: `%USERPROFILE%\.config\laraboxs\runtimes\node\24.16.0\node.exe`
- Composer: `%USERPROFILE%\.config\laraboxs\runtimes\composer\composer.phar`
- phpMyAdmin: `%USERPROFILE%\.config\laraboxs\tools\phpmyadmin\5.2.3`

## HTTPS

Enable HTTPS for a site:

```powershell
laraboxs secure store.test
```

Trust the local CA:

```powershell
laraboxs ssl:trust
```

Windows will show a certificate trust prompt. Approve it only if you trust the local laraboxs development CA generated on your machine.

Use `laraboxs ssl:trust --wait` when you want the CLI to wait until the prompt closes.

## phpMyAdmin

Install phpMyAdmin:

```powershell
laraboxs phpmyadmin:install
```

It is served through generated Nginx config at:

```text
http://phpmyadmin.test
```

Use `--no-hosts` if you want to sync hosts later.

## Helper Service

Build first, then install the helper service from an elevated PowerShell:

```powershell
npm run build
npm run helper:install
Start-Service LaraboxsHelper
npm run helper:status
```

Remove it:

```powershell
npm run helper:uninstall
```

The current service wrapper uses the local Node runtime and built API server. A production release should replace this bridge with a hardened native helper service.

## Tauri Desktop Wrapper

Rust and Cargo are required for Tauri commands.

Development:

```powershell
npm run api
npm run tauri:dev
```

Prepare bundled resources after a build:

```powershell
npm run build
npm run package:tauri-resources
```

The Tauri wrapper is scaffolded, but release-grade packaging still needs native helper-service hardening, signing, and installer validation.
