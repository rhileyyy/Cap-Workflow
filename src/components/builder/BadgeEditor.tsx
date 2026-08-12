import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BadgeTypePicker, Field, FontSelect, ImageUpload, SwatchGrid } from "@/components/builder";
import { MoreOptions } from "@/components/builder/MoreOptions";
import type { Swatch } from "@/lib/beanie-config";
import type { AssetType } from "@/hooks/use-asset-library";

/**
 * BadgeEditor — the shared front-badge customiser used by the bucket hat and
 * straw hat builders, whose badge cards were previously verbatim duplicates.
 * Each builder passes its own badge-type list, leather options, builder key
 * and recolour label; the design field names are identical in both.
 *
 * (The cap and beanie badge editors remain builder-specific by design — they
 * have different interaction models: the cap composites text overlays onto the
 * template, the beanie uses BadgeUploader with analysis.)
 */

export type BadgeEditorFields<BT extends string, BS extends string> = {
  badgeType: BT;
  badgeShape: BS;
  badgeRounded: boolean;
  leatherDuoId: string;
  leatherDistressed: boolean;
  badgeLine1: string;
  badgeLine2: string;
  badgeFont: string;
  badgeColour: Swatch;
  badgeUseOutline: boolean;
  badgeOutlineColour: Swatch;
  badgeMatchMain: boolean;
};

export function BadgeEditor<BT extends string, BS extends string>({
  d,
  set,
  badgeTypes,
  badgeShapes,
  leatherOptions,
  builder,
  assetType = "badge" as AssetType,
  recolourLabel,
  badgeImg,
  onBadgeImg,
}: {
  d: BadgeEditorFields<BT, BS>;
  set: <K extends keyof BadgeEditorFields<BT, BS>>(key: K, value: BadgeEditorFields<BT, BS>[K]) => void;
  badgeTypes: readonly BT[];
  badgeShapes: readonly BS[];
  leatherOptions: readonly { id: string; label: string }[];
  builder: string;
  assetType?: AssetType;
  recolourLabel: string;
  badgeImg: string | null;
  onBadgeImg: (v: string | null) => void;
}) {
  return (
    <div className="space-y-3">
      {/* Essentials: the logo and the main line of text */}
      <Field label="Logo artwork">
        <ImageUpload
          label="Upload badge artwork"
          value={badgeImg}
          onChange={onBadgeImg}
          builder={builder}
          assetType={assetType}
        />
      </Field>

      <Field label="Line 1">
        <Input
          value={d.badgeLine1}
          onChange={(e) => set("badgeLine1", e.target.value)}
          placeholder="MAIN TEXT"
        />
      </Field>

      {/* Everything a beginner can ignore — one tuck, all defaulted */}
      <MoreOptions label="More options">
        <Field label="Badge type">
          <BadgeTypePicker
            value={d.badgeType}
            options={badgeTypes}
            onChange={(v) => set("badgeType", v)}
          />
        </Field>

        <Field label="Shape">
          <Select value={d.badgeShape} onValueChange={(v) => set("badgeShape", v as BS)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {badgeShapes.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {(d.badgeShape === "rectangle" || d.badgeShape === "square") && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={d.badgeRounded} onCheckedChange={(v) => set("badgeRounded", !!v)} />
            Rounded corners
          </label>
        )}

        {d.badgeType === "leather debossed" && (
          <>
            <Field label="Leather & deboss">
              <Select value={d.leatherDuoId} onValueChange={(v) => set("leatherDuoId", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {leatherOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={d.leatherDistressed} onCheckedChange={(v) => set("leatherDistressed", !!v)} />
              Distressed finish
            </label>
          </>
        )}

        <Field label="Line 2 (optional)">
          <Input value={d.badgeLine2} onChange={(e) => set("badgeLine2", e.target.value)} placeholder="SUBTEXT" />
        </Field>
        <Field label="Font">
          <FontSelect value={d.badgeFont} onChange={(v) => set("badgeFont", v)} />
        </Field>
        <Field label="Thread colour">
          <SwatchGrid selected={d.badgeColour} onPick={(s) => set("badgeColour", s)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={d.badgeUseOutline} onCheckedChange={(v) => set("badgeUseOutline", !!v)} />
          Outline
        </label>
        {d.badgeUseOutline && (
          <Field label="Outline colour">
            <SwatchGrid selected={d.badgeOutlineColour} onPick={(s) => set("badgeOutlineColour", s)} />
          </Field>
        )}

        {badgeImg && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={d.badgeMatchMain} onCheckedChange={(v) => set("badgeMatchMain", !!v)} />
            {recolourLabel}
          </label>
        )}
      </MoreOptions>
    </div>
  );
}
