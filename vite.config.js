import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: ".",
  plugins: [react()],
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: false
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"]
  }
});
