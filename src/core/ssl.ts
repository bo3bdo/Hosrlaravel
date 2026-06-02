import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import selfsigned from "selfsigned";
import { appendLog } from "./logging.js";
import { getPaths } from "./paths.js";
import { findSite, setSiteSecurity } from "./sites.js";

export async function secureSite(identifier: string): Promise<void> {
  const site = await findSite(identifier);
  await ensureCertificate(site.domain);
  await setSiteSecurity(site.domain, true);
  await appendLog("ssl", `marked ${site.domain} as secured`);
}

export async function unsecureSite(identifier: string): Promise<void> {
  await setSiteSecurity(identifier, false);
  await appendLog("ssl", `marked ${identifier} as unsecured`);
}

async function ensureCertificate(domain: string): Promise<void> {
  const paths = getPaths();
  await mkdir(paths.certs, { recursive: true });
  const notAfterDate = new Date();
  notAfterDate.setDate(notAfterDate.getDate() + 825);
  const certificate = await selfsigned.generate(
    [
      { name: "commonName", value: domain },
      { name: "organizationName", value: "laraboxs local" }
    ],
    {
      notAfterDate,
      keySize: 2048,
      algorithm: "sha256",
      extensions: [
        { name: "basicConstraints", cA: false },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
        { name: "extKeyUsage", serverAuth: true },
        { name: "subjectAltName", altNames: [{ type: 2, value: domain }] }
      ]
    }
  );
  await writeFile(path.join(paths.certs, `${domain}.crt`), certificate.cert, "utf8");
  await writeFile(path.join(paths.certs, `${domain}.key`), certificate.private, "utf8");
}
