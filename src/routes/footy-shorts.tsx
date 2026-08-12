import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  buildShortsPrompt,
  DEFAULT_SHORTS_DESIGN,
  DESIGN_MODE_LABELS,
  STRIPE_WIDTH_MM,
  type ShortsDesign,
  type ShortsDesignMode,
  type SideStripe,
  type ShortsView,
  legFrameSide,
} from "@/lib/footy-shorts-config";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BuilderTabs } from "@/components/BuilderTabs";
import { BuilderHeader } from "@/components/BuilderHeader";
import { useColourFollow } from "@/hooks/use-colour-follow";
import { SubmitToMakerPanel } from "@/components/SubmitToMakerPanel";
import { toast } from "sonner";
import { consumeBuilderLoadRequest } from "@/lib/builder-load";
import { SwatchGrid, LibraryImageUpload, FontSelect, Card, Field } from "@/components/builder";
import { MoreOptions } from "@/components/builder/MoreOptions";
import { StageSection } from "@/components/builder/StageSection";
import { HelpFab } from "@/components/builder/HelpFab";
import { RenderBox } from "@/components/builder/RenderBox";
import { HistoryThumbGrid } from "@/components/builder/HistoryThumbGrid";
import { WelcomeOverlay, useWelcome } from "@/components/WelcomeOverlay";
import { WELCOME_CONTENT } from "@/lib/welcome-content";
import { makeThumb } from "@/lib/image-utils";
import { ShortsTemplateStage } from "@/components/ShortsTemplateStage";
import {
  effectiveOverlayWidth,
  type OverlayItem,
  type OverlayState,
} from "@/components/CapTemplateStage";
import {
  buildShortsFrontTemplateSvg,
  buildShortsRearTemplateSvg,
} from "@/lib/footy-shorts-template";
import { buildEmbroideryTextSvg } from "@/components/EmbroideryTextOverlay";
import { svgToPngDataUrl } from "@/lib/cap-template";
import type { PlacedArtwork } from "@/lib/svg-artwork";

export const Route = createFileRoute("/footy-shorts")({
  head: () => ({
    meta: [
      { title: "Footy Shorts Designer" },
      {
        name: "description",
        content: "Design custom sublimated Aussie footy shorts — side stripes + leg artwork.",
      },
    ],
  }),
  component: FootyShortsDesigner,
});

// SwatchGrid / ImageUpload / FontSelect / Card / Field are imported from
// `@/components/builder`.

const WIDTHS: SideStripe["width"][] = ["fat", "thick", "mid", "thin"];

/**
 * True when a placement crosses a side seam (x = 0 or x = 1) and therefore
 * continues onto the opposite face of the shorts. Used to render wrap-through
 * copies so front and rear behave as one continuous garment.
 */
function overhangsSeam(s: OverlayState): boolean {
  const half = effectiveOverlayWidth(s) / 2;
  return s.x - half < 0 || s.x + half > 1;
}

function StripeRow({
  stripe,
  onChange,
  onRemove,
}: {
  stripe: SideStripe;
  onChange: (s: SideStripe) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border border-border p-2 space-y-2">
      <div className="flex items-center gap-2">
        <Select
          value={stripe.width}
          onValueChange={(v) => onChange({ ...stripe, width: v as SideStripe["width"] })}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WIDTHS.map((w) => (
              <SelectItem key={w} value={w}>
                {w} (~{STRIPE_WIDTH_MM[w]}mm)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <SwatchGrid selected={stripe.colour} onPick={(c) => onChange({ ...stripe, colour: c })} />
    </div>
  );
}

function FootyShortsDesigner() {
  const [d, setD] = useState<ShortsDesign>(DEFAULT_SHORTS_DESIGN);

  // Consume a pending admin "Open in builder" request (written by the admin panel).
  useEffect(() => {
    const req = consumeBuilderLoadRequest("footy-shorts");
    if (!req) return;
    if (req.design && typeof req.design === "object") {
      setD({ ...DEFAULT_SHORTS_DESIGN, ...(req.design as Partial<ShortsDesign>) });
      toast.success("Design selections loaded from submission.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);
  const set = <K extends keyof ShortsDesign>(k: K, v: ShortsDesign[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const [legLogo, setLegLogo] = useState<string | null>(null);
  const [heroImg, setHeroImg] = useState<string | null>(null);
  const [tileLogo, setTileLogo] = useState<string | null>(null);
  const [layer1, setLayer1] = useState<string | null>(null);
  const [layer2, setLayer2] = useState<string | null>(null);
  const [layer3, setLayer3] = useState<string | null>(null);

  useEffect(() => {
    setD((p) => ({
      ...p,
      hasLegLogo: !!legLogo,
      hasHeroImage: !!heroImg,
      hasTileLogo: !!tileLogo,
      hasLayer1: !!layer1,
      hasLayer2: !!layer2,
      hasLayer3: !!layer3,
    }));
  }, [legLogo, heroImg, tileLogo, layer1, layer2, layer3]);

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const GEN_BUDGET = 15;
  const [genCount, setGenCount] = useState(0);
  const lockRef = useRef(false);

  const [view, setView] = useState<ShortsView>("front");
  const [loading, setLoading] = useState(false);
  const [imageUrlFront, setImageUrlFront] = useState<string | null>(null);
  const [imageUrlRear, setImageUrlRear] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  type Item = { id: string; thumb: string; full: string; design?: ShortsDesign };
  const [historyFront, setHistoryFront] = useState<Item[]>([]);
  const [historyRear, setHistoryRear] = useState<Item[]>([]);

  const imageUrl = view === "front" ? imageUrlFront : imageUrlRear;
  const history = view === "front" ? historyFront : historyRear;
  const setImageUrl = view === "front" ? setImageUrlFront : setImageUrlRear;
  const setHistory = view === "front" ? setHistoryFront : setHistoryRear;

  const livePrompt = useMemo(() => buildShortsPrompt(d, view), [d, view]);

  // ---------- Overlay state (independent front/rear) ----------
  // Default artwork centred on the artworkLeg; wordmark on opposite leg.
  const legX = (leg: "left" | "right", vw: ShortsView): number => {
    // Front: left leg is on the LEFT of the frame; Rear (mirrored): left leg on RIGHT.
    if (vw === "front") return leg === "left" ? 0.28 : 0.72;
    return leg === "left" ? 0.72 : 0.28;
  };
  const [artworkFront, setArtworkFront] = useState<OverlayState>({ x: 0.72, y: 0.55, w: 0.25 });
  const [artworkRear, setArtworkRear] = useState<OverlayState>({ x: 0.72, y: 0.55, w: 0.25 });
  const [textFront, setTextFront] = useState<OverlayState>({ x: 0.28, y: 0.55, w: 0.28 });
  const [textRear, setTextRear] = useState<OverlayState>({ x: 0.28, y: 0.55, w: 0.28 });
  // Layered mode: three placements per view (independent front/rear).
  // Defaults: L1 large background, L2 mid, L3 small hero — all on the
  // artwork leg initially, freely moveable after.
  // Layer 1 (background) is positioned on the FRONT only; the REAR shows the
  // wrap-around continuation derived from this placement automatically.
  const [layer1Front, setLayer1Front] = useState<OverlayState>({ x: 0.72, y: 0.5, w: 0.55 });
  const [layer2Front, setLayer2Front] = useState<OverlayState>({ x: 0.72, y: 0.55, w: 0.3 });
  const [layer3Front, setLayer3Front] = useState<OverlayState>({ x: 0.72, y: 0.55, w: 0.18 });
  const [activeLayer, setActiveLayer] = useState<1 | 2 | 3>(3);

  // Nudge overlays when the artwork leg changes so defaults track the leg.
  const lastLegRef = useRef(d.artworkLeg);
  useEffect(() => {
    if (lastLegRef.current === d.artworkLeg) return;
    lastLegRef.current = d.artworkLeg;
    setArtworkFront((p) => ({ ...p, x: legX(d.artworkLeg, "front") }));
    setArtworkRear((p) => ({ ...p, x: legX(d.artworkLeg, "rear") }));
    const other: "left" | "right" = d.artworkLeg === "left" ? "right" : "left";
    setTextFront((p) => ({ ...p, x: legX(other, "front") }));
    setTextRear((p) => ({ ...p, x: legX(other, "rear") }));
    for (const setter of [setLayer1Front, setLayer2Front, setLayer3Front] as const)
      setter((p) => ({ ...p, x: legX(d.artworkLeg, "front") }));
  }, [d.artworkLeg]);

  const singleArtworkUrl: string | null =
    d.designMode === "logo-one-leg"
      ? legLogo
      : d.designMode === "all-over-image"
        ? heroImg
        : d.designMode === "all-over-tiled"
          ? tileLogo
          : null;
  const singleArtworkLabel =
    d.designMode === "logo-one-leg"
      ? "Leg logo"
      : d.designMode === "all-over-image"
        ? "Hero image"
        : "Tile logo";

  const artworkState = view === "front" ? artworkFront : artworkRear;
  const setArtworkState = view === "front" ? setArtworkFront : setArtworkRear;
  const textState = view === "front" ? textFront : textRear;
  const setTextState = view === "front" ? setTextFront : setTextRear;
  const hasWordmark = !!d.wordmark.trim();

  const wordmarkProps = {
    line1: d.wordmark,
    line2: "",
    font: d.wordmarkFont,
    flow: "straight" as const,
    colour: d.wordmarkColour,
    useOutline: d.wordmarkUseOutline,
    outlineColour: d.wordmarkOutlineColour,
  };
  // The wordmark on this view, plus wrap-through copies of the OTHER view's
  // wordmark when it overhangs a side seam.
  const wordmarkOverlays = [
    {
      id: `${view}-wordmark`,
      label: "Wordmark",
      props: wordmarkProps,
      state: textState,
      onChange: setTextState,
    },
    ...(overhangsSeam(view === "front" ? textRear : textFront)
      ? [-1, 1].map((dx) => {
          const o = view === "front" ? textRear : textFront;
          return {
            id: `${view}-wordmark-wrap${dx > 0 ? "B" : "A"}`,
            label: `Wordmark (wraps from ${view === "front" ? "rear" : "front"})`,
            props: wordmarkProps,
            state: { ...o, x: o.x + dx },
            onChange: () => {},
          };
        })
      : []),
  ];

  // Build the overlays array. For layered mode, all three layers bake into
  // the SVG in paint order (L1 → L2 → L3, all under the outline).
  const stageOverlays = useMemo<OverlayItem[]>(() => {
    const list: OverlayItem[] = [];
    if (d.designMode === "all-over-layered") {
      if (view === "front") {
        if (layer1)
          list.push({
            id: "layer1",
            label: "Layer 1 (background)",
            url: layer1,
            state: layer1Front,
            onChange: setLayer1Front,
          });
        if (layer2)
          list.push({
            id: "layer2",
            label: "Layer 2",
            url: layer2,
            state: layer2Front,
            onChange: setLayer2Front,
          });
        if (layer3)
          list.push({
            id: "layer3",
            label: "Layer 3",
            url: layer3,
            state: layer3Front,
            onChange: setLayer3Front,
          });
      } else {
        const wrapCopies = (id: string, label: string, url: string, front: OverlayState) => {
          list.push({
            id: `${id}-wrapA`,
            label,
            url,
            state: { ...front, x: front.x - 1 },
            onChange: () => {},
          });
          list.push({
            id: `${id}-wrapB`,
            label,
            url,
            state: { ...front, x: front.x + 1 },
            onChange: () => {},
          });
        };
        if (layer1) wrapCopies("layer1", "Layer 1 (wrap)", layer1, layer1Front);
        if (layer2) wrapCopies("layer2", "Layer 2 (wrap)", layer2, layer2Front);
        if (layer3) wrapCopies("layer3", "Layer 3 (wrap)", layer3, layer3Front);
      }
    } else if (singleArtworkUrl) {
      list.push({
        id: `${view}-artwork`,
        label: singleArtworkLabel,
        url: singleArtworkUrl,
        state: artworkState,
        onChange: setArtworkState,
      });
      // Wrap-through: the shorts are one continuous garment, so anything on
      // the OTHER view that overhangs a side seam must also appear here,
      // crossing in from the opposite edge. Copies are non-interactive —
      // drag the original on its own view to move it.
      const other = view === "front" ? artworkRear : artworkFront;
      if (overhangsSeam(other)) {
        list.push({
          id: `${view}-artwork-wrapA`,
          label: `${singleArtworkLabel} (wraps from ${view === "front" ? "rear" : "front"})`,
          url: singleArtworkUrl,
          state: { ...other, x: other.x - 1 },
          onChange: () => {},
        });
        list.push({
          id: `${view}-artwork-wrapB`,
          label: `${singleArtworkLabel} (wraps from ${view === "front" ? "rear" : "front"})`,
          url: singleArtworkUrl,
          state: { ...other, x: other.x + 1 },
          onChange: () => {},
        });
      }
    }
    return list;
  }, [
    d.designMode,
    view,
    singleArtworkUrl,
    singleArtworkLabel,
    layer1,
    layer2,
    layer3,
    layer1Front,
    layer2Front,
    layer3Front,
    artworkState,
    setArtworkState,
    artworkFront,
    artworkRear,
  ]);

  const activeOverlayId =
    d.designMode === "all-over-layered" && view === "front" ? `layer${activeLayer}` : undefined;

  // Copy every placement from the current view to the other view,
  // mirroring x because the rear template is drawn mirrored. Layer
  // placements are excluded — the rear layered composition is the
  // automatic wrap-around continuation of the front placements.
  const addStripe = () => {
    if (d.sideStripes.length >= 4) return;
    set("sideStripes", [...d.sideStripes, { width: "thin", colour: d.baseColour }]);
  };
  const updateStripe = (i: number, s: SideStripe) =>
    set(
      "sideStripes",
      d.sideStripes.map((x, idx) => (idx === i ? s : x)),
    );
  const removeStripe = (i: number) =>
    set(
      "sideStripes",
      d.sideStripes.filter((_, idx) => idx !== i),
    );

  const generate = async () => {
    if (lockRef.current || loading) return;
    if (genCount >= GEN_BUDGET) {
      setError("Generation limit reached.");
      return;
    }
    lockRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const refs: { label: string; url: string }[] = [];
      const artSide = legFrameSide(d.artworkLeg, view);
      const face = view === "rear" ? "rear" : "front";
      const perTemplate =
        "at the exact position, size and rotation shown in the COLOUR-LAYOUT TEMPLATE";
      if (d.designMode === "logo-one-leg" && legLogo) {
        refs.push({
          label: `LEG LOGO — apply once on the ${face} of the leg on the ${artSide} side of the frame only, ${perTemplate}`,
          url: legLogo,
        });
      } else if (d.designMode === "all-over-image" && heroImg) {
        refs.push({
          label: `HERO LEG IMAGE — print on the ${face} of the leg on the ${artSide} side of the frame, covering exactly the area it occupies in the COLOUR-LAYOUT TEMPLATE`,
          url: heroImg,
        });
      } else if (d.designMode === "all-over-tiled" && tileLogo) {
        refs.push({ label: `TILE LOGO — repeat across the ${face} of both legs`, url: tileLogo });
      }
      // In layered mode, the raw layer images are NOT sent as refs; the
      // composited COLOUR-LAYOUT TEMPLATE already contains every layer baked
      // in at the exact position, size and rotation, and is the only
      // artwork reference we send.

      // Build the flat colour-layout template — artwork + wordmark are
      // baked INSIDE the SVG (under the outline paths), so
      // svgToPngDataUrl no longer takes an overlay list.
      const noArt = stageOverlays.length === 0 && !hasWordmark;
      try {
        const tile = d.designMode === "all-over-tiled";
        const artworks: PlacedArtwork[] = [];
        for (const o of stageOverlays) {
          artworks.push({
            url: o.url,
            svg: o.svg,
            x: o.state.x,
            y: o.state.y,
            w: effectiveOverlayWidth(o.state),
            rotation: o.state.rotation,
            tile: tile && !!o.url,
          });
        }
        if (hasWordmark) {
          const textSvg = buildEmbroideryTextSvg({
            line1: d.wordmark,
            line2: "",
            font: d.wordmarkFont,
            flow: "straight",
            colour: d.wordmarkColour,
            useOutline: d.wordmarkUseOutline,
            outlineColour: d.wordmarkOutlineColour,
          });
          if (textSvg) {
            artworks.push({
              svg: textSvg,
              x: textState.x,
              y: textState.y,
              w: effectiveOverlayWidth(textState),
              rotation: textState.rotation,
            });
            // Wrap-through from the opposite face: if the wordmark on the
            // other view crosses a side seam, the overhanging part continues
            // onto this face.
            const otherText = view === "front" ? textRear : textFront;
            if (overhangsSeam(otherText)) {
              for (const dx of [-1, 1]) {
                artworks.push({
                  svg: textSvg,
                  x: otherText.x + dx,
                  y: otherText.y,
                  w: effectiveOverlayWidth(otherText),
                  rotation: otherText.rotation,
                });
              }
            }
          }
        }
        const svg =
          view === "front"
            ? await buildShortsFrontTemplateSvg(d, artworks)
            : await buildShortsRearTemplateSvg(d, artworks);
        const templateDataUrl = await svgToPngDataUrl(svg, 1536);
        const angle = view === "front" ? "FRONT" : "REAR";
        const layered = d.designMode === "all-over-layered";
        refs.push({
          label:
            (layered
              ? `COLOUR-LAYOUT TEMPLATE — this flat schematic IS the complete, final design for these footy shorts (the ${angle} of the shorts). The artwork composited inside it is the client's exact layered print: reproduce that artwork at exactly the position, size, rotation and coverage shown — the printed area must not grow, shrink, move or repeat. Everything outside the printed area is plain fabric in the colours shown. Render this schematic as photorealistic product photography; do NOT copy the line-art style, flat fills or outlines.`
              : `COLOUR-LAYOUT TEMPLATE — a flat schematic of the footy shorts (the ${angle} of the shorts) showing which colour goes on which part: body colour, side-panel base colour, and ONLY the stripe bands shown, in that exact outer-seam-inwards order. Composited artwork or wordmark indicates the EXACT position, size and orientation on the finished shorts. Follow it exactly; it is a flat colour guide — render as photorealistic product photography, do NOT copy the line-art style, flat fills or outlines.`) +
            (noArt
              ? " NO ARTWORK OR TEXT — do NOT invent any logo, badge or lettering on the shorts; keep the fabric clean."
              : ""),
          url: templateDataUrl,
        });
      } catch (err) {
        console.warn("Footy shorts template rasterisation failed; continuing.", err);
      }

      const doFetch = () =>
        fetch("/api/generate-footy-shorts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: livePrompt, labeledReferences: refs }),
        });
      let res = await doFetch();
      if ((res.status === 429 || res.status === 502) && !res.ok) {
        await new Promise((r) => setTimeout(r, 2000));
        res = await doFetch();
      }
      const data = (await res.json()) as { imageUrl?: string; error?: string };
      if (!res.ok || !data.imageUrl) throw new Error(data.error ?? "Generation failed");
      const full = data.imageUrl;
      setImageUrl(full);
      const thumb = await makeThumb(full).catch(() => full);
      setHistory((h: Item[]) =>
        [
          { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, thumb, full, design: d },
          ...h,
        ].slice(0, 12),
      );
      setGenCount((c) => c + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
      setTimeout(() => {
        lockRef.current = false;
      }, 1200);
    }
  };

  const welcome = useWelcome();
  // Linked defaults: waistband + drawcord follow the body colour until diverged.
  useColourFollow(d.baseColour, d.waistbandColour, (s) =>
    set("waistbandColour", s as typeof d.waistbandColour),
  );
  useColourFollow(d.baseColour, d.drawcordColour, (s) =>
    set("drawcordColour", s as typeof d.drawcordColour),
  );

  const [openStage, setOpenStage] = useState(1);
  const toggleStage = (n: number) => setOpenStage((cur) => (cur === n ? 0 : n));
  const STAGE_LIST = [
    { step: 1, title: "Design & colours" },
    { step: 2, title: "Artwork" },
    { step: 3, title: "Finishing" },
  ];
  const goToStage = (n: number) => {
    setOpenStage(n);
    // Jump back to the top so the newly opened stage starts in view instead of
    // leaving the reader stranded at the bottom of the previous one.
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <WelcomeOverlay
        open={welcome.open}
        productName={WELCOME_CONTENT["footy-shorts"].productName}
        slides={WELCOME_CONTENT["footy-shorts"].slides}
        onDone={welcome.dismiss}
      />
      <BuilderTabs active="footy-shorts" hasUnsavedWork={history.length > 0} />
      {!welcome.open && welcome.hydrated && (
        <HelpFab onClick={welcome.replay} label="Show intro again" />
      )}
      <BuilderHeader
        title="Footy Shorts Designer"
        subtitle="AFL-cut footy shorts — design front & rear views."
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      />

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-start">
        <section className="order-2 space-y-4 preview-col">
          <div className="flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {(["front", "rear"] as ShortsView[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium uppercase tracking-wide",
                    view === v
                      ? "bg-foreground text-background"
                      : "bg-transparent text-muted-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {d.designMode === "all-over-layered"
                ? "Position layers on the front — the rear automatically shows only what wraps past the side seams."
                : "Drag artwork or wordmark to position. Each view can hold different artwork; anything overhanging a side seam wraps around and shows on the other view."}
            </span>
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Colour layout template
              </span>
              <span className="text-[10px] text-muted-foreground">
                {view === "front" ? "Front" : "Rear"} view
              </span>
            </div>
            <ShortsTemplateStage
              view={view}
              design={d}
              className="mx-auto w-full max-w-[420px] rounded-lg bg-zinc-600"
              tile={d.designMode === "all-over-tiled"}
              overlays={stageOverlays}
              activeOverlayId={activeOverlayId}
              onSelectOverlay={(id) => {
                const n = Number(id.replace("layer", ""));
                if (n === 1 || n === 2 || n === 3) setActiveLayer(n as 1 | 2 | 3);
              }}
              textOverlays={hasWordmark ? wordmarkOverlays : []}
            />
            {d.designMode === "all-over-layered" && view === "front" && (
              <div className="mt-2 flex items-center justify-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Active layer:
                </span>
                {([1, 2, 3] as const).map((n) => {
                  const enabled =
                    (n === 1 && !!layer1) || (n === 2 && !!layer2) || (n === 3 && !!layer3);
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setActiveLayer(n)}
                      disabled={!enabled}
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[11px] font-medium",
                        activeLayer === n
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-transparent text-muted-foreground",
                        !enabled && "opacity-40 cursor-not-allowed",
                      )}
                    >
                      L{n}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <RenderBox
            loading={loading}
            imageUrl={imageUrl}
            alt="Generated footy shorts"
            productLabel="footy shorts"
          />

          <div className="flex items-center gap-2">
            <Button
              onClick={generate}
              disabled={loading || genCount >= GEN_BUDGET}
              className="min-w-32"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
                </>
              ) : genCount >= GEN_BUDGET ? (
                "Limit reached"
              ) : (
                `Generate (${genCount}/${GEN_BUDGET})`
              )}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          {<HistoryThumbGrid history={history} current={imageUrl} onSelect={setImageUrl} />}
          <SubmitToMakerPanel
            productType="footy-shorts"
            images={history.map((h) => h.full)}
            settings={history.map((h) =>
              h.design ? ({ design: h.design } as Record<string, unknown>) : null,
            )}
            viewLabel="footy shorts"
          />
        </section>

        <aside className="order-1 space-y-3">
          <StageSection
            step={1}
            title="Design & colours"
            subtitle="Print style, body colour & side stripes"
            open={openStage === 1}
            onToggle={() => toggleStage(1)}
            onNext={() => goToStage(2)}
            nextLabel="Continue to Artwork"
          >
            <Card title="Design">
              <Field label="Print style">
                <Select
                  value={d.designMode}
                  onValueChange={(v) => set("designMode", v as ShortsDesignMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DESIGN_MODE_LABELS) as ShortsDesignMode[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {DESIGN_MODE_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </Card>

            <Card title="Body colour">
              <SwatchGrid selected={d.baseColour} onPick={(s) => set("baseColour", s)} />
            </Card>

            <Card title="Side panel stripes">
              <div className="space-y-3">
                <Field label="Side panel base colour">
                  <SwatchGrid
                    selected={d.sidePanelBaseColour}
                    onPick={(s) => set("sidePanelBaseColour", s)}
                  />
                </Field>
                <div className="space-y-2">
                  {d.sideStripes.map((s, i) => (
                    <StripeRow
                      key={i}
                      stripe={s}
                      onChange={(ns) => updateStripe(i, ns)}
                      onRemove={() => removeStripe(i)}
                    />
                  ))}
                  {d.sideStripes.length < 4 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addStripe}
                      className="w-full"
                    >
                      <Plus className="mr-1 h-4 w-4" /> Add stripe ({d.sideStripes.length}/4)
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Stripes run vertically down the outer side panel of BOTH legs, mirrored.
                </p>
              </div>
            </Card>
          </StageSection>

          <StageSection
            step={2}
            title="Artwork & wordmark"
            subtitle="Logos, prints & team name"
            open={openStage === 2}
            onToggle={() => toggleStage(2)}
            onNext={() => goToStage(3)}
            nextLabel="Continue to Finishing"
          >
            {d.designMode === "logo-one-leg" && (
              <Card title="Leg logo">
                <Field label="Logo for the leg">
                  <LibraryImageUpload
                    builder="footy-shorts"
                    assetType="side_logo"
                    label="Upload leg logo"
                    value={legLogo}
                    onChange={setLegLogo}
                  />
                </Field>
              </Card>
            )}
            {d.designMode === "all-over-image" && (
              <Card title="Hero leg image">
                <Field label="Full-leg image">
                  <LibraryImageUpload
                    builder="footy-shorts"
                    assetType="hero"
                    label="Upload hero image"
                    value={heroImg}
                    onChange={setHeroImg}
                  />
                </Field>
              </Card>
            )}
            {d.designMode === "all-over-tiled" && (
              <Card title="Tiled logo">
                <Field label="Logo to tile across both legs">
                  <LibraryImageUpload
                    builder="footy-shorts"
                    assetType="tile"
                    label="Upload tile logo"
                    value={tileLogo}
                    onChange={setTileLogo}
                  />
                </Field>
              </Card>
            )}
            {d.designMode === "all-over-layered" && (
              <Card title="Layered composition">
                <div className="space-y-3">
                  <Field label="Layer 1 – background">
                    <LibraryImageUpload
                      builder="footy-shorts"
                      assetType="layer"
                      label="Upload background"
                      value={layer1}
                      onChange={setLayer1}
                    />
                  </Field>
                  <Field label="Layer 2 – mid-ground">
                    <LibraryImageUpload
                      builder="footy-shorts"
                      assetType="layer"
                      label="Upload mid-ground graphic"
                      value={layer2}
                      onChange={setLayer2}
                    />
                  </Field>
                  <Field label="Layer 3 – hero / focal">
                    <LibraryImageUpload
                      builder="footy-shorts"
                      assetType="layer"
                      label="Upload hero logo"
                      value={layer3}
                      onChange={setLayer3}
                    />
                  </Field>
                </div>
              </Card>
            )}

            {d.designMode !== "all-over-tiled" && (
              <Card title="Wordmark (optional)">
                <div className="space-y-3">
                  <Field label="Text">
                    <Input
                      value={d.wordmark}
                      onChange={(e) => set("wordmark", e.target.value)}
                      placeholder="TEAM NAME"
                    />
                  </Field>
                  <MoreOptions label="More options">
                    <Field label="Font">
                      <FontSelect value={d.wordmarkFont} onChange={(v) => set("wordmarkFont", v)} />
                    </Field>
                    <Field label="Text colour">
                      <SwatchGrid
                        selected={d.wordmarkColour}
                        onPick={(s) => set("wordmarkColour", s)}
                      />
                    </Field>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={d.wordmarkUseOutline}
                        onCheckedChange={(v) => set("wordmarkUseOutline", !!v)}
                      />
                      Outline
                    </label>
                    {d.wordmarkUseOutline && (
                      <Field label="Outline colour">
                        <SwatchGrid
                          selected={d.wordmarkOutlineColour}
                          onPick={(s) => set("wordmarkOutlineColour", s)}
                        />
                      </Field>
                    )}
                  </MoreOptions>
                </div>
              </Card>
            )}
          </StageSection>

          <StageSection
            step={3}
            title="Finishing touches"
            subtitle="Waistband & drawcord colours"
            open={openStage === 3}
            onToggle={() => toggleStage(3)}
          >
            <Card title="Waistband & drawcord">
              <div className="space-y-3">
                <Field label="Waistband colour">
                  <SwatchGrid
                    selected={d.waistbandColour}
                    onPick={(s) => set("waistbandColour", s)}
                  />
                </Field>
                <Field label="Drawcord colour">
                  <SwatchGrid
                    selected={d.drawcordColour}
                    onPick={(s) => set("drawcordColour", s)}
                  />
                </Field>
              </div>
            </Card>
          </StageSection>
        </aside>
      </main>
    </div>
  );
}
