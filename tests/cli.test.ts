import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("CLI command surface", () => {
  it("parks the folder argument even when flags come first", async () => {
    const home = await mkdir(path.join(os.tmpdir(), `laraboxs-cli-${Date.now()}-`), { recursive: true });
    const hosts = path.join(home, "hosts");
    const parked = path.join(home, "www");
    const project = path.join(parked, "sample", "public");
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, "index.php"), "<?php echo 'ok';");

    const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/cli/index.ts", "park", "--dry-run-hosts", parked], {
      cwd: process.cwd(),
      env: { ...process.env, LARABOXS_HOME: home, LARABOXS_HOSTS_FILE: hosts },
      encoding: "utf8",
      shell: false
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Parked ${parked}`);
    expect(result.stdout).toContain("127.0.0.1 sample.test");
  });

  it("prints laraboxs help with service and tool commands", () => {
    const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/cli/index.ts", "--help"], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("laraboxs");
    expect(result.stdout).toContain("laraboxs install nginx");
    expect(result.stdout).toContain("laraboxs install mongodb");
    expect(result.stdout).toContain("laraboxs site:entry <site> <entry>");
    expect(result.stdout).toContain("laraboxs uninstall nginx|redis|mongodb|node|composer");
    expect(result.stdout).toContain("laraboxs php-fcgi:start|php-fcgi:stop|php-fcgi:restart|php-fcgi:status");
    expect(result.stdout).toContain("laraboxs php:settings [php-version]");
    expect(result.stdout).toContain("laraboxs php:extensions:install [php-version]");
    expect(result.stdout).toContain("laraboxs ssl:status");
    expect(result.stdout).toContain("laraboxs ssl:trust");
    expect(result.stdout).toContain("laraboxs mysql:init");
    expect(result.stdout).toContain("laraboxs mysql:port <port|--auto>");
    expect(result.stdout).toContain("laraboxs mongodb:start|mongodb:stop|mongodb:restart|mongodb:status");
    expect(result.stdout).toContain("laraboxs mysql:change-password <new_password>");
    expect(result.stdout).toContain("laraboxs phpmyadmin:install [--dry-run-hosts|--no-hosts]");
  });

  it("updates PHP settings from key value pairs", async () => {
    const home = await mkdir(path.join(os.tmpdir(), `laraboxs-cli-php-${Date.now()}-`), { recursive: true });
    const hosts = path.join(home, "hosts");

    const result = spawnSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "src/cli/index.ts",
        "php:settings:set",
        "memory_limit=768M",
        "upload_max_filesize=128M",
        "post_max_size=128M",
        "max_execution_time=90",
        "max_input_vars=4000",
        "extensions=curl,mbstring"
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, LARABOXS_HOME: home, LARABOXS_HOSTS_FILE: hosts },
        encoding: "utf8",
        shell: false
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"memoryLimit": "768M"');
    expect(result.stdout).toContain('"maxExecutionTime": 90');
    expect(result.stdout).toContain('"curl"');
    expect(result.stdout).toContain('"mbstring"');
  });

  it("updates a site's Nginx entry path from the CLI", async () => {
    const home = await mkdir(path.join(os.tmpdir(), `laraboxs-cli-entry-${Date.now()}-`), { recursive: true });
    const hosts = path.join(home, "hosts");
    const parked = path.join(home, "www");
    await mkdir(path.join(parked, "sample", "public"), { recursive: true });
    await mkdir(path.join(parked, "sample", "web"), { recursive: true });
    await writeFile(path.join(parked, "sample", "public", "index.php"), "<?php echo 'ok';");

    const parkResult = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/cli/index.ts", "park", "--dry-run-hosts", parked], {
      cwd: process.cwd(),
      env: { ...process.env, LARABOXS_HOME: home, LARABOXS_HOSTS_FILE: hosts },
      encoding: "utf8",
      shell: false
    });
    expect(parkResult.status).toBe(0);

    const entryResult = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/cli/index.ts", "site:entry", "sample.test", "web"], {
      cwd: process.cwd(),
      env: { ...process.env, LARABOXS_HOME: home, LARABOXS_HOSTS_FILE: hosts },
      encoding: "utf8",
      shell: false
    });

    const siteConfig = await readFile(path.join(home, "services", "nginx", "conf", "sites-enabled", "sample.test.conf"), "utf8");
    expect(entryResult.status).toBe(0);
    expect(entryResult.stdout).toContain("sample.test Nginx entry set to web.");
    expect(siteConfig).toContain("/sample/web");
  });

  it("prints phpMyAdmin status without installing it", async () => {
    const home = await mkdir(path.join(os.tmpdir(), `laraboxs-cli-pma-${Date.now()}-`), { recursive: true });
    const hosts = path.join(home, "hosts");

    const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/cli/index.ts", "phpmyadmin:status"], {
      cwd: process.cwd(),
      env: { ...process.env, LARABOXS_HOME: home, LARABOXS_HOSTS_FILE: hosts },
      encoding: "utf8",
      shell: false
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"name": "phpMyAdmin"');
    expect(result.stdout).toContain('"installed": false');
    expect(result.stdout).toContain("phpmyadmin.test");
  });
});
