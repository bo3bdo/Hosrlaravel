import { getLaravelInstallerStatus } from "./laravelInstaller.js";
import { getRuntimeStatus } from "./runtimes.js";
import type { LaravelInstallerStatus, RuntimeInstallStatus, UpdateCenterItem, UpdateCenterStatus } from "./types.js";

export async function getUpdateCenterStatus(): Promise<UpdateCenterStatus> {
  const runtimes = getRuntimeStatus();
  const installer: LaravelInstallerStatus = await getLaravelInstallerStatus({ checkLatest: true }).catch((error) => ({
    installed: false,
    binDir: "",
    composerHome: "",
    composerInstalled: false,
    phpInstalled: false,
    message: error instanceof Error ? error.message : String(error)
  }));

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
