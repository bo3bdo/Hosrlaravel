import { readFile, writeFile } from "node:fs/promises";

export async function updateDotEnvFile(filePath: string, values: Record<string, string>): Promise<void> {
  const current = await readFile(filePath, "utf8").catch(() => "");
  await writeFile(filePath, mergeDotEnvContent(current, values), "utf8");
}

export function mergeDotEnvContent(content: string, values: Record<string, string>): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const pending = new Map(Object.entries(values));
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !pending.has(match[1])) {
      return line;
    }
    const value = pending.get(match[1]) ?? "";
    pending.delete(match[1]);
    return `${match[1]}=${formatEnvValue(value)}`;
  });

  while (next.length && next[next.length - 1] === "") {
    next.pop();
  }

  for (const [key, value] of pending) {
    next.push(`${key}=${formatEnvValue(value)}`);
  }

  return `${next.join("\n")}\n`;
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
