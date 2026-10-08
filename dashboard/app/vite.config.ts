import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

// Vite's native config loader does not support __dirname; this is the one warning `bun run verify` prints.
const here = import.meta.dirname

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(here, "./src"),
    },
  },
  // src/lib/carbon.ts reuses the CLI's EcoLogits port, so the dev server must
  // be allowed to read above dashboard/app.
  server: {
    fs: {
      allow: [path.resolve(here, "../..")],
    },
  },
  // Tersio serves the bundle from an ephemeral 127.0.0.1 port and also
  // exports a file:// snapshot: one self-contained html file, no /assets.
  build: {
    outDir: path.resolve(here, "../dist"),
    emptyOutDir: true,
    assetsInlineLimit: 100 * 1024 * 1024,
    chunkSizeWarningLimit: 1024,
  },
})
