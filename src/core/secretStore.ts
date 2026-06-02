import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { getPaths } from "./paths.js";

const execFileAsync = promisify(execFile);

export async function saveSecret(key: string, value: string): Promise<void> {
  const secretPath = secretFile(key);
  await mkdir(path.dirname(secretPath), { recursive: true });

  if (process.platform === "win32") {
    try {
      await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$secure = ConvertTo-SecureString -String $env:LARABOXS_SECRET_VALUE -AsPlainText -Force; " +
            "$encrypted = ConvertFrom-SecureString -SecureString $secure; " +
            "Set-Content -LiteralPath $env:LARABOXS_SECRET_PATH -Value $encrypted -Encoding UTF8"
        ],
        {
          env: {
            ...process.env,
            LARABOXS_SECRET_PATH: secretPath,
            LARABOXS_SECRET_VALUE: value
          }
        }
      );
      return;
    } catch {
      // Fall through to the portable development fallback.
    }
  }

  await writeFile(secretPath, `fallback:${Buffer.from(value, "utf8").toString("base64")}`, "utf8");
}

export async function readSecret(key: string): Promise<string | undefined> {
  const secretPath = secretFile(key);
  if (!existsSync(secretPath)) {
    return undefined;
  }

  const raw = await readFile(secretPath, "utf8");
  if (raw.startsWith("fallback:")) {
    return Buffer.from(raw.slice("fallback:".length).trim(), "base64").toString("utf8");
  }

  if (process.platform === "win32") {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$encrypted = Get-Content -LiteralPath $env:LARABOXS_SECRET_PATH -Raw; " +
          "$secure = ConvertTo-SecureString -String $encrypted.Trim(); " +
          "$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); " +
          "try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }"
      ],
      {
        env: {
          ...process.env,
          LARABOXS_SECRET_PATH: secretPath
        }
      }
    );
    return stdout.trimEnd();
  }

  return undefined;
}

export async function ensureSecret(key: string, factory: () => string): Promise<string> {
  const existing = await readSecret(key);
  if (existing) {
    return existing;
  }

  const next = factory();
  await saveSecret(key, next);
  return next;
}

function secretFile(key: string): string {
  const safeKey = key.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
  return path.join(getPaths().home, "secrets", `${safeKey}.secret`);
}
