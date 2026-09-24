import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Tersio serves the bundle from an ephemeral 127.0.0.1 port and also
  // exports a file:// snapshot: one self-contained html file, no /assets.
  build: {
    assetsInlineLimit: 100 * 1024 * 1024,
    chunkSizeWarningLimit: 1024,
  },
})
