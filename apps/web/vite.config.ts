import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: process.env.BACKSTOP_WEB_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5210,
    strictPort: true,
    proxy: {
      "/api/repair-jobs": "http://127.0.0.1:8842",
      "/api": "http://127.0.0.1:8840",
    },
  },
  preview: { port: 5210, strictPort: true },
  build: { outDir: "dist", assetsInlineLimit: 0 },
});
