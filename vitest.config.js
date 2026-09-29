import { defineConfig } from "vitest/config";
// setupFiles sandboxes pi's agent directory for every test file; see test/setup.ts.
export default defineConfig({
    test: {
        setupFiles: ["./test/setup.ts"],
    },
});
