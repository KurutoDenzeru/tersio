// Accent chips; each previews its resolved colour for the active theme.
import { useResolvedTheme } from "@/components/theme-provider";
import { ACCENTS, ACCENT_IDS, accentSwatch, type AccentId } from "@/lib/accent";

// Native radio group; each chip previews its resolved hex.
export function AccentPicker({ accent, onPick }: { accent: AccentId; onPick: (id: AccentId) => void }) {
  const dark = useResolvedTheme() === "dark";
  return (
    <fieldset className="m-0 shrink-0 border-0 p-0">
      <legend className="sr-only">Accent color</legend>
      <div className="flex items-center gap-1.5">
        {ACCENT_IDS.map((id) => {
          const on = id === accent;
          const hex = accentSwatch(id, dark);
          return (
            <label key={id} className="grid size-7 cursor-pointer place-items-center rounded-full">
              <input
                type="radio"
                name="accent-color"
                value={id}
                checked={on}
                onChange={() => onPick(id)}
                className="peer absolute size-7 appearance-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
              <span
                aria-hidden="true"
                className="size-6 rounded-full peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                style={{
                  background: hex,
                  // The selected chip rings twice; an unselected one never does.
                  ...(on ? { boxShadow: `0 0 0 2px var(--panel), 0 0 0 4px ${hex}` } : {}),
                }}
              />
              <span className="sr-only">{ACCENTS[id].label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
