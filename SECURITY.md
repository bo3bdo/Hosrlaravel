# Security Policy

laraboxs manages local development services and can write files that affect your machine, including hosts file entries, generated service configs, local certificates, and helper-service installation.

## Supported Versions

The project is pre-1.0. Security fixes target the main branch until stable release branches exist.

## Reporting A Vulnerability

Please do not report security vulnerabilities in public issues.

If this repository has GitHub private vulnerability reporting enabled, use that feature. Otherwise, contact the maintainer privately through the project owner profile and include:

- A clear description of the issue.
- Steps to reproduce.
- The affected command, API route, or UI workflow.
- Impact and any known workaround.

## Local Security Model

- The helper API binds to `127.0.0.1` by default.
- API routes validate trusted Host and Origin headers.
- The dashboard dev server and built helper process are the intended clients.
- `LARABOXS_HELPER_TOKEN` can require requests to include `X-Laraboxs-Token`.
- Generated service configs bind local services to `127.0.0.1`.
- Windows DPAPI is used for secrets when available.
- Portable secret fallback mode is intended for development and tests.
- Certificate trust is explicit and requires a Windows trust prompt.
- Hosts file writes and service installation require elevated privileges.

## Out Of Scope For Current Pre-1.0 Builds

- Multi-user server deployments.
- Exposing the helper API to a network.
- Running untrusted project code safely.
- Enterprise policy management.
- Production database or certificate management.

Do not bind the helper API, Nginx, MySQL/MariaDB, or Redis to public interfaces unless you fully understand the risks and have added your own protection.
