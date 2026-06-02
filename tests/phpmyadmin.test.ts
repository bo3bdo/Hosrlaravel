import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { generatePhpMyAdminNginxConfig, getPhpMyAdminStatus, phpMyAdminRoot, phpMyAdminSiteIfInstalled, writePhpMyAdminConfig } from "../src/core/phpmyadmin.js";

describe("phpMyAdmin integration", () => {
  beforeEach(async () => {
    process.env.LARABOXS_HOME = await mkdir(path.join(os.tmpdir(), `laraboxs-phpmyadmin-${Date.now()}-`), { recursive: true });
  });

  it("reports phpMyAdmin as an app-local managed tool", () => {
    const status = getPhpMyAdminStatus();

    expect(status.installed).toBe(false);
    expect(status.url).toBe("http://phpmyadmin.test");
    expect(status.root).toContain(path.join("tools", "phpmyadmin", "5.2.3"));
  });

  it("creates phpMyAdmin config and Nginx site when installed", async () => {
    await mkdir(phpMyAdminRoot(), { recursive: true });
    await writeFile(path.join(phpMyAdminRoot(), "index.php"), "<?php echo 'phpMyAdmin';", "utf8");

    await writePhpMyAdminConfig();
    const site = await phpMyAdminSiteIfInstalled();
    const nginx = await generatePhpMyAdminNginxConfig();
    const config = await readFile(getPhpMyAdminStatus().configPath, "utf8");

    expect(site?.domain).toBe("phpmyadmin.test");
    expect(nginx).toContain("server_name phpmyadmin.test");
    expect(config).toContain("$cfg['Servers'][$i]['host'] = '127.0.0.1';");
    expect(config).toContain("$cfg['Servers'][$i]['port'] = '3306';");
  });
});
