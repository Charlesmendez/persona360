import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist"
  },
  resolve: {
    alias: {
      "@viewer": resolve(__dirname, "src")
    }
  }
});
