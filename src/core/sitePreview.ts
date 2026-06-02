import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { laraboxsHome } from "./paths.js";
import { findSite } from "./sites.js";

const previewMaxAgeMs = 5 * 60 * 1000;

export interface SitePreviewImage {
  filePath: string;
  updatedAt: Date;
}

export async function getSitePreviewImage(identifier: string, options: { refresh?: boolean } = {}): Promise<SitePreviewImage> {
  const site = await findSite(identifier);
  const previewDir = path.join(laraboxsHome(), "previews");
  await mkdir(previewDir, { recursive: true });

  const filePath = path.join(previewDir, `${safePreviewName(site.domain)}.png`);
  if (!options.refresh && (await freshPreviewExists(filePath))) {
    return { filePath, updatedAt: (await stat(filePath)).mtime };
  }

  const browser = findPreviewBrowser();
  if (!browser) {
    throw new Error("Microsoft Edge or Google Chrome was not found for site screenshots.");
  }

  await captureWithBrowser(browser, site.url, filePath);
  return { filePath, updatedAt: (await stat(filePath)).mtime };
}

export async function readSitePreviewImage(identifier: string, options: { refresh?: boolean } = {}): Promise<{ body: Buffer; updatedAt: Date }> {
  const preview = await getSitePreviewImage(identifier, options);
  return { body: await readFile(preview.filePath), updatedAt: preview.updatedAt };
}

async function freshPreviewExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0 && Date.now() - info.mtimeMs < previewMaxAgeMs;
  } catch {
    return false;
  }
}

function findPreviewBrowser(): string | undefined {
  const configured = process.env.LARABOXS_PREVIEW_BROWSER;
  const candidates = [
    configured,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : undefined,
    "msedge.exe",
    "chrome.exe",
    "chromium"
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => !path.isAbsolute(candidate) || existsSync(candidate));
}

async function captureWithBrowser(browser: string, url: string, outputPath: string): Promise<void> {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "laraboxs-preview-"));
  try {
    await runBrowser(browser, [
      "--headless",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--hide-scrollbars",
      "--ignore-certificate-errors",
      `--user-data-dir=${profileDir}`,
      "--window-size=1280,800",
      `--screenshot=${outputPath}`,
      url
    ]);

    const info = await stat(outputPath);
    if (!info.isFile() || info.size === 0) {
      throw new Error(`Site screenshot was not created for ${url}.`);
    }
  } finally {
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runBrowser(browser: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(browser, args, {
      stdio: "ignore",
      shell: false,
      windowsHide: true
    });

    const timeout = windowlessTimeout(() => {
      child.kill();
      reject(new Error("Site screenshot timed out."));
    }, 18000);

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Site screenshot browser exited with code ${code ?? "unknown"}.`));
    });
  });
}

function windowlessTimeout(callback: () => void, delay: number): NodeJS.Timeout {
  return setTimeout(callback, delay);
}

function safePreviewName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "site";
}
