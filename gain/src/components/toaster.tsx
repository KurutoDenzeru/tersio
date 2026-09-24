// Toast notifications. Port of toast() in dashboard/core.js: bottom-right
// stack, accent icon, title + description, 4s auto-dismiss.
import { createContext, useCallback, useContext, useState } from "react";
import { Icon } from "./icon";

interface Toast {
  id: number;
  title: string;
  desc: string;
  icon: string;
}

const ToastCtx = createContext<(title: string, desc: string, icon?: string) => void>(() => {});

export const useToast = (): ((title: string, desc: string, icon?: string) => void) => useContext(ToastCtx);

let nextId = 1;

export function ToasterProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((title: string, desc: string, icon = "check") => {
    const id = nextId++;
    setItems((prev) => [...prev, { id, title, desc, icon }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {items.length > 0 && (
        <div
          className="fixed bottom-4 right-4 z-100 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2 overflow-visible border-0 bg-transparent p-0"
          role="status"
          aria-live="polite"
        >
          {items.map((t) => (
            <div
              key={t.id}
              className="flex items-start gap-2.5 rounded-xl border border-line bg-panel px-3.5 py-3 shadow-[var(--shadow-xs),0_8px_24px_rgba(0,0,0,.22)] animate-toast-in"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                <Icon name={t.icon} className="size-4" />
              </span>
              <div>
                <p className="m-0 text-[13px] font-semibold">{t.title}</p>
                <p className="my-px mb-0 text-xs text-dim">{t.desc}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
