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
    // Vitest's default is 5s, which a test that seeds sqlite rows and shells out crosses
    // on a slower machine. One default with headroom beats a per-test timeout everywhere.
    testTimeout: 30000,
    // The dashboard app has its own React, so it runs as its own project.
    projects: [
      {
        test: {
          name: "cli",
          setupFiles: ["./test/setup.ts"],
          exclude: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "dashboard/**"],
        },
      },
      {
        root: path.join(root, "dashboard/app"),
        resolve: { alias: { "@": path.join(root, "dashboard/app/src") } },
        test: {
          name: "dashboard",
          environment: "happy-dom",
          include: ["test/**/*.test.tsx"],
        },
      },
    ],
  },
});
