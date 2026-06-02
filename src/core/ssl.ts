import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import selfsigned from "selfsigned";
import { appendLog } from "./logging.js";
import { getPaths } from "./paths.js";
import { findSite, setSiteSecurity } from "./sites.js";
import type { SslTrustStatus } from "./types.js";

const localCaCommonName = "laraboxs Local Development CA";

export async function secureSite(identifier: string): Promise<void> {
  const site = await findSite(identifier);
  await ensureCertificate(site.domain);
  await setSiteSecurity(site.domain, true);
  await appendLog("ssl", `marked ${site.domain} as secured`);
}

export async function unsecureSite(identifier: string): Promise<void> {
  await setSiteSecurity(identifier, false);
  await appendLog("ssl", `marked ${identifier} as unsecured`);
}

export async function getLocalCaStatus(): Promise<SslTrustStatus> {
  const certPath = localCaCertPath();
  const keyPath = localCaKeyPath();
  const exists = existsSync(certPath) && existsSync(keyPath);

  if (!exists) {
    return {
      certPath,
      keyPath,
      exists: false,
      trusted: false,
      platform: process.platform,
      message: "Local CA has not been created yet."
    };
  }

  if (process.platform !== "win32") {
    return {
      certPath,
      keyPath,
      exists: true,
      trusted: false,
      platform: process.platform,
      message: "Automatic CA trust is only supported on Windows."
    };
  }

  if (process.env.VITEST || process.env.NODE_ENV === "test" || process.env.LARABOXS_SKIP_CA_TRUST === "1") {
    return {
      certPath,
      keyPath,
      exists: true,
      trusted: false,
      platform: process.platform,
      message: "CA trust check skipped."
    };
  }

  const userStoreTrusted = await isLocalCaTrustedInStore("CurrentUser");
  if (userStoreTrusted) {
    return {
      certPath,
      keyPath,
      exists: true,
      trusted: true,
      platform: process.platform,
      store: "CurrentUser\\Root",
      message: "Local CA is trusted."
    };
  }

  const machineStoreTrusted = await isLocalCaTrustedInStore("LocalMachine");
  if (machineStoreTrusted) {
    return {
      certPath,
      keyPath,
      exists: true,
      trusted: true,
      platform: process.platform,
      store: "LocalMachine\\Root",
      message: "Local CA is trusted."
    };
  }

  return {
    certPath,
    keyPath,
    exists: true,
    trusted: false,
    platform: process.platform,
    message: "Local CA is not trusted yet."
  };
}

export async function trustLocalCa({ wait = false }: { wait?: boolean } = {}): Promise<SslTrustStatus> {
  await ensureLocalCa();
  const current = await getLocalCaStatus();
  if (current.trusted || process.platform !== "win32") {
    return current;
  }

  if (!wait) {
    await runVisibleTrustCommand(localCaCertPath(), false);
    await appendLog("ssl", "launched local CA trust prompt");
    return {
      ...current,
      message: "Local CA trust prompt launched."
    };
  }

  const status = await runVisibleTrustCommand(localCaCertPath(), wait);
  if (status !== 0) {
    await appendLog("ssl", `local CA trust command exited with code ${status}`);
  }

  return getLocalCaStatus();
}

async function ensureCertificate(domain: string): Promise<void> {
  const paths = getPaths();
  await mkdir(paths.certs, { recursive: true });
  const ca = await ensureLocalCa();
  const notAfterDate = new Date();
  notAfterDate.setDate(notAfterDate.getDate() + 825);
  const certificate = await selfsigned.generate(
    [
      { name: "commonName", value: domain },
      { name: "organizationName", value: "laraboxs local" }
    ],
    {
      notAfterDate,
      keySize: 2048,
      algorithm: "sha256",
      ca: {
        key: ca.key,
        cert: ca.cert
      },
      extensions: [
        { name: "basicConstraints", cA: false, critical: true },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
        { name: "extKeyUsage", serverAuth: true },
        { name: "subjectAltName", altNames: [{ type: 2, value: domain }] }
      ]
    }
  );
  await writeFile(path.join(paths.certs, `${domain}.crt`), certificate.cert, "utf8");
  await writeFile(path.join(paths.certs, `${domain}.key`), certificate.private, "utf8");
  await appendLog("ssl", `issued trusted local certificate for ${domain}`);
}

async function ensureLocalCa(): Promise<{ cert: string; key: string }> {
  const paths = getPaths();
  const caCertPath = localCaCertPath();
  const caKeyPath = localCaKeyPath();
  await mkdir(paths.certs, { recursive: true });

  if (!existsSync(caCertPath) || !existsSync(caKeyPath)) {
    const notAfterDate = new Date();
    notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);
    const ca = await selfsigned.generate(
      [
        { name: "commonName", value: localCaCommonName },
        { name: "organizationName", value: "laraboxs local" }
      ],
      {
        notAfterDate,
        keySize: 2048,
        algorithm: "sha256",
        extensions: [
          { name: "basicConstraints", cA: true, pathLenConstraint: 0, critical: true },
          { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true }
        ]
      }
    );
    await writeFile(caCertPath, ca.cert, "utf8");
    await writeFile(caKeyPath, ca.private, "utf8");
    await appendLog("ssl", `created local CA at ${caCertPath}`);
  }

  const cert = await readFile(caCertPath, "utf8");
  const key = await readFile(caKeyPath, "utf8");
  return { cert, key };
}

async function isLocalCaTrustedInStore(storeScope: "CurrentUser" | "LocalMachine"): Promise<boolean> {
  const code = await runHidden(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      [
        "$cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($env:LARABOXS_CA_CERT)",
        `$location = [Security.Cryptography.X509Certificates.StoreLocation]::${storeScope}`,
        "$store = New-Object Security.Cryptography.X509Certificates.X509Store('Root', $location)",
        "$store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)",
        "$match = $false",
        "foreach ($item in $store.Certificates) { if ($item.Thumbprint -eq $cert.Thumbprint) { $match = $true; break } }",
        "$store.Close()",
        "if ($match) { exit 0 }",
        "exit 1"
      ].join("; ")
    ],
    { LARABOXS_CA_CERT: localCaCertPath() },
    5_000
  );
  return code === 0;
}

function runVisibleTrustCommand(caCertPath: string, wait: boolean): Promise<number> {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    [
      "$cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($env:LARABOXS_CA_CERT)",
      "$store = New-Object Security.Cryptography.X509Certificates.X509Store('Root', [Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser)",
      "$store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)",
      "$store.Add($cert)",
      "$store.Close()",
      "Write-Host 'laraboxs local CA trusted in CurrentUser Root.'"
    ].join("; ")
  ];
  const child = spawn("powershell.exe", args, {
    env: { ...process.env, LARABOXS_CA_CERT: caCertPath },
    stdio: wait ? "inherit" : "ignore",
    shell: false,
    detached: !wait,
    windowsHide: false
  });

  if (!wait) {
    child.unref();
    return Promise.resolve(0);
  }

  return new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function localCaCertPath(): string {
  return path.join(getPaths().certs, "laraboxs-local-ca.crt");
}

function localCaKeyPath(): string {
  return path.join(getPaths().certs, "laraboxs-local-ca.key");
}

function runHidden(command: string, args: string[], env: Record<string, string> = {}, timeoutMs = 10_000): Promise<number> {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: "ignore",
    shell: false,
    windowsHide: true
  });

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve(1);
      }
    }, timeoutMs);
    child.once("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(1);
      }
    });
    child.once("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(code ?? 1);
      }
    });
  });
}
