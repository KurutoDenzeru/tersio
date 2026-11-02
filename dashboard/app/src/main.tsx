import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import "./textures.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider storageKey="tersio-theme">
      <App />
    </ThemeProvider>
  </StrictMode>
)

// A production build ships no HMR client. The server exposes the bundle's build id, so an open tab
// reloads itself once vite rewrites dist; a static export has no such endpoint and stays quiet.
if (location.protocol === "http:" || location.protocol === "https:") {
  let seen: string | null = null;
  const pollBuild = async (): Promise<void> => {
    try {
      const res = await fetch("/api/build", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { id?: string };
      if (!body.id) return;
      if (seen === null) { seen = body.id; return; }
      if (body.id !== seen) location.reload();
    } catch { /* offline or a static host: nothing to reload from */ }
  };
  void pollBuild();
  window.setInterval(() => void pollBuild(), 1000);
}
