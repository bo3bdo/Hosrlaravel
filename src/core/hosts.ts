import { readFile, writeFile } from "node:fs/promises";
import { getPaths } from "./paths.js";
import { discoverSites } from "./sites.js";
import type { Site } from "./types.js";

const startMarker = "# LARABOXS MANAGED START";
const endMarker = "# LARABOXS MANAGED END";

export function renderHostsBlock(sites: Site[]): string {
  const entries = Array.from(new Set(sites.map((site) => site.domain)))
    .sort()
    .map((domain) => `127.0.0.1 ${domain}`);

  return [startMarker, ...entries, endMarker].join("\n");
}

export function mergeHostsFile(current: string, sites: Site[]): string {
  const block = renderHostsBlock(sites);
  const normalizedCurrent = current.replace(/\r\n/g, "\n").trimEnd();
  const expression = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`, "m");

  if (expression.test(normalizedCurrent)) {
    return `${normalizedCurrent.replace(expression, block)}\n`;
  }

  return `${normalizedCurrent}${normalizedCurrent ? "\n\n" : ""}${block}\n`;
}

export async function syncHostsFile(options: { dryRun?: boolean } = {}): Promise<string> {
  const paths = getPaths();
  const sites = await discoverSites();
  let current = "";

  try {
    current = await readFile(paths.hostsFile, "utf8");
  } catch {
    current = "";
  }

  const next = mergeHostsFile(current, sites);
  if (!options.dryRun) {
    await writeFile(paths.hostsFile, next, "utf8");
  }

  return next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
