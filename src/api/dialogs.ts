import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export interface FolderDialogOptions {
  initialPath?: string;
}

export async function selectFolder(options: FolderDialogOptions = {}): Promise<string | null> {
  if (process.platform !== "win32") {
    throw new Error("Folder picker is currently supported on Windows only.");
  }

  const initialPath = options.initialPath && existsSync(options.initialPath) ? options.initialPath : "";
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'Select a project folder'",
    "$dialog.ShowNewFolderButton = $true",
    initialPath ? `$dialog.SelectedPath = '${escapePowerShellString(initialPath)}'` : "",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $dialog.SelectedPath }"
  ]
    .filter(Boolean)
    .join("; ");

  const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true
  });

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));

  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });

  if (code !== 0) {
    const message = Buffer.concat(stderr).toString("utf8").trim();
    throw new Error(message || `Folder picker exited with code ${code}.`);
  }

  const selectedPath = Buffer.concat(stdout).toString("utf8").trim();
  return selectedPath || null;
}

function escapePowerShellString(value: string): string {
  return value.replace(/'/g, "''");
}
