import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Safety net: force every test worker into a throwaway laraboxs home so a test
// that forgets to set LARABOXS_HOME can never touch the real ~/.config/laraboxs
// (this happened once and overwrote installed service binaries with fakes).
const vitestHome = mkdtempSync(path.join(os.tmpdir(), "laraboxs-vitest-"));

export default defineConfig({
  test: {
    environment: "node",
    env: {
      LARABOXS_SECRET_FALLBACK: "1",
      LARABOXS_HOME: vitestHome,
      LARABOXS_HOSTS_FILE: path.join(vitestHome, "hosts")
    },
    include: ["tests/**/*.test.ts"]
  }
});
