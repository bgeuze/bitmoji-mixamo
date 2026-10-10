import { defineConfig } from "vite";

// A Web Lens zip needs index.html at its root and every path relative.
export default defineConfig({
  base: "./",
  // bitmoji-anim.js sits one folder up: make it share this playcanvas, not load a second copy.
  resolve: { dedupe: ["playcanvas"] },
  build: { target: "es2020", assetsDir: "a", chunkSizeWarningLimit: 1600 },
});
