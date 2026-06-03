import { X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import selfsigned from "selfsigned";
import { getPaths } from "../src/core/paths.js";
import { getLocalCaStatus, secureSite, unsecureSite } from "../src/core/ssl.js";
import { addParkedFolder } from "../src/core/sites.js";

describe("SSL certificates", () => {
  beforeEach(async () => {
    process.env.LARABOXS_HOME = await mkdir(path.join(os.tmpdir(), `laraboxs-ssl-${Date.now()}-`), { recursive: true });
    process.env.LARABOXS_SKIP_CA_TRUST = "1";
    const parked = path.join(process.env.LARABOXS_HOME, "www");
    await mkdir(path.join(parked, "dispatches", "public"), { recursive: true });
    await writeFile(path.join(parked, "dispatches", "public", "index.php"), "<?php");
    await writeFile(path.join(parked, "dispatches", ".env"), "APP_URL=http://dispatches.test\n");
    await addParkedFolder(parked);
  });

  it("issues site certificates from the laraboxs local CA with SAN", async () => {
    await secureSite("dispatches.test");

    const paths = getPaths();
    const siteCert = new X509Certificate(await readFile(path.join(paths.certs, "dispatches.test.crt"), "utf8"));
    const caCert = new X509Certificate(await readFile(path.join(paths.certs, "laraboxs-local-ca.crt"), "utf8"));

    expect(caCert.subject).toContain("CN=laraboxs Local Development CA");
    expect(siteCert.issuer).toBe(caCert.subject);
    expect(siteCert.subjectAltName).toContain("DNS:dispatches.test");
    expect(siteCert.verify(caCert.publicKey)).toBe(true);
  });

  it("reports local CA status without trusting it during tests", async () => {
    await secureSite("dispatches.test");

    const status = await getLocalCaStatus();

    expect(status.exists).toBe(true);
    expect(status.trusted).toBe(false);
    expect(status.certPath).toContain("laraboxs-local-ca.crt");
    expect(status.message).toBe("CA trust check skipped.");
  });

  it("regenerates a site certificate when the local CA changes", async () => {
    await secureSite("dispatches.test");

    const paths = getPaths();
    const ca = await selfsigned.generate(
      [
        { name: "commonName", value: "laraboxs Local Development CA" },
        { name: "organizationName", value: "laraboxs local" }
      ],
      {
        notAfterDate: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000),
        keySize: 2048,
        algorithm: "sha256",
        extensions: [
          { name: "basicConstraints", cA: true, pathLenConstraint: 0, critical: true },
          { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true }
        ]
      }
    );
    await writeFile(path.join(paths.certs, "laraboxs-local-ca.crt"), ca.cert, "utf8");
    await writeFile(path.join(paths.certs, "laraboxs-local-ca.key"), ca.private, "utf8");

    await secureSite("dispatches.test");

    const siteCert = new X509Certificate(await readFile(path.join(paths.certs, "dispatches.test.crt"), "utf8"));
    const caCert = new X509Certificate(ca.cert);
    expect(siteCert.issuer).toBe(caCert.subject);
    expect(siteCert.verify(caCert.publicKey)).toBe(true);
  });

  it("updates Laravel APP_URL when a site is secured or unsecured", async () => {
    const envPath = path.join(process.env.LARABOXS_HOME ?? "", "www", "dispatches", ".env");

    await secureSite("dispatches.test");
    expect(await readFile(envPath, "utf8")).toContain("APP_URL=https://dispatches.test");

    await unsecureSite("dispatches.test");
    expect(await readFile(envPath, "utf8")).toContain("APP_URL=http://dispatches.test");
  });
});
