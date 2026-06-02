# laraboxs MVP Usage

laraboxs stores user data under `%USERPROFILE%\.config\laraboxs` by default. Set `LARABOXS_HOME` to use another location.

## CLI

```powershell
npm install
npm run build
npm link

laraboxs park C:\www --dry-run-hosts
laraboxs sites
laraboxs use 8.4
laraboxs isolate 8.5 my-app.test
laraboxs secure my-app.test
laraboxs start
laraboxs mysql:status
laraboxs mysql:create-db app_name
```

Hosts file writes require an elevated shell. Use `--dry-run-hosts` to preview the managed block.

## UI

Run the helper API and dashboard:

```powershell
npm run api
npm run dev
```

Open `http://127.0.0.1:5173`.

## Runtime Placement

The MVP generates configuration and starts services when the matching binaries are present:

- Nginx: `%USERPROFILE%\.config\laraboxs\services\nginx\nginx.exe`
- PHP: `%USERPROFILE%\.config\laraboxs\runtimes\php\8.4\php.exe`
- MySQL: `%USERPROFILE%\.config\laraboxs\services\mysql\8.4\bin\mysqld.exe`

All generated service configs bind to `127.0.0.1`.

## Desktop Wrapper

The Tauri wrapper is scaffolded and uses the same React dashboard. For development, start the helper API separately with `npm run api` before opening the UI. A production desktop build still needs a native helper-service launcher and bundled runtime strategy.
