import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { installDefaultPhpExtensionsMock, mergeSingleExtractedFolderMock } = vi.hoisted(() => ({
  installDefaultPhpExtensionsMock: vi.fn(),
  mergeSingleExtractedFolderMock: vi.fn()
}));

vi.mock("../src/core/runtimeInstaller.js", async () => {
  const actual = await vi.importActual<typeof import("../src/core/runtimeInstaller.js")>("../src/core/runtimeInstaller.js");
  return {
    ...actual,
    downloadFile: vi.fn(),
    extractZip: vi.fn(),
    mergeSingleExtractedFolder: mergeSingleExtractedFolderMock
  };
});

vi.mock("../src/core/phpExtensions.js", () => ({
  installDefaultPhpExtensions: installDefaultPhpExtensionsMock
}));

describe("PHP runtime extension recovery", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.LARABOXS_HOME = await mkdir(path.join(os.tmpdir(), `laraboxs-runtime-recovery-${Date.now()}-`), { recursive: true });
    mergeSingleExtractedFolderMock.mockImplementation(async (_extractRoot: string, runtimeRoot: string) => {
      await mkdir(runtimeRoot, { recursive: true });
      await writeFile(path.join(runtimeRoot, "php.exe"), "", "utf8");
    });
    installDefaultPhpExtensionsMock.mockResolvedValue([
      {
        extension: "redis",
        phpVersion: "8.5",
        installed: true,
        loaded: false,
        message: "DLL installed, but PHP did not report redis in php -m. Disabled redis automatically so PHP 8.5 can continue running."
      }
    ]);
  });

  it("completes PHP install when a default extension is disabled automatically", async () => {
    const { installRuntime } = await import("../src/core/runtimes.js");
    const messages: string[] = [];

    const status = await installRuntime("php", "8.5", {
      onProgress: (progress) => {
        if (progress.message) {
          messages.push(progress.message);
        }
      }
    });

    expect(status.installed).toBe(true);
    expect(messages).toContain("DLL installed, but PHP did not report redis in php -m. Disabled redis automatically so PHP 8.5 can continue running.");
  });
});
