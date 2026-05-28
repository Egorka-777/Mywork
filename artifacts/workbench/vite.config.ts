import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiPort = Number(process.env.WORKBENCH_API_PORT) || 8788;
const radarApiPort = Number(process.env.INSTAGRAM_RADAR_API_PORT) || 8789;
const assetVaultApiPort = Number(process.env.ASSET_VAULT_API_PORT) || 8790;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: Number(process.env.PORT) || 5180,
    host: "0.0.0.0",
    allowedHosts: true,
    strictPort: true,
    proxy: {
      "/wb/instagram-radar": { target: `http://127.0.0.1:${radarApiPort}` },
      "/wb/assets": { target: `http://127.0.0.1:${assetVaultApiPort}` },
      "/wb": { target: `http://127.0.0.1:${apiPort}` },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
