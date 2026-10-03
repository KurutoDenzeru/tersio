import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
// setupFiles sandboxes pi's agent directory for every test file; see test/setup.ts.
export default defineConfig({
    resolve: {
        alias: { "@": path.join(path.dirname(fileURLToPath(import.meta.url)), "dashboard/app/src") },
    },
    test: {
        setupFiles: ["./test/setup.ts"],
    },
});
