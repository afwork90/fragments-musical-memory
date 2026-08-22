import path from "node:path";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: ["essentia.js"],
  },
  plugins: [vinext()],
});
