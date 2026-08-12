import { useState } from "react";
import { Check, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { badgePreviewSrc } from "@/lib/badge-previews";

/**
 * Visual badge-type selector: a stacked list of selectable rows. Each row leads
 * with a small thumbnail that accents the name as a quick visual clue (not a
 * dominant tile), then the type name, then a tick when selected. When a type's
 * preview image isn't available yet (missing file or load error) the thumbnail
 * falls back to a neutral placeholder, so the picker works before the art
 * exists — drop images into /public/badges/ later and they light up.
 *
 * Same value/onChange shape as before, so callers are unchanged.
 */
export function BadgeTypePicker<BT extends string>({
  value,
  options,
  onChange,
}: {
  value: BT;
  options: readonly BT[];
  onChange: (v: BT) => void;
}) {
  return (
    <div className="space-y-1.5">
      {options.map((t) => (
        <BadgeTypeRow key={t} type={t} selected={t === value} onSelect={() => onChange(t)} />
      ))}
    </div>
  );
}

function BadgeTypeRow({
  type,
  selected,
  onSelect,
}: {
  type: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = badgePreviewSrc(type);
  const showImg = !!src && !failed;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-foreground bg-muted/40 ring-1 ring-foreground"
          : "border-border bg-muted/20 hover:border-foreground/30 hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border",
          selected ? "border-foreground/30 bg-background" : "border-border bg-muted/40",
        )}
      >
        {showImg ? (
          <img
            src={src}
            alt=""
            className="h-full w-full object-contain"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <ImageIcon className="h-4 w-4 text-muted-foreground/50" aria-hidden />
        )}
      </span>
      <span
        className={cn(
          "flex-1 text-sm font-medium",
          selected ? "text-foreground" : "text-foreground/80",
        )}
      >
        {type}
      </span>
      {selected && <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden />}
    </button>
  );
}
