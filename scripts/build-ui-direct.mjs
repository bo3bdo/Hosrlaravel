import { readFileSync } from "node:fs";
import { build } from "vite";
import react from "@vitejs/plugin-react";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

await build({
  configFile: false,
  base: "./",
  plugins: [react()],
  define: {
    __LARABOXS_APP_VERSION__: JSON.stringify(packageJson.version)
  },
  build: {
    outDir: "dist-ui",
    emptyOutDir: true
  }
});
