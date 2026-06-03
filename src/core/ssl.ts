import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { X509Certificate } from "node:crypto";
import path from "node:path";
import selfsigned from "selfsigned";
import { updateDotEnvFile } from "./envFile.js";
import { appendLog } from "./logging.js";
import { getPaths } from "./paths.js";
import { findSite, setSiteSecurity } from "./sites.js";
import type { SslTrustStatus } from "./types.js";

const localCaCommonName = "laraboxs Local Development CA";

export async function secureSite(identifier: string): Promise<void> {
  const site = await findSite(identifier);
  await ensureSiteCertificate(site.domain);
  await setSiteSecurity(site.domain, true);
  await updateSiteAppUrl(site.path, site.domain, true);
  await appendLog("ssl", `marked ${site.domain} as secured`);
}

export async function unsecureSite(identifier: string): Promise<void> {
  const site = await findSite(identifier);
  await setSiteSecurity(site.domain, false);
  await updateSiteAppUrl(site.path, site.domain, false);
  await appendLog("ssl", `marked ${site.domain} as unsecured`);
}

export async function ensureSiteCertificate(domain: string): Promise<void> {
  const paths = getPaths();
  const certPath = path.join(paths.certs, `${domain}.crt`);
  const keyPath = path.join(paths.certs, `${domain}.key`);
  if (existsSync(certPath) && existsSync(keyPath) && (await siteCertificateMatchesLocalCa(certPath))) {
    return;
  }

  await issueCertificate(domain);
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

  const userStoreTrusted = await isLocalCaTrustedInStore("CurrentUser");
  if (userStoreTrusted && !isWindowsServiceAccount()) {
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

  if (userStoreTrusted) {
    return {
      certPath,
      keyPath,
      exists: true,
      trusted: false,
      platform: process.platform,
      store: "CurrentUser\\Root",
      message: `Local CA is trusted only for ${currentWindowsAccountLabel()}. Trust it in LocalMachine Root so browsers can use it.`
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

async function issueCertificate(domain: string): Promise<void> {
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

async function updateSiteAppUrl(sitePath: string, domain: string, secured: boolean): Promise<void> {
  const envPath = path.join(sitePath, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  await updateDotEnvFile(envPath, {
    APP_URL: `${secured ? "https" : "http"}://${domain}`
  });
  await appendLog("ssl", `updated ${domain} APP_URL for ${secured ? "https" : "http"}`);
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

async function siteCertificateMatchesLocalCa(certPath: string): Promise<boolean> {
  try {
    const [siteCertificateRaw, caCertificateRaw] = await Promise.all([readFile(certPath, "utf8"), readFile(localCaCertPath(), "utf8")]);
    const siteCertificate = new X509Certificate(siteCertificateRaw);
    const caCertificate = new X509Certificate(caCertificateRaw);
    return siteCertificate.issuer === caCertificate.subject && siteCertificate.verify(caCertificate.publicKey);
  } catch {
    return false;
  }
}

async function runVisibleTrustCommand(caCertPath: string, wait: boolean): Promise<number> {
  const scriptPath = await writeTrustLocalCaScript(caCertPath);
  await appendLog("ssl", "requesting LocalMachine Root trust for local CA");

  const directCode = await runPowerShellScript(scriptPath);
  if (directCode === 0) {
    return 0;
  }

  return runElevatedPowerShell(scriptPath, wait);
}

async function writeTrustLocalCaScript(caCertPath: string): Promise<string> {
  const scriptPath = path.join(getPaths().home, "trust-local-ca-elevated.ps1");
  await mkdir(getPaths().home, { recursive: true });
  await writeFile(
    scriptPath,
    [
      '$ErrorActionPreference = "Stop"',
      `$certPath = '${escapePowerShellString(caCertPath)}'`,
      "$cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($certPath)",
      "$store = $null",
      "try {",
      "  $store = New-Object Security.Cryptography.X509Certificates.X509Store('Root', [Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine)",
      "  $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)",
      "  $alreadyTrusted = $false",
      "  foreach ($item in $store.Certificates) { if ($item.Thumbprint -eq $cert.Thumbprint) { $alreadyTrusted = $true; break } }",
      "  if (-not $alreadyTrusted) { $store.Add($cert) }",
      "} finally {",
      "  if ($store -ne $null) { $store.Close() }",
      "}",
      "Write-Host 'laraboxs local CA trusted in LocalMachine Root.'"
    ].join("\n"),
    "utf8"
  );
  return scriptPath;
}

function runPowerShellScript(scriptPath: string): Promise<number> {
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    stdio: "ignore",
    shell: false,
    windowsHide: true
  });

  return new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function runElevatedPowerShell(scriptPath: string, wait: boolean): Promise<number> {
  const processArgs = "@('-NoProfile','-ExecutionPolicy','Bypass','-File',$script)";
  const command = wait
    ? [
        `$script = '${escapePowerShellString(scriptPath)}'`,
        `$process = Start-Process -FilePath powershell.exe -ArgumentList ${processArgs} -Verb RunAs -Wait -PassThru -WindowStyle Hidden`,
        "exit $process.ExitCode"
      ].join("; ")
    : [
        `$script = '${escapePowerShellString(scriptPath)}'`,
        `Start-Process -FilePath powershell.exe -ArgumentList ${processArgs} -Verb RunAs -WindowStyle Hidden`,
        "exit 0"
      ].join("; ");

  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    stdio: "ignore",
    shell: false,
    windowsHide: true
  });

  if (!wait) {
    child.once("error", () => undefined);
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

function isWindowsServiceAccount(): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  const username = (process.env.USERNAME ?? "").toUpperCase();
  const userProfile = (process.env.USERPROFILE ?? "").toLowerCase();
  return username === "SYSTEM" || username === "LOCAL SERVICE" || username === "NETWORK SERVICE" || userProfile.includes("\\system32\\config\\systemprofile");
}

function currentWindowsAccountLabel(): string {
  const domain = process.env.USERDOMAIN;
  const username = process.env.USERNAME;
  return [domain, username].filter(Boolean).join("\\") || "the helper service account";
}

function escapePowerShellString(value: string): string {
  return value.replace(/'/g, "''");
}
