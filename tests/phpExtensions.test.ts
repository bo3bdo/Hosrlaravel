import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig, saveConfig } from "../src/core/config.js";
import { getPaths } from "../src/core/paths.js";

const { spawnSyncMock, downloadFileMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
  downloadFileMock: vi.fn()
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawnSync: spawnSyncMock
  };
});

vi.mock("../src/core/runtimeInstaller.js", () => ({
  downloadFile: downloadFileMock,
  downloadsDir: () => path.join(process.env.LARABOXS_HOME!, "downloads"),
  extractZip: vi.fn()
}));

describe("PHP extension installer", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.LARABOXS_HOME = await mkdir(path.join(os.tmpdir(), `laraboxs-php-ext-${Date.now()}-`), { recursive: true });
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "[PHP Modules]\nCore\n",
      stderr: "PHP Warning: PHP Startup: Unable to load dynamic library 'redis'"
    });
  });

  it("automatically disables an existing DLL that PHP cannot load without throwing", async () => {
    const { installPhpExtension } = await import("../src/core/phpExtensions.js");
    await saveConfig(defaultConfig());
    const phpRoot = path.join(getPaths().phpRoot, "8.5");
    await mkdir(path.join(phpRoot, "ext"), { recursive: true });
    await writeFile(path.join(phpRoot, "php.exe"), "", "utf8");
    await writeFile(path.join(phpRoot, "ext", "php_redis.dll"), "", "utf8");

    const status = await installPhpExtension("redis", "8.5");
    const config = JSON.parse(await readFile(getPaths().configFile, "utf8")) as { php: { enabledExtensions: string[] } };
    const ini = await readFile(path.join(phpRoot, "php.ini"), "utf8");

    expect(status.installed).toBe(true);
    expect(status.loaded).toBe(false);
    expect(status.message).toContain("DLL installed, but PHP did not report redis");
    expect(status.message).toContain("Disabled redis automatically");
    expect(status.message).toContain("Unable to load dynamic library");
    expect(config.php.enabledExtensions).not.toContain("redis");
    expect(ini).not.toContain("extension=redis");
  });

  it("keeps installing configured extensions after a download failure", async () => {
    const { installConfiguredPhpExtensions } = await import("../src/core/phpExtensions.js");
    const config = defaultConfig();
    config.phpVersions = ["8.5"];
    config.php.enabledExtensions = ["redis"];
    await saveConfig(config);
    await mkdir(path.join(getPaths().phpRoot, "8.5"), { recursive: true });
    await writeFile(path.join(getPaths().phpRoot, "8.5", "php.exe"), "", "utf8");
    downloadFileMock.mockRejectedValue(new Error("download unavailable"));

    const statuses = await installConfiguredPhpExtensions("8.5");

    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      extension: "redis",
      phpVersion: "8.5",
      installed: false,
      loaded: false,
      message: "download unavailable"
    });
  });
});
