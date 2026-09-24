// Toast notifications. Port of toast() in dashboard/core.js: bottom-right
// stack, accent icon, title + description, 4s auto-dismiss. Same .toaster
// /.toast classes so the original styling carries over.
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
        <div className="toaster" role="status" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className="toast">
              <span className="toast-icon">
                <Icon name={t.icon} className="size-4" />
              </span>
              <div>
                <p className="toast-title">{t.title}</p>
                <p className="toast-desc">{t.desc}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
