// Dynamic Lucide icons by name. The original dashboard referenced icons by
// string (data-lucide); this keeps that language over lucide-react.
import { CircleQuestionMark, icons } from "lucide-react";
import { useMemo } from "react";

function toPascal(name: string): string {
  return name
    .split("-")
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join("");
}

export function Icon({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  const Cmp = useMemo(() => {
    const key = toPascal(name);
    const found = (icons as Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>>)[key];
    if (!found && import.meta.env.DEV) console.warn(`[Icon] "${name}" -> ${key} not in lucide, showing fallback`);
    return found ?? CircleQuestionMark;
  }, [name]);
  return <Cmp className={className} style={style} />;
}
