import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ensurePhpIni, getPhpSettings, updatePhpSettings } from "../src/core/php.js";
import { getPaths } from "../src/core/paths.js";
import { defaultConfig, normalizeConfig } from "../src/core/config.js";

const requestedPhpExtensions = [
  "curl",
  "fileinfo",
  "mbstring",
  "openssl",
  "pdo_mysql",
  "pdo_sqlite",
  "mysqli",
  "sqlite3",
  "zip",
  "gd",
  "intl",
  "bcmath",
  "sodium",
  "exif",
  "ftp",
  "imap",
  "ldap",
  "soap",
  "sockets",
  "xsl",
  "redis",
  "imagick",
  "pgsql",
  "pdo_pgsql",
  "sqlsrv",
  "pdo_sqlsrv"
];

const legacyDefaultPhpExtensions = ["mbstring", "openssl", "pdo_mysql", "mysqli", "pdo_sqlite", "sqlite3", "fileinfo", "curl", "zip", "intl", "gd", "sodium", "exif"];

describe("php settings", () => {
  beforeEach(async () => {
    process.env.LARABOXS_HOME = await mkdir(path.join(os.tmpdir(), `laraboxs-php-${Date.now()}-`), { recursive: true });
  });

  it("enables the requested PHP extensions by default for every configured PHP version", () => {
    const defaults = defaultConfig();
    const migrated = normalizeConfig({ ...defaults, php: { ...defaults.php, enabledExtensions: legacyDefaultPhpExtensions } });

    expect(defaults.php.enabledExtensions).toEqual(expect.arrayContaining(requestedPhpExtensions));
    expect(migrated.php.enabledExtensions).toEqual(expect.arrayContaining(requestedPhpExtensions));
  });

  it("writes generated php.ini from saved PHP settings", async () => {
    const extDir = path.join(getPaths().phpRoot, "8.4", "ext");
    await mkdir(extDir, { recursive: true });
    await writeFile(path.join(extDir, "php_redis.dll"), "fake redis extension", "utf8");
    await writeFile(path.join(extDir, "php_mbstring.dll"), "fake mbstring extension", "utf8");

    await updatePhpSettings({
      memoryLimit: "1024M",
      uploadMaxFilesize: "128M",
      postMaxSize: "128M",
      maxExecutionTime: 120,
      maxInputVars: 5000,
      enabledExtensions: ["redis", "mbstring", "imagick"]
    });

    const ini = await readFile(await ensurePhpIni("8.4"), "utf8");
    const settings = await getPhpSettings("8.4");

    expect(ini).toContain("memory_limit=1024M");
    expect(ini).toContain("upload_max_filesize=128M");
    expect(ini).toContain("post_max_size=128M");
    expect(ini).toContain("max_execution_time=120");
    expect(ini).toContain("max_input_vars=5000");
    expect(ini).toContain("extension=mbstring");
    expect(ini).toContain("extension=redis");
    expect(ini).toContain("; extension=imagick skipped by laraboxs");
    expect(settings.extensions.find((extension) => extension.name === "redis")?.available).toBe(true);
    expect(settings.extensions.find((extension) => extension.name === "redis")?.enabled).toBe(true);
    expect(settings.extensions.find((extension) => extension.name === "imagick")?.available).toBe(false);
    expect(settings.extensions.find((extension) => extension.name === "imagick")?.enabled).toBe(true);
  });
});
