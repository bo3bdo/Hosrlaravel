import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getRuntimeStatus, runtimeManifest, uninstallRuntime } from "../src/core/runtimes.js";

describe("runtime manifest", () => {
  beforeEach(async () => {
    process.env.LARABOXS_HOME = await mkdir(path.join(os.tmpdir(), `laraboxs-runtimes-${Date.now()}-`), { recursive: true });
  });

  it("contains installable PHP, MySQL, Nginx, Redis, MongoDB, Node, and Composer runtimes", () => {
    const manifest = runtimeManifest();

    expect(manifest.map((entry) => `${entry.kind}:${entry.version}`)).toContain("php:8.4");
    expect(manifest.map((entry) => `${entry.kind}:${entry.version}`)).toContain("php:8.5");
    expect(manifest.map((entry) => `${entry.kind}:${entry.version}`)).toContain("mysql:9.7");
    expect(manifest.map((entry) => `${entry.kind}:${entry.version}`)).toContain("mysql:8.4");
    expect(manifest.map((entry) => `${entry.kind}:${entry.version}`)).toContain("mysql:8.0");
    expect(manifest.map((entry) => entry.kind)).toContain("nginx");
    expect(manifest.map((entry) => entry.kind)).toContain("redis");
    expect(manifest.map((entry) => entry.kind)).toContain("mongodb");
    expect(manifest.map((entry) => entry.kind)).toContain("node");
    expect(manifest.map((entry) => entry.kind)).toContain("composer");
  });

  it("reports runtime installation status from laraboxs app data", () => {
    const status = getRuntimeStatus();

    expect(status.mysql).toHaveLength(3);
    expect(status.mysql.find((entry) => entry.version === "9.7")?.installed).toBe(false);
    expect(status.mysql.find((entry) => entry.version === "9.7")?.binary).toContain(path.join("services", "mysql", "9.7", "bin", "mysqld.exe"));
    expect(status.nginx.installed).toBe(false);
    expect(status.nginx.binary).toContain(path.join("services", "nginx", "nginx.exe"));
    expect(status.redis.installed).toBe(false);
    expect(status.redis.binary).toContain(path.join("services", "redis", "8.8", "redis-server.exe"));
    expect(status.mongodb.installed).toBe(false);
    expect(status.mongodb.binary).toContain(path.join("services", "mongodb", "8.2", "bin", "mongod.exe"));
    expect(status.php).toHaveLength(2);
    expect(status.composer.binary.endsWith("composer.phar")).toBe(true);
  });

  it("discovers installed PHP versions that are not in the install manifest", async () => {
    const phpBinary = path.join(process.env.LARABOXS_HOME!, "runtimes", "php", "8.3", "php.exe");
    await mkdir(path.dirname(phpBinary), { recursive: true });
    await writeFile(phpBinary, "fake php", "utf8");

    const status = getRuntimeStatus();
    const discovered = status.php.find((entry) => entry.version === "8.3");

    expect(discovered?.installed).toBe(true);
    expect(discovered?.downloadUrl).toBeUndefined();
    expect(discovered?.updateAvailable).toBe(false);
  });

  it("removes an installed app-local runtime", async () => {
    const php = runtimeManifest().find((entry) => entry.kind === "php" && entry.version === "8.4");
    expect(php).toBeTruthy();
    await mkdir(php!.root, { recursive: true });
    await writeFile(php!.binary, "fake php", "utf8");

    expect(getRuntimeStatus().php.find((entry) => entry.version === "8.4")?.installed).toBe(true);
    const status = await uninstallRuntime("php", "8.4");

    expect(status.installed).toBe(false);
    expect(getRuntimeStatus().php.find((entry) => entry.version === "8.4")?.installed).toBe(false);
  });

  it("reports an update when the installed runtime marker is older than the manifest", async () => {
    const php = runtimeManifest().find((entry) => entry.kind === "php" && entry.version === "8.4");
    expect(php).toBeTruthy();
    await mkdir(php!.root, { recursive: true });
    await writeFile(php!.binary, "fake php", "utf8");
    await writeFile(
      path.join(php!.root, ".laraboxs-runtime.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: "php",
          name: "PHP",
          version: "8.4",
          downloadUrl: "https://example.invalid/old-php.zip",
          installedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );

    const status = getRuntimeStatus().php.find((entry) => entry.version === "8.4");

    expect(status?.installed).toBe(true);
    expect(status?.installedDownloadUrl).toBe("https://example.invalid/old-php.zip");
    expect(status?.updateAvailable).toBe(true);
  });

  it("backfills marker metadata for a legacy installed runtime", async () => {
    const php = runtimeManifest().find((entry) => entry.kind === "php" && entry.version === "8.4");
    expect(php).toBeTruthy();
    await mkdir(php!.root, { recursive: true });
    await writeFile(php!.binary, "fake php", "utf8");

    const status = getRuntimeStatus().php.find((entry) => entry.version === "8.4");
    const marker = JSON.parse(await readFile(path.join(php!.root, ".laraboxs-runtime.json"), "utf8")) as {
      downloadUrl?: string;
      packageVersion?: string;
    };

    expect(status?.installed).toBe(true);
    expect(status?.installedDownloadUrl).toBe(php!.downloadUrl);
    expect(status?.installedPackageVersion).toBe(php!.packageVersion);
    expect(status?.updateAvailable).toBe(false);
    expect(marker.downloadUrl).toBe(php!.downloadUrl);
    expect(marker.packageVersion).toBe(php!.packageVersion);
  });

  it("detects the installed Composer version through app-local PHP", async () => {
    const composer = runtimeManifest().find((entry) => entry.kind === "composer");
    expect(composer).toBeTruthy();
    const php = path.join(process.env.LARABOXS_HOME!, "runtimes", "php", "8.5", "php.exe");
    await mkdir(path.dirname(php), { recursive: true });
    await mkdir(composer!.root, { recursive: true });
    await copyFile(process.execPath, php);
    await writeFile(composer!.binary, "console.log('Composer version 2.8.12 2025-09-19 13:41:59');\n", "utf8");

    const status = getRuntimeStatus().composer;
    const marker = JSON.parse(await readFile(path.join(composer!.root, ".laraboxs-runtime.json"), "utf8")) as {
      packageVersion?: string;
    };

    expect(status.installed).toBe(true);
    expect(status.installedPackageVersion).toBe("2.8.12");
    expect(marker.packageVersion).toBe("2.8.12");
  });

  it("reports an update when marker package version is older than the manifest package", async () => {
    const php = runtimeManifest().find((entry) => entry.kind === "php" && entry.version === "8.4");
    expect(php).toBeTruthy();
    await mkdir(php!.root, { recursive: true });
    await writeFile(php!.binary, "fake php", "utf8");
    await writeFile(
      path.join(php!.root, ".laraboxs-runtime.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: "php",
          name: "PHP",
          version: "8.4",
          packageVersion: "8.4.20",
          downloadUrl: php!.downloadUrl,
          installedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );

    const status = getRuntimeStatus().php.find((entry) => entry.version === "8.4");

    expect(status?.installed).toBe(true);
    expect(status?.installedDownloadUrl).toBe(php!.downloadUrl);
    expect(status?.installedPackageVersion).toBe("8.4.20");
    expect(status?.updateAvailable).toBe(true);
  });
});
