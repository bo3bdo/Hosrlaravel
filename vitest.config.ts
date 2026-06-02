import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      LARABOXS_SECRET_FALLBACK: "1"
    },
    include: ["tests/**/*.test.ts"]
  }
});
