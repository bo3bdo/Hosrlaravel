import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { loadConfig, saveConfig } from "./config.js";
import { appendLog } from "./logging.js";
import { getPaths } from "./paths.js";
import { ensurePhpIni, phpIniPath } from "./php.js";
import { downloadFile, downloadsDir, extractZip } from "./runtimeInstaller.js";

export interface PhpExtensionInstallStatus {
  extension: string;
  phpVersion: string;
  installed: boolean;
  loaded?: boolean;
  dllPath?: string;
  downloadUrl?: string;
  message?: string;
}

interface PhpExtensionPackage {
  extension: string;
  packageVersion: string;
}

const installablePhpExtensions: PhpExtensionPackage[] = [
  { extension: "redis", packageVersion: "6.3.0" },
  { extension: "imagick", packageVersion: "3.8.0" },
  { extension: "imap", packageVersion: "1.0.3" },
  { extension: "sqlsrv", packageVersion: "5.13.0" },
  { extension: "pdo_sqlsrv", packageVersion: "5.13.0" }
];

export async function installDefaultPhpExtensions(phpVersion: string): Promise<PhpExtensionInstallStatus[]> {
  const statuses = [await installPhpExtension("redis", phpVersion)];
  await ensurePhpIni(phpVersion);
  return statuses;
}

export async function installConfiguredPhpExtensions(phpVersion?: string): Promise<PhpExtensionInstallStatus[]> {
  const config = await loadConfig();
  const versions = phpVersion ? [phpVersion] : config.phpVersions;
  const requestedExtensions = config.php.enabledExtensions.filter((extension) => Boolean(packageForExtension(extension)));
  const statuses: PhpExtensionInstallStatus[] = [];

  for (const version of versions) {
    for (const extension of requestedExtensions) {
      try {
        statuses.push(await installPhpExtension(extension, version));
      } catch (error) {
        const extensionPackage = packageForExtension(extension);
        statuses.push({
          extension,
          phpVersion: version,
          installed: false,
          loaded: false,
          downloadUrl: extensionPackage ? phpExtensionDownloadUrl(extensionPackage, version) : undefined,
          message: error instanceof Error ? error.message : String(error)
        });
        await appendLog("php-extension", `failed to install ${extension} for PHP ${version}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await ensurePhpIni(version);
  }

  return statuses;
}

export async function installPhpExtension(extension: string, phpVersion: string): Promise<PhpExtensionInstallStatus> {
  const extensionPackage = packageForExtension(extension);
  if (!extensionPackage) {
    return { extension, phpVersion, installed: true, message: "Extension ships with PHP or is built in." };
  }

  const phpRoot = path.join(getPaths().phpRoot, phpVersion);
  const phpBinary = path.join(phpRoot, "php.exe");
  if (!existsSync(phpBinary)) {
    return { extension, phpVersion, installed: false, message: `PHP ${phpVersion} is not installed.` };
  }

  const targetDll = path.join(phpRoot, "ext", `php_${extension}.dll`);
  if (existsSync(targetDll)) {
    await ensurePhpIni(phpVersion);
    const loadCheck = moduleLoadStatus(extension, phpVersion);
    const message = await handleExtensionLoadResult(extension, phpVersion, loadCheck);
    return {
      extension,
      phpVersion,
      installed: true,
      loaded: loadCheck.loaded,
      dllPath: targetDll,
      downloadUrl: phpExtensionDownloadUrl(extensionPackage, phpVersion),
      message
    };
  }

  const downloadUrl = phpExtensionDownloadUrl(extensionPackage, phpVersion);
  const downloadPath = path.join(downloadsDir(), `php-${extension}-${phpVersion}.zip`);
  const extractRoot = path.join(downloadsDir(), `php-${extension}-${phpVersion}-extract`);
  await rm(extractRoot, { recursive: true, force: true });
  await downloadFile(downloadUrl, downloadPath, "php-extension");
  await extractZip(downloadPath, extractRoot, "php-extension");

  const files = await listFilesRecursive(extractRoot);
  const extensionDll = files.find((file) => new RegExp(`^php_${escapeRegExp(extension)}(?:[-_].*)?\\.dll$`, "i").test(path.basename(file)));
  if (!extensionDll) {
    throw new Error(`Could not find php_${extension}.dll in ${downloadUrl}.`);
  }

  await mkdir(path.dirname(targetDll), { recursive: true });
  await copyFile(extensionDll, targetDll);

  for (const dependency of files.filter((file) => path.extname(file).toLowerCase() === ".dll" && !path.basename(file).toLowerCase().startsWith("php_"))) {
    await copyFile(dependency, path.join(phpRoot, path.basename(dependency)));
  }

  await rm(extractRoot, { recursive: true, force: true });
  await ensurePhpIni(phpVersion);
  await appendLog("php-extension", `installed ${extension} for PHP ${phpVersion} from ${downloadUrl}`);
  const loadCheck = moduleLoadStatus(extension, phpVersion);
  const message = await handleExtensionLoadResult(extension, phpVersion, loadCheck);

  return {
    extension,
    phpVersion,
    installed: existsSync(targetDll),
    loaded: loadCheck.loaded,
    dllPath: targetDll,
    downloadUrl,
    message
  };
}

export function phpExtensionDownloadUrl(extensionPackage: PhpExtensionPackage, phpVersion: string): string {
  const fileName = `php_${extensionPackage.extension}-${extensionPackage.packageVersion}-${phpVersion}-nts-vs17-x64.zip`;
  return `https://downloads.php.net/~windows/pecl/releases/${extensionPackage.extension}/${extensionPackage.packageVersion}/${fileName}`;
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(filePath)));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function packageForExtension(extension: string): PhpExtensionPackage | undefined {
  return installablePhpExtensions.find((entry) => entry.extension === extension);
}

function moduleLoadStatus(extension: string, phpVersion: string): { loaded: boolean; output?: string } {
  const phpRoot = path.join(getPaths().phpRoot, phpVersion);
  const phpBinary = path.join(phpRoot, "php.exe");
  const result = spawnSync(phpBinary, ["-c", phpIniPath(phpVersion), "-m"], { encoding: "utf8", timeout: 5000, windowsHide: true });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return {
    loaded: result.status === 0 && output.split(/\r?\n/).some((line) => line.trim().toLowerCase() === extension),
    output: output ? truncate(output.replace(/\s+/g, " "), 500) : undefined
  };
}

function extensionLoadMessage(extension: string, loadCheck: { loaded: boolean; output?: string }): string {
  if (loadCheck.loaded) {
    return "Extension loaded by PHP.";
  }

  const detail = loadCheck.output ? ` php -m output: ${loadCheck.output}` : "";
  return `DLL installed, but PHP did not report ${extension} in php -m. Check dependency requirements.${detail}`;
}

async function handleExtensionLoadResult(extension: string, phpVersion: string, loadCheck: { loaded: boolean; output?: string }): Promise<string> {
  const message = extensionLoadMessage(extension, loadCheck);
  if (loadCheck.loaded) {
    return message;
  }

  await disableConfiguredPhpExtension(extension);
  await ensurePhpIni(phpVersion);
  const disabledMessage = `${message} Disabled ${extension} automatically so PHP ${phpVersion} can continue running.`;
  await appendLog("php-extension", disabledMessage);
  return disabledMessage;
}

async function disableConfiguredPhpExtension(extension: string): Promise<void> {
  const config = await loadConfig();
  const nextExtensions = config.php.enabledExtensions.filter((entry) => entry !== extension);
  if (nextExtensions.length === config.php.enabledExtensions.length) {
    return;
  }

  await saveConfig({
    ...config,
    php: {
      ...config.php,
      enabledExtensions: nextExtensions
    }
  });
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
