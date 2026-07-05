import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addParkedFolder } from "../src/core/sites.js";
import { buildSiteCommand, siteCommandDefinition } from "../src/core/siteCommands.js";
import { dropManagedDatabase } from "../src/core/databaseManager.js";
import { applySiteEnvProfile, siteEnvProfiles } from "../src/core/siteEnv.js";
import { getUpdateCenterStatus } from "../src/core/updateCenter.js";

vi.mock("../src/core/laravelEnvSafety.js", async () => {
  const actual = await vi.importActual<typeof import("../src/core/laravelEnvSafety.js")>("../src/core/laravelEnvSafety.js");
  return {
    ...actual,
    ensureRedisPhpClientAvailable: vi.fn(async () => true)
  };
});

describe("developer tools", () => {
  let tempHome: string;
  let parked: string;

  beforeEach(async () => {
    tempHome = await mkdir(path.join(os.tmpdir(), `laraboxs-tools-${Date.now()}-`), { recursive: true });
    process.env.LARABOXS_HOME = tempHome;
    process.env.LARABOXS_SKIP_PATH_UPDATE = "1";
    process.env.LARABOXS_SKIP_APP_UPDATE_CHECK = "1";
    parked = path.join(tempHome, "www");
    await mkdir(path.join(parked, "laravel-app", "public"), { recursive: true });
    await mkdir(path.join(parked, "plain-php"), { recursive: true });
    await writeFile(path.join(parked, "laravel-app", "public", "index.php"), "<?php echo 'ok';");
    await writeFile(path.join(parked, "laravel-app", "artisan"), "<?php echo 'artisan';");
    await writeFile(path.join(parked, "plain-php", "index.php"), "<?php echo 'ok';");
    await addParkedFolder(parked, { defenderExclusion: false });
  });

  it("exposes whitelisted project command definitions", () => {
    expect(siteCommandDefinition("artisan:migrate")).toEqual({
      id: "artisan:migrate",
      label: "Migrate",
      detail: "php artisan migrate --force"
    });
    expect(siteCommandDefinition("artisan:cache-clear").detail).toBe("config/route/view clear");
  });

  it("runs artisan commands with the generated php.ini", async () => {
    const command = await buildSiteCommand("laravel-app.test", "artisan:migrate");

    expect(command.args[0]).toBe("-c");
    expect(command.args[1]).toContain(path.join("php", "8.5", "php.ini"));
    expect(command.args.slice(2)).toEqual(["artisan", "migrate", "--force", "--no-interaction"]);
  });

  it("clears Laravel bootstrap files without requiring a Redis cache connection", async () => {
    const command = await buildSiteCommand("laravel-app.test", "artisan:cache-clear");

    expect(command.args).toContain("optimize:clear");
    expect(command.args).toContain("--except=cache");
  });

  it("rejects artisan commands for non-Laravel projects", async () => {
    await expect(buildSiteCommand("plain-php.test", "artisan:migrate")).rejects.toThrow(/requires a Laravel project/i);
  });

  it("refuses to drop system databases", async () => {
    await expect(dropManagedDatabase("mysql")).rejects.toThrow(/system database/i);
  });

  it("returns update center items for runtimes and Laravel Installer", async () => {
    const status = await getUpdateCenterStatus();
    const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { version: string };

    expect(status.application.currentVersion).toBe(packageJson.version);
    expect(status.application.status).toBe("unavailable");
    expect(status.items.some((item) => item.id.startsWith("php:"))).toBe(true);
    expect(status.items.some((item) => item.id === "laravel-installer")).toBe(true);
  });

  it("generates and applies copyable .env profiles for a site", async () => {
    await writeFile(path.join(parked, "laravel-app", ".env"), "APP_NAME=Laravel\nAPP_URL=http://localhost\n", "utf8");
    const payload = await siteEnvProfiles("laravel-app.test");
    const full = payload.profiles.find((profile) => profile.id === "full");

    expect(full?.block).toContain("APP_URL=http://laravel-app.test");
    expect(full?.block).toMatch(/DB_CONNECTION=(mysql|mariadb)/);
    expect(full?.block).toContain("REDIS_HOST=127.0.0.1");
    expect(full?.block).toContain("SESSION_DRIVER=redis");
    expect(full?.block).toContain("CACHE_STORE=redis");
    expect(full?.block).toContain("QUEUE_CONNECTION=redis");
    expect(payload.profiles.find((profile) => profile.id === "queue-redis")).toBeTruthy();

    await applySiteEnvProfile("laravel-app.test", "app");
    const env = await import("node:fs/promises").then((fs) => fs.readFile(path.join(parked, "laravel-app", ".env"), "utf8"));

    expect(env).toContain("APP_URL=http://laravel-app.test\n");
    expect(env.match(/^APP_URL=/gm)).toHaveLength(1);
  });
});
