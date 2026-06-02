import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { addParkedFolder } from "../src/core/sites.js";
import { generateNginxSiteConfig } from "../src/core/nginx.js";
import { secureSite } from "../src/core/ssl.js";
import { discoverSites } from "../src/core/sites.js";

describe("nginx config generation", () => {
  let parked: string;

  beforeEach(async () => {
    process.env.LARABOXS_HOME = await mkdir(path.join(os.tmpdir(), `laraboxs-nginx-${Date.now()}-`), { recursive: true });
    parked = path.join(process.env.LARABOXS_HOME, "www");
    await mkdir(path.join(parked, "my-app", "public"), { recursive: true });
    await writeFile(path.join(parked, "my-app", "public", "index.php"), "<?php");
    await addParkedFolder(parked);
  });

  it("binds local HTTP and points Laravel roots at public", async () => {
    const [site] = await discoverSites();
    const config = await generateNginxSiteConfig(site);

    expect(config).toContain("listen 127.0.0.1:80;");
    expect(config).toContain('/my-app/public"');
    expect(config).toContain("fastcgi_pass 127.0.0.1:9084;");
  });

  it("redirects HTTP to HTTPS for secured sites", async () => {
    await secureSite("my-app.test");
    const [site] = await discoverSites();
    const config = await generateNginxSiteConfig(site);

    expect(config).toContain("return 301 https://$host$request_uri;");
    expect(config).toContain("listen 127.0.0.1:443 ssl;");
  });
});
