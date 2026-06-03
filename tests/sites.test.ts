import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { mergeDotEnvContent } from "../src/core/envFile.js";
import { applyLocalDevelopmentInstallEnvironment, buildLaravelNewArgs, createNewSite } from "../src/core/laravelInstaller.js";
import { addParkedFolder, discoverSites, isolateSite, setGlobalPhpVersion, setSiteEntryPath } from "../src/core/sites.js";

describe("site discovery", () => {
  let tempHome: string;
  let parked: string;

  beforeEach(async () => {
    tempHome = await mkdir(path.join(os.tmpdir(), `laraboxs-sites-${Date.now()}-`), { recursive: true });
    process.env.LARABOXS_HOME = tempHome;
    parked = path.join(tempHome, "www");
    await mkdir(path.join(parked, "laravel-app", "public"), { recursive: true });
    await mkdir(path.join(parked, "plain-php"), { recursive: true });
    await mkdir(path.join(parked, "static-site"), { recursive: true });
    await writeFile(path.join(parked, "laravel-app", "public", "index.php"), "<?php echo 'ok';");
    await writeFile(path.join(parked, "plain-php", "index.php"), "<?php echo 'ok';");
  });

  it("detects Laravel, PHP, and static projects in parked folders", async () => {
    await addParkedFolder(parked);
    const sites = await discoverSites();

    expect(sites.map((site) => [site.domain, site.framework])).toEqual([
      ["laravel-app.test", "Laravel"],
      ["plain-php.test", "PHP"],
      ["static-site.test", "Static"]
    ]);
    expect(sites[0].documentRoot.endsWith(path.join("laravel-app", "public"))).toBe(true);
  });

  it("supports global and isolated PHP versions", async () => {
    await addParkedFolder(parked);
    await setGlobalPhpVersion("8.5");
    await isolateSite("laravel-app.test", "8.4");

    const sites = await discoverSites();
    expect(sites.find((site) => site.domain === "laravel-app.test")?.phpVersion).toBe("8.4");
    expect(sites.find((site) => site.domain === "plain-php.test")?.phpVersion).toBe("8.5");
  });

  it("supports editable Nginx entry paths inside a site folder", async () => {
    await mkdir(path.join(parked, "plain-php", "web"), { recursive: true });
    await addParkedFolder(parked);
    await setSiteEntryPath("plain-php.test", "web");

    const sites = await discoverSites();
    const site = sites.find((candidate) => candidate.domain === "plain-php.test");

    expect(site?.entryPath).toBe("web");
    expect(site?.documentRoot.endsWith(path.join("plain-php", "web"))).toBe(true);
  });

  it("creates a plain PHP site inside a parked folder", async () => {
    const result = await createNewSite({ name: "Hello PHP", preset: "php", parentPath: parked });
    const sites = await discoverSites();
    const site = sites.find((candidate) => candidate.domain === "hello-php.test");

    expect(result.site.domain).toBe("hello-php.test");
    expect(site?.framework).toBe("PHP");
    expect(site?.documentRoot.endsWith(path.join("hello-php"))).toBe(true);
  });

  it("builds Laravel installer arguments from creation options", () => {
    expect(
      buildLaravelNewArgs({
        name: "My App",
        preset: "laravel",
        starterKit: "react",
        auth: "none",
        database: "mariadb",
        packageManager: "npm",
        testing: "phpunit",
        git: true,
        boost: false
      })
    ).toEqual([
      "new",
      "my-app",
      "--no-interaction",
      "--no-ansi",
      "--verbose",
      "--database=mariadb",
      "--react",
      "--no-authentication",
      "--phpunit",
      "--npm",
      "--no-boost",
      "--git"
    ]);
  });

  it("forces local project installs to include development dependencies", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      npm_config_omit: "dev",
      NPM_CONFIG_ONLY: "prod",
      COMPOSER_NO_DEV: "1"
    };

    applyLocalDevelopmentInstallEnvironment(env);

    expect(env.NODE_ENV).toBe("development");
    expect(env.npm_config_production).toBe("false");
    expect(env.npm_config_include).toBe("dev");
    expect(env.npm_config_omit).toBeUndefined();
    expect(env.NPM_CONFIG_ONLY).toBeUndefined();
    expect(env.COMPOSER_NO_DEV).toBeUndefined();
  });

  it("updates Laravel env files without duplicating keys", () => {
    const next = mergeDotEnvContent("APP_NAME=Laravel\nAPP_URL=http://localhost:8000\nDB_PASSWORD=\n", {
      APP_URL: "http://kk.test",
      DB_PASSWORD: "secret",
      DB_DATABASE: "kk"
    });

    expect(next).toContain("APP_URL=http://kk.test\n");
    expect(next).toContain("DB_PASSWORD=secret\n");
    expect(next).toContain("DB_DATABASE=kk\n");
    expect(next.match(/^APP_URL=/gm)).toHaveLength(1);
  });
});
