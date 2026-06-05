import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLaravelInstallerStatus } from "./laravelInstaller.js";
import { getRuntimeStatus } from "./runtimes.js";
import type { ApplicationUpdateAsset, ApplicationUpdateStatus, LaravelInstallerStatus, RuntimeInstallStatus, UpdateCenterItem, UpdateCenterStatus } from "./types.js";

const defaultRepository = "bo3bdo/Hosrlaravel";
const githubApiBase = "https://api.github.com";
const fallbackAppVersion = "0.1.3";

export async function getUpdateCenterStatus(): Promise<UpdateCenterStatus> {
  const appPromise = getApplicationUpdateStatus();
  const runtimes = getRuntimeStatus();
  const installerPromise = withTimeout(getLaravelInstallerStatus({ checkLatest: true }), 3500, "Laravel Installer check timed out.");
  const [app, installer] = await Promise.all([
    appPromise,
    installerPromise.catch((error): LaravelInstallerStatus => ({
      installed: false,
      binDir: "",
      composerHome: "",
      composerInstalled: false,
      phpInstalled: false,
      message: error instanceof Error ? error.message : String(error)
    }))
  ]);

  const runtimeItems: UpdateCenterItem[] = [
    ...runtimes.php.map((runtime) => runtimeItem("php", runtime)),
    ...runtimes.mysql.map((runtime) => runtimeItem("mysql", runtime)),
    runtimeItem("nginx", runtimes.nginx),
    runtimeItem("redis", runtimes.redis),
    runtimeItem("node", runtimes.node),
    runtimeItem("composer", runtimes.composer)
  ];

  return {
    checkedAt: new Date().toISOString(),
    application: app,
    items: [
      ...runtimeItems,
      {
        id: "laravel-installer",
        kind: "laravel-installer",
        name: "Laravel Installer",
        version: installer.version ?? "global",
        installed: installer.installed,
        updateAvailable: Boolean(installer.updateAvailable),
        installedVersion: installer.version,
        latestVersion: installer.latestVersion,
        message: installer.message
      }
    ]
  };
}

export async function getApplicationUpdateStatus(): Promise<ApplicationUpdateStatus> {
  const currentVersion = await currentApplicationVersion();
  const checkedAt = new Date().toISOString();

  if (shouldSkipAppUpdateCheck()) {
    return {
      currentVersion,
      updateAvailable: false,
      checkedAt,
      status: "unavailable",
      message: "Application update checks are disabled in this environment.",
      autoInstallAvailable: false
    };
  }

  try {
    const release = await fetchLatestGithubRelease();
    const latestVersion = normalizeVersion(release.tag_name);
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    const asset = preferredInstallerAsset(release.assets ?? []);

    return {
      currentVersion,
      latestVersion,
      updateAvailable,
      checkedAt,
      status: updateAvailable ? "available" : "current",
      releaseUrl: release.html_url,
      releaseName: release.name || release.tag_name,
      publishedAt: release.published_at,
      asset,
      message: updateAvailable
        ? `Laraboxs ${latestVersion} is available on GitHub.`
        : `Laraboxs ${currentVersion} is up to date.`,
      autoInstallAvailable: false
    };
  } catch (error) {
    return {
      currentVersion,
      updateAvailable: false,
      checkedAt,
      status: "unavailable",
      message: `Could not check GitHub releases: ${error instanceof Error ? error.message : String(error)}`,
      autoInstallAvailable: false
    };
  }
}

function runtimeItem(kind: UpdateCenterItem["kind"], runtime: RuntimeInstallStatus): UpdateCenterItem {
  return {
    id: `${kind}:${runtime.version}`,
    kind,
    name: runtime.name,
    version: runtime.version,
    installed: runtime.installed,
    updateAvailable: Boolean(runtime.updateAvailable),
    installedVersion: runtime.installedPackageVersion ?? runtime.version,
    latestVersion: runtime.version,
    message: runtime.installed
      ? runtime.updateAvailable
        ? "Update available"
        : "Installed"
      : "Not installed"
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

interface GithubRelease {
  tag_name: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  assets?: GithubReleaseAsset[];
}

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type?: string;
}

async function fetchLatestGithubRelease(): Promise<GithubRelease> {
  const repository = process.env.LARABOXS_UPDATE_REPOSITORY || defaultRepository;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.LARABOXS_UPDATE_TIMEOUT_MS ?? 6000));

  try {
    const response = await fetch(`${githubApiBase}/repos/${repository}/releases/latest`, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "laraboxs-update-center"
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    }

    return (await response.json()) as GithubRelease;
  } finally {
    clearTimeout(timer);
  }
}

async function currentApplicationVersion(): Promise<string> {
  try {
    const packageJsonPath = path.join(projectRoot(), "package.json");
    const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? normalizeVersion(parsed.version) : fallbackAppVersion;
  } catch {
    return fallbackAppVersion;
  }
}

function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function preferredInstallerAsset(assets: GithubReleaseAsset[]): ApplicationUpdateAsset | undefined {
  const asset = assets.find((item) => /\.exe$/i.test(item.name)) ?? assets.find((item) => /\.msi$/i.test(item.name)) ?? assets[0];
  if (!asset) {
    return undefined;
  }

  return {
    name: asset.name,
    downloadUrl: asset.browser_download_url,
    size: asset.size,
    contentType: asset.content_type
  };
}

function shouldSkipAppUpdateCheck(): boolean {
  return process.env.LARABOXS_SKIP_APP_UPDATE_CHECK === "1" || process.env.VITEST === "true";
}

function normalizeVersion(value: string | undefined): string {
  return (value ?? fallbackAppVersion).trim().replace(/^v/i, "") || fallbackAppVersion;
}

function compareVersions(left: string | undefined, right: string | undefined): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function versionParts(value: string | undefined): number[] {
  return normalizeVersion(value)
    .split(/[.-]/)
    .map((part) => Number(part.replace(/\D/g, "")))
    .map((part) => (Number.isFinite(part) ? part : 0));
}
