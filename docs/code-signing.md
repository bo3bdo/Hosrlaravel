# Windows Code Signing

laraboxs supports Authenticode signing for the desktop app, native helper service, and NSIS installer.

## Requirements

- A valid **Code Signing** certificate installed in the Windows certificate store
  - EV certificate recommended for immediate SmartScreen reputation
  - Standard OV certificate works but may require reputation building
- **Windows SDK** (`signtool.exe`) or Visual Studio Build Tools
- Certificate thumbprint (SHA1)

## Quick Setup

```powershell
# 1. Install your .pfx into Current User > Personal (or use certmgr.msc)
# 2. Copy the certificate SHA1 thumbprint
$env:WINDOWS_CERTIFICATE_THUMBPRINT = "YOUR_CERT_THUMBPRINT"
$env:WINDOWS_TIMESTAMP_URL = "http://timestamp.digicert.com"

# 3. Generate a Tauri signing override
npm run sign:configure

# 4. Build and sign
npm run build
cargo build --release --manifest-path helper-service/Cargo.toml
npm run tauri build -- --config src-tauri/tauri.signing.json
npm run sign:artifacts
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `WINDOWS_CERTIFICATE_THUMBPRINT` | SHA1 thumbprint of the signing certificate |
| `WINDOWS_TIMESTAMP_URL` | RFC 3161 timestamp server (default: DigiCert) |
| `SIGNTOOL_PATH` | Optional explicit path to `signtool.exe` |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater signing key (separate from Authenticode) |

## What Gets Signed

When `WINDOWS_CERTIFICATE_THUMBPRINT` is set:

1. **Tauri build** signs `laraboxs.exe` and the NSIS installer via `certificateThumbprint`
2. **`sign-windows-artifacts.ps1`** additionally signs:
   - `laraboxs-helper-svc.exe`
   - Any `.exe` installers under `src-tauri/target/release/bundle/nsis/`

## CI / Release Pipeline

```yaml
- name: Configure signing
  shell: pwsh
  env:
    WINDOWS_CERTIFICATE_THUMBPRINT: ${{ secrets.WINDOWS_CERT_THUMBPRINT }}
  run: npm run sign:configure

- name: Build desktop bundle
  run: npm run tauri build -- --config src-tauri/tauri.signing.json

- name: Sign helper service
  shell: pwsh
  env:
    WINDOWS_CERTIFICATE_THUMBPRINT: ${{ secrets.WINDOWS_CERT_THUMBPRINT }}
  run: npm run sign:artifacts
```

Store the certificate as a secure secret or use Azure Key Vault / DigiCert KeyLocker with `signtool`.

## Native Helper Service

The installer registers `laraboxs-helper-svc.exe` as the `LaraboxsHelper` Windows service. This native supervisor:

- Starts and monitors the Node helper API
- Restarts the API after unexpected exits
- Handles graceful shutdown on service stop

Manual install (development):

```powershell
npm run build
cargo build --release --manifest-path helper-service/Cargo.toml
npm run package:tauri-resources
npm run helper:native:install
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `signtool.exe not found` | Install Windows SDK 10+ or set `SIGNTOOL_PATH` |
| `No certificates were found` | Import the `.pfx` into `Cert:\CurrentUser\My` |
| SmartScreen warning | Normal for new certificates; reputation builds over time |
| Tauri skips signing | Run `npm run sign:configure` before `tauri build` |

## Security Notes

- Never commit `.pfx` files, thumbprints tied to production certs, or `tauri.signing.json` with real values
- `tauri.signing.json` is gitignored and generated locally/CI-only
- Rotate certificates before expiry and re-sign all distributed artifacts
