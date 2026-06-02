import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { addParkedFolder, discoverSites, isolateSite, setGlobalPhpVersion } from "../src/core/sites.js";

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
});
