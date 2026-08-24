import path from "node:path";
import vinext from "vinext";
import { defineConfig } from "vite";
import { libraryDevServer } from "./lib/dev/library-dev-server";

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
  plugins: [libraryDevServer(), vinext()],
});
