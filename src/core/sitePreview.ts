import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendLog } from "./logging.js";
import { laraboxsHome } from "./paths.js";
import { findSite } from "./sites.js";
import { downloadFile, downloadsDir, extractZip, mergeSingleExtractedFolder } from "./runtimeInstaller.js";

const previewMaxAgeMs = 5 * 60 * 1000;
const chromeForTestingManifestUrl = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";

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

  const browser = await previewBrowser();
  if (!browser) {
    throw new Error("Could not prepare a browser for site screenshots.");
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

async function previewBrowser(): Promise<string | undefined> {
  return findPreviewBrowser() ?? (await ensureChromeForTesting());
}

function findPreviewBrowser(): string | undefined {
  const configured = process.env.LARABOXS_PREVIEW_BROWSER;
  const localChrome = chromeForTestingBinary();
  const candidates = [
    configured,
    localChrome,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : undefined
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => path.isAbsolute(candidate) && existsSync(candidate));
}

async function ensureChromeForTesting(): Promise<string | undefined> {
  const binary = chromeForTestingBinary();
  if (existsSync(binary)) {
    return binary;
  }

  const download = await chromeForTestingDownload();
  const downloadPath = path.join(downloadsDir(), `chrome-for-testing-${download.version}-win64.zip`);
  const extractRoot = path.join(downloadsDir(), `chrome-for-testing-${download.version}-extract`);
  const root = chromeForTestingRoot();

  await appendLog("preview", `installing Chrome for Testing ${download.version}`);
  await mkdir(downloadsDir(), { recursive: true });
  await rm(extractRoot, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
  await downloadFile(download.url, downloadPath, "preview");
  await extractZip(downloadPath, extractRoot, "preview");
  await mergeSingleExtractedFolder(extractRoot, root);

  if (!existsSync(binary)) {
    throw new Error(`Chrome for Testing was downloaded but chrome.exe was not found at ${binary}.`);
  }

  await appendLog("preview", `Chrome for Testing ${download.version} installed at ${root}`);
  return binary;
}

async function chromeForTestingDownload(): Promise<{ version: string; url: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(chromeForTestingManifestUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Chrome for Testing manifest returned ${response.status}.`);
    }
    const payload = (await response.json()) as {
      channels?: {
        Stable?: {
          version?: string;
          downloads?: {
            chrome?: Array<{ platform?: string; url?: string }>;
          };
        };
      };
    };
    const stable = payload.channels?.Stable;
    const url = stable?.downloads?.chrome?.find((item) => item.platform === "win64")?.url;
    if (!stable?.version || !url) {
      throw new Error("Chrome for Testing win64 download was not found in the manifest.");
    }
    return { version: stable.version, url };
  } finally {
    clearTimeout(timer);
  }
}

function chromeForTestingRoot(): string {
  return path.join(laraboxsHome(), "runtimes", "chrome-for-testing");
}

function chromeForTestingBinary(): string {
  return path.join(chromeForTestingRoot(), "chrome.exe");
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
