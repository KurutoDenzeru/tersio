// Toast notifications: bottom-right stack, moving bottom-left only while a right-side drawer is open. Accent icon, title + description.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "./icon";

export interface ToastAction {
  label: string;
  /** `primary` fills the button; the rest stay outlined. */
  variant?: "primary" | "outline";
  onClick: () => void;
}

export interface ToastSpec {
  /** Reusing an id replaces that toast in place, so a poll cannot stack copies of one notice. */
  id: string;
  title: string;
  desc: string;
  icon?: string;
  actions?: ToastAction[];
}

interface Item extends ToastSpec {
  key: string;
}

type PushToast = (title: string, desc: string, icon?: string) => void;
type PushAction = (spec: ToastSpec) => void;
type DismissToast = (id: string) => void;

const ToastCtx = createContext<PushToast>(() => {});
const ActionCtx = createContext<PushAction>(() => {});
const DismissCtx = createContext<DismissToast>(() => {});

export const useToast = (): PushToast => useContext(ToastCtx);
export const useActionToast = (): PushAction => useContext(ActionCtx);
export const useDismissToast = (): DismissToast => useContext(DismissCtx);

const AUTO_MS = 4200;
let nextId = 1;

export function ToasterProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  // A right-side drawer would cover the default corner, so the stack moves left while one is mounted.
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    const sync = (): void => setDrawerOpen(document.querySelector("[data-slot=drawer-popup][data-open]") !== null);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => observer.disconnect();
  }, []);

  const push = useCallback<PushToast>((title, desc, icon = "check") => {
    const key = `simple-${nextId++}`;
    setItems((prev) => [...prev, { key, id: key, title, desc, icon }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.key !== key));
    }, AUTO_MS);
  }, []);

  const pushAction = useCallback<PushAction>((spec) => {
    const key = `action-${spec.id}`;
    setItems((prev) => [...prev.filter((t) => t.key !== key), { ...spec, key }]);
  }, []);

  const dismiss = useCallback<DismissToast>((id) => {
    setItems((prev) => prev.filter((t) => t.key !== `action-${id}`));
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      <ActionCtx.Provider value={pushAction}>
        <DismissCtx.Provider value={dismiss}>
          {children}
          {items.length > 0 && (
            <div
              className={`fixed bottom-4 ${drawerOpen ? "left-4" : "right-4"} z-100 w-[min(452px,calc(100vw-32px))] flex-col gap-2 overflow-visible border-0 bg-transparent p-0`}
              role="status"
              aria-live="polite"
            >
              {items.map((t) => {
                // Actions take their own row: three of them never fit beside the text legibly.
                const actions = t.actions && t.actions.length > 0 ? t.actions : null;
                return (
                  <div
                    key={t.key}
                    className="flex flex-col gap-2.5 rounded-xl border border-line bg-panel px-3.5 py-3 shadow-[var(--shadow-xs),0_8px_24px_rgba(0,0,0,.22)] animate-toast-in"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                        <Icon name={t.icon ?? "check"} className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-[13px] font-semibold">{t.title}</p>
                        <p className="my-px mb-0 text-xs text-dim">{t.desc}</p>
                      </div>
                      {actions && (
                        <button
                          type="button"
                          className="-mt-0.5 -mr-0.5 grid size-5 shrink-0 place-items-center rounded-md text-dim hover:bg-track hover:text-ink"
                          aria-label={`Dismiss ${t.title}`}
                          onClick={() => dismiss(t.id)}
                        >
                          <Icon name="x" className="size-3" />
                        </button>
                      )}
                    </div>
                    {actions && (
                      <div className="flex flex-wrap items-center gap-1.5 pl-[38px]">
                        {/* Picking dismisses the notice: every action already reports its own outcome. */}
                        {actions.map((action) => (
                          <Button
                            key={action.label}
                            size="sm"
                            variant={action.variant === "primary" ? "default" : "outline"}
                            className="mono h-7 rounded-lg px-2.5 text-[11px]"
                            onClick={() => {
                              dismiss(t.id);
                              action.onClick();
                            }}
                          >
                            {action.label}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DismissCtx.Provider>
      </ActionCtx.Provider>
    </ToastCtx.Provider>
  );
}