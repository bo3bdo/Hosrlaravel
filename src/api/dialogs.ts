import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

export interface FolderDialogOptions {
  initialPath?: string;
}

export interface FileDialogOptions {
  initialPath?: string;
  title?: string;
  filter?: string;
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

export async function selectFile(options: FileDialogOptions = {}): Promise<string | null> {
  if (process.platform !== "win32") {
    throw new Error("File picker is currently supported on Windows only.");
  }

  const initial = fileDialogInitialPath(options.initialPath);
  const title = options.title ?? "Select a file";
  const filter = options.filter ?? "All files (*.*)|*.*";
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
    `$dialog.Title = '${escapePowerShellString(title)}'`,
    `$dialog.Filter = '${escapePowerShellString(filter)}'`,
    "$dialog.CheckFileExists = $true",
    "$dialog.CheckPathExists = $true",
    "$dialog.Multiselect = $false",
    initial.initialDirectory ? `$dialog.InitialDirectory = '${escapePowerShellString(initial.initialDirectory)}'` : "",
    initial.fileName ? `$dialog.FileName = '${escapePowerShellString(initial.fileName)}'` : "",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $dialog.FileName }"
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
    throw new Error(message || `File picker exited with code ${code}.`);
  }

  const selectedPath = Buffer.concat(stdout).toString("utf8").trim();
  return selectedPath || null;
}

export function sqlFileDialogOptions(initialPath?: string): FileDialogOptions {
  return {
    initialPath,
    title: "Select SQL import file",
    filter: "SQL files (*.sql)|*.sql|All files (*.*)|*.*"
  };
}

function fileDialogInitialPath(initialPath?: string): { initialDirectory: string; fileName: string } {
  if (!initialPath?.trim()) {
    return { initialDirectory: "", fileName: "" };
  }

  const resolved = path.resolve(initialPath);
  if (existsSync(resolved)) {
    const stats = statSync(resolved);
    if (stats.isDirectory()) {
      return { initialDirectory: resolved, fileName: "" };
    }
    return { initialDirectory: path.dirname(resolved), fileName: path.basename(resolved) };
  }

  const parent = path.dirname(resolved);
  return {
    initialDirectory: existsSync(parent) ? parent : "",
    fileName: path.basename(resolved)
  };
}

function escapePowerShellString(value: string): string {
  return value.replace(/'/g, "''");
}
