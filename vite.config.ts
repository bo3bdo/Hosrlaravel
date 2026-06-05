import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __LARABOXS_APP_VERSION__: JSON.stringify(packageJson.version)
  },
  build: {
    outDir: "dist-ui",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:47899"
    }
  }
});
