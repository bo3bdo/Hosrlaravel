# laraboxs MVP Architecture

laraboxs is an original local development manager for Windows PHP projects. This repository starts with the MVP layers that can be built and tested on the current Node toolchain:

- `src/core`: config storage, site discovery, hosts rendering, Nginx config generation, PHP command resolution, MySQL service command logic, logs, and dashboard summary.
- `src/cli`: the `laraboxs` command surface.
- `src/api`: a localhost-only helper API used by the UI. The elevated helper service phase can wrap this API after a native service host is available.
- `src/ui`: React dashboard for Sites, PHP, MySQL, SSL, Logs, and Settings.
- `src-tauri`: Tauri v2 wrapper scaffold. It requires Rust/Cargo to run or build.

The helper API listens on `127.0.0.1` and the generated Nginx/MySQL configs bind services to `127.0.0.1`. Passwords use Windows DPAPI when available, with a portable fallback for development and tests.

## MVP Boundaries

The current implementation generates configs and service commands, and starts bundled binaries when they exist in the laraboxs data directory or are available on `PATH`. It does not yet download or bundle Nginx, PHP, or MySQL installers. Real certificate authority trust installation is marked for the SSL phase; the current SSL command writes self-signed per-site PEM files and updates site state/config generation.
