import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves a project site from https://<user>.github.io/<repo>/,
  // so the built asset URLs need that prefix. The workflow sets VITE_BASE;
  // local dev and user/organisation sites stay at the root.
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy /api to the local stats server so the browser sees a single origin.
    // This is why you don't need to think about CORS in development.
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: { outDir: "dist" },
});
