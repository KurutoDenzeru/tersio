import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// setupFiles sandboxes pi's agent directory for every test file; see test/setup.ts.
export default defineConfig({
  resolve: {
    alias: { "@": path.join(root, "dashboard/app/src") },
  },
  test: {
    // The dashboard app has its own React, so it runs as its own project.
    projects: [
      {
        test: {
          name: "cli",
          setupFiles: ["./test/setup.ts"],
          exclude: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "dashboard/**"],
          // These tests spawn the CLI and set their own inner timeouts of up to 30s. The 5s default
          // shorter than those, so a slow machine reported a bare "timed out" instead of the real
          // failure, and whether it passed depended on load. Keep this above the largest inner timeout.
          testTimeout: 60000,
          hookTimeout: 30000,
        },
      },
      {
        root: path.join(root, "dashboard/app"),
        resolve: { alias: { "@": path.join(root, "dashboard/app/src") } },
        test: {
          name: "dashboard",
          environment: "happy-dom",
          // Both extensions: a pattern of only .tsx silently skipped a .test.ts file.
          include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
        },
      },
    ],
  },
});
