import net from "node:net";
import { execSync } from "node:child_process";
import { appendLog } from "./logging.js";

export function canConnect(host: string, port: number, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function findAvailablePort(
  host: string,
  startPort: number,
  endPort = startPort + 100
): Promise<number> {
  for (let port = startPort; port < endPort; port += 1) {
    if (!(await canConnect(host, port, 100))) {
      return port;
    }
  }
  throw new Error(`No available port found between ${startPort} and ${endPort - 1}.`);
}

export interface PortConflict {
  port: number;
  inUse: boolean;
  processName?: string;
  pid?: number;
}

export async function checkPortConflict(port: number): Promise<PortConflict> {
  const inUse = await canConnect("127.0.0.1", port, 250);
  if (!inUse) {
    return { port, inUse: false };
  }

  const processInfo = await findProcessOnPortWindows(port);
  return { port, inUse: true, ...processInfo };
}

async function findProcessOnPortWindows(port: number): Promise<{ processName?: string; pid?: number }> {
  if (process.platform !== "win32") {
    return {};
  }

  try {
    const result = execSync(
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1 OwningProcess"`,
      { encoding: "utf8", timeout: 5000, windowsHide: true }
    );
    const pidMatch = result.match(/\d+/);
    if (!pidMatch) return {};
    const pid = Number(pidMatch[0]);

    const nameResult = execSync(
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -First 1 ProcessName"`,
      { encoding: "utf8", timeout: 5000, windowsHide: true }
    );
    const name = nameResult.trim().split(/\r?\n/).pop()?.trim();
    return { pid, processName: name };
  } catch {
    return {};
  }
}

export async function assertPortAvailable(expectedPort: number): Promise<void> {
  const conflict = await checkPortConflict(expectedPort);
  if (conflict.inUse) {
    const occupant = conflict.processName ? ` (used by ${conflict.processName})` : "";
    throw new Error(`Port ${expectedPort} is already in use${occupant}. Stop the other process or choose a different port.`);
  }
}
