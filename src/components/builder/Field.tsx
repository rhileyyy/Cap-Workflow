import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** Labelled form row used inside builder cards. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-foreground/70">{label}</Label>
      {children}
    </div>
  );
}