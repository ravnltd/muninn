import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte({ compilerOptions: { generate: "client" } as Record<string, unknown> })],
  resolve: {
    conditions: ["browser", "module", "import"],
  },
  build: {
    outDir: "../../dashboard-dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:3334",
    },
  },
});
