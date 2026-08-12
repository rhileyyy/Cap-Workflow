import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  STITCH_PALETTE_GROUPS,
  buildStubbyPrompt,
  DEFAULT_STUBBY_DESIGN,
  DESIGN_MODE_LABELS,
  EDGE_FINISH_LABELS,
  type StubbyDesign,
  type StubbyDesignMode,
  type EdgeFinish,
  type Swatch,
} from "@/lib/stubby-config";

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
import { StageSection } from "@/components/builder/StageSection";
import { HelpFab } from "@/components/builder/HelpFab";
import { RenderBox } from "@/components/builder/RenderBox";
import { HistoryThumbGrid } from "@/components/builder/HistoryThumbGrid";
import { WelcomeOverlay, useWelcome } from "@/components/WelcomeOverlay";
import { WELCOME_CONTENT } from "@/lib/welcome-content";
import { SubmitToMakerPanel } from "@/components/SubmitToMakerPanel";
import { toast } from "sonner";
import { consumeBuilderLoadRequest } from "@/lib/builder-load";
import { SwatchGrid, LibraryImageUpload, FontSelect, Card, Field } from "@/components/builder";
import { MoreOptions } from "@/components/builder/MoreOptions";
import { makeThumb } from "@/lib/image-utils";
import { StubbyTemplate } from "@/components/StubbyTemplate";
import {
  DraggableOverlay,
  DraggableTextOverlay,
  SelectableOverlayTarget,
  effectiveOverlayWidth,
  type OverlayItem,
  type OverlayState,
  type TextOverlayItem,
} from "@/components/CapTemplateStage";
import { buildStubbyTemplateSvg } from "@/lib/stubby-template";
import { buildEmbroideryTextSvg } from "@/components/EmbroideryTextOverlay";
import { svgToPngDataUrl } from "@/lib/cap-template";
import type { PlacedArtwork } from "@/lib/svg-artwork";

export const Route = createFileRoute("/stubby")({
  head: () => ({
    meta: [
      { title: "Stubby Holder Designer" },
      {
        name: "description",
        content:
          "Design custom sublimated neoprene stubby holders — plain + logo or full all-over print.",
      },
    ],
  }),
  component: StubbyDesigner,
});

function StubbyStage({
  design,
  overlays,
  textOverlays,
  tile,
  wrap,
  activeOverlayId,
  onSelectOverlay,
}: {
  design: StubbyDesign;
  overlays: OverlayItem[];
  textOverlays?: TextOverlayItem[];
  tile?: boolean;
  wrap?: boolean;
  activeOverlayId?: string;
  onSelectOverlay?: (id: string) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  // Bake overlays into the template SVG so artwork paints UNDER the
  // holder outlines. The DOM overlays stay for interaction only.
  const artworks: PlacedArtwork[] = [];
  // Panel centres in the 2552x1295 viewBox (see stubby-template.svg).
  const PANEL_XS = [0.156, 0.499, 0.844] as const;
  const pushArt = (a: PlacedArtwork) => {
    artworks.push(a);
    if (wrap && !a.tile) {
      // Replicate the drawn artwork onto the other two panels so the
      // schematic reads as continuous wrap around the cylinder.
      for (const px of PANEL_XS) {
        if (Math.abs(px - a.x) < 0.05) continue;
        artworks.push({ ...a, x: px });
      }
    }
  };
  for (const o of overlays) {
    pushArt({
      url: o.url,
      svg: o.svg,
      x: o.state.x,
      y: o.state.y,
      w: effectiveOverlayWidth(o.state),
      rotation: o.state.rotation,
      tile: !!tile && !!o.url,
    });
  }
  for (const t of textOverlays ?? []) {
    const hasText = !!(t.props.line1.trim() || t.props.line2.trim());
    if (!hasText) continue;
    const svg = buildEmbroideryTextSvg(t.props);
    if (!svg) continue;
    pushArt({
      svg,
      x: t.state.x,
      y: t.state.y,
      w: effectiveOverlayWidth(t.state),
      rotation: t.state.rotation,
    });
  }
  return (
    <div ref={stageRef} className="relative mx-auto w-full max-w-[720px] rounded-lg bg-zinc-600">
      <StubbyTemplate
        design={design}
        artworks={artworks}
        className="[&_svg]:h-auto [&_svg]:w-full"
      />
      {overlays.map((o) =>
        !activeOverlayId || o.id === activeOverlayId ? (
          <DraggableOverlay key={o.id} item={o} stageRef={stageRef} invisibleContent />
        ) : (
          <SelectableOverlayTarget key={o.id} item={o} onSelect={() => onSelectOverlay?.(o.id)} />
        ),
      )}
      {(textOverlays ?? []).map((t) => (
        <DraggableTextOverlay key={t.id} item={t} stageRef={stageRef} invisibleContent />
      ))}
    </div>
  );
}

// SwatchGrid / ImageUpload / FontSelect / Card / Field are imported from
// `@/components/builder`.

function StubbyDesigner() {
  const [d, setD] = useState<StubbyDesign>(DEFAULT_STUBBY_DESIGN);

  // Consume a pending admin "Open in builder" request (written by the admin panel).
  useEffect(() => {
    const req = consumeBuilderLoadRequest("stubby");
    if (!req) return;
    if (req.design && typeof req.design === "object") {
      setD({ ...DEFAULT_STUBBY_DESIGN, ...(req.design as Partial<StubbyDesign>) });
      toast.success("Design selections loaded from submission.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);
  const set = <K extends keyof StubbyDesign>(k: K, v: StubbyDesign[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const [frontLogo, setFrontLogo] = useState<string | null>(null);
  const [rearLogo, setRearLogo] = useState<string | null>(null);
  const [heroImg, setHeroImg] = useState<string | null>(null);
  const [tileLogo, setTileLogo] = useState<string | null>(null);
  const [layer1, setLayer1] = useState<string | null>(null);
  const [layer2, setLayer2] = useState<string | null>(null);
  const [layer3, setLayer3] = useState<string | null>(null);

  useEffect(() => {
    setD((p) => ({
      ...p,
      hasFrontLogo: !!frontLogo,
      hasRearLogo: !!rearLogo,
      hasHeroImage: !!heroImg,
      hasTileLogo: !!tileLogo,
      hasLayer1: !!layer1,
      hasLayer2: !!layer2,
      hasLayer3: !!layer3,
    }));
  }, [frontLogo, rearLogo, heroImg, tileLogo, layer1, layer2, layer3]);

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const GEN_BUDGET = 15;
  const [genCount, setGenCount] = useState(0);
  const lockRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<
    { id: string; thumb: string; full: string; design?: StubbyDesign }[]
  >([]);

  const livePrompt = useMemo(() => buildStubbyPrompt(d), [d]);

  // ---------- Overlay state ----------
  // Three flat panels in the 2552x1295 viewBox — actual centres measured
  // from the SVG path bboxes: LEFT (front) ≈ 0.156, MIDDLE (seam) ≈ 0.499,
  // RIGHT (rear) ≈ 0.844. Vertical centre of the panel body ≈ 0.523.
  const LEFT_X = 0.156;
  const RIGHT_X = 0.844;
  const CY = 0.523;
  const [frontLogoOv, setFrontLogoOv] = useState<OverlayState>({ x: LEFT_X, y: CY, w: 0.18 });
  const [rearLogoOv, setRearLogoOv] = useState<OverlayState>({ x: RIGHT_X, y: CY, w: 0.18 });
  const [heroOv, setHeroOv] = useState<OverlayState>({ x: LEFT_X, y: CY, w: 0.3 });
  const [tileOv, setTileOv] = useState<OverlayState>({ x: LEFT_X, y: CY, w: 0.12 });
  // Layered mode: three independent placements. Defaults spread big → small
  // over the LEFT (front) view; freely moveable.
  const [layer1Ov, setLayer1Ov] = useState<OverlayState>({ x: LEFT_X, y: CY, w: 0.34 });
  const [layer2Ov, setLayer2Ov] = useState<OverlayState>({ x: LEFT_X, y: CY, w: 0.24 });
  const [layer3Ov, setLayer3Ov] = useState<OverlayState>({ x: LEFT_X, y: CY, w: 0.16 });
  const [activeLayer, setActiveLayer] = useState<1 | 2 | 3>(3);
  const [textOv, setTextOv] = useState<OverlayState>({ x: LEFT_X, y: CY, w: 0.28 });

  const hasOverlayText = !!(d.overlayLine1.trim() || d.overlayLine2.trim());

  const stageOverlays = useMemo<OverlayItem[]>(() => {
    const list: OverlayItem[] = [];
    if (d.designMode === "logo-front-back") {
      if (frontLogo)
        list.push({
          id: "frontLogo",
          label: "Front logo",
          url: frontLogo,
          state: frontLogoOv,
          onChange: setFrontLogoOv,
        });
      if (rearLogo)
        list.push({
          id: "rearLogo",
          label: "Rear logo",
          url: rearLogo,
          state: rearLogoOv,
          onChange: setRearLogoOv,
        });
    } else if (d.designMode === "all-over-image" && heroImg) {
      list.push({
        id: "hero",
        label: "Hero image",
        url: heroImg,
        state: heroOv,
        onChange: setHeroOv,
      });
    } else if (d.designMode === "all-over-tiled" && tileLogo) {
      list.push({
        id: "tile",
        label: "Tile logo",
        url: tileLogo,
        state: tileOv,
        onChange: setTileOv,
      });
    } else if (d.designMode === "all-over-layered") {
      // Paint order: layer1 (bottom) → layer2 → layer3 (top), all under the
      // holder outline paths.
      if (layer1)
        list.push({
          id: "layer1",
          label: "Layer 1",
          url: layer1,
          state: layer1Ov,
          onChange: setLayer1Ov,
        });
      if (layer2)
        list.push({
          id: "layer2",
          label: "Layer 2",
          url: layer2,
          state: layer2Ov,
          onChange: setLayer2Ov,
        });
      if (layer3)
        list.push({
          id: "layer3",
          label: "Layer 3",
          url: layer3,
          state: layer3Ov,
          onChange: setLayer3Ov,
        });
    }
    return list;
  }, [
    d.designMode,
    frontLogo,
    rearLogo,
    heroImg,
    tileLogo,
    layer1,
    layer2,
    layer3,
    frontLogoOv,
    rearLogoOv,
    heroOv,
    tileOv,
    layer1Ov,
    layer2Ov,
    layer3Ov,
  ]);

  const activeOverlayId = d.designMode === "all-over-layered" ? `layer${activeLayer}` : undefined;

  const stageTextOverlays: TextOverlayItem[] = hasOverlayText
    ? [
        {
          id: "overlayText",
          label: "Overlay text",
          props: {
            line1: d.overlayLine1,
            line2: d.overlayLine2,
            font: d.overlayFont,
            flow: "straight",
            colour: d.overlayColour,
            useOutline: d.overlayUseOutline,
            outlineColour: d.overlayOutlineColour,
          },
          state: textOv,
          onChange: setTextOv,
        },
      ]
    : [];

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
      if (d.designMode === "logo-front-back") {
        if (frontLogo)
          refs.push({ label: "FRONT LOGO — apply centred on the FRONT view only", url: frontLogo });
        if (rearLogo)
          refs.push({ label: "REAR LOGO — apply centred on the REAR view only", url: rearLogo });
      } else if (d.designMode === "all-over-image") {
        if (heroImg)
          refs.push({
            label: "HERO ALL-OVER IMAGE — wrap continuously around the entire cylinder",
            url: heroImg,
          });
      } else if (d.designMode === "all-over-tiled") {
        if (tileLogo)
          refs.push({
            label: "TILE LOGO — repeat edge-to-edge across the whole cylinder",
            url: tileLogo,
          });
      } else if (d.designMode === "all-over-layered") {
        if (layer1)
          refs.push({ label: "LAYER 1 (background) — bottom layer of the composite", url: layer1 });
        if (layer2)
          refs.push({ label: "LAYER 2 (mid-ground) — middle layer of the composite", url: layer2 });
        if (layer3)
          refs.push({ label: "LAYER 3 (hero / focal) — top layer of the composite", url: layer3 });
      }

      // Rasterise the recoloured template + composited overlays into a
      // labelled reference image so the model has the exact colour + layout.
      try {
        // Artwork + text are baked INSIDE the template SVG (under the
        // outline paths). svgToPngDataUrl no longer needs an overlay list —
        // the rasterisation matches the on-screen preview exactly.
        const tile = d.designMode === "all-over-tiled";
        const wrap = d.designMode === "all-over-image" || d.designMode === "all-over-layered";
        const PANEL_XS = [0.156, 0.499, 0.844];
        const artworks: PlacedArtwork[] = [];
        const addArt = (a: PlacedArtwork) => {
          artworks.push(a);
          if (wrap && !a.tile) {
            for (const px of PANEL_XS) {
              if (Math.abs(px - a.x) < 0.05) continue;
              artworks.push({ ...a, x: px });
            }
          }
        };
        for (const o of stageOverlays) {
          addArt({
            url: o.url,
            svg: o.svg,
            x: o.state.x,
            y: o.state.y,
            w: effectiveOverlayWidth(o.state),
            rotation: o.state.rotation,
            tile: tile && !!o.url,
          });
        }
        if (hasOverlayText) {
          const textSvg = buildEmbroideryTextSvg({
            line1: d.overlayLine1,
            line2: d.overlayLine2,
            font: d.overlayFont,
            flow: "straight",
            colour: d.overlayColour,
            useOutline: d.overlayUseOutline,
            outlineColour: d.overlayOutlineColour,
          });
          if (textSvg) {
            addArt({
              svg: textSvg,
              x: textOv.x,
              y: textOv.y,
              w: effectiveOverlayWidth(textOv),
              rotation: textOv.rotation,
            });
          }
        }
        const svg = await buildStubbyTemplateSvg(d, artworks);
        const templateDataUrl = await svgToPngDataUrl(svg, 512);
        const anyArt = artworks.length > 0;
        refs.push({
          label:
            "COLOUR-LAYOUT TEMPLATE — a flat schematic of the SAME holder in three views: LEFT = front face, MIDDLE = side/seam view with the vertical joiner tape, RIGHT = rear face, showing body colour and tape/trim colour. Composited artwork or text indicates the EXACT position, size and orientation on the finished holder. Follow it exactly; it is a flat colour guide — render as the photorealistic three-view product shot described in the text prompt, do NOT copy the line-art style, flat fills or outlines." +
            (anyArt
              ? ""
              : " NO ARTWORK OR TEXT — do NOT invent any logo, badge or lettering on the holder; keep the neoprene clean."),
          url: templateDataUrl,
        });
      } catch (err) {
        console.warn("Stubby template rasterisation failed; continuing.", err);
      }

      const doFetch = () =>
        fetch("/api/generate-stubby", {
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
      setHistory((h) =>
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
  const [openStage, setOpenStage] = useState(1);
  const toggleStage = (n: number) => setOpenStage((cur) => (cur === n ? 0 : n));
  const STAGE_LIST = [
    { step: 1, title: "Design" },
    { step: 2, title: "Construction" },
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
        productName={WELCOME_CONTENT["stubby"].productName}
        slides={WELCOME_CONTENT["stubby"].slides}
        onDone={welcome.dismiss}
      />
      <BuilderTabs active="stubby" hasUnsavedWork={history.length > 0} />
      {!welcome.open && welcome.hydrated && (
        <HelpFab onClick={welcome.replay} label="Show intro again" />
      )}
      <BuilderHeader
        title="Stubby Holder Designer"
        subtitle="Stubby holder — full wrap design & construction."
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      />

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-start">
        <section className="order-2 space-y-4 preview-col">
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Colour layout template
              </span>
              <span className="text-[10px] text-muted-foreground">
                LEFT = front · MIDDLE = seam · RIGHT = rear
              </span>
            </div>
            <StubbyStage
              design={d}
              overlays={stageOverlays}
              textOverlays={stageTextOverlays}
              tile={d.designMode === "all-over-tiled"}
              wrap={d.designMode === "all-over-image" || d.designMode === "all-over-layered"}
              activeOverlayId={activeOverlayId}
              onSelectOverlay={(id) => {
                const n = Number(id.replace("layer", ""));
                if (n === 1 || n === 2 || n === 3) setActiveLayer(n as 1 | 2 | 3);
              }}
            />
            {d.designMode === "all-over-layered" && (
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
            alt="Generated stubby holder"
            productLabel="stubby holder"
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
            productType="stubby"
            images={history.map((h) => h.full)}
            settings={history.map((h) =>
              h.design ? ({ design: h.design } as Record<string, unknown>) : null,
            )}
            viewLabel="stubby holder"
          />
        </section>

        <aside className="order-1 space-y-4">
          <StageSection
            step={1}
            title="Design"
            subtitle="Colours, artwork & layout"
            open={openStage === 1}
            onToggle={() => toggleStage(1)}
            onNext={() => goToStage(2)}
            nextLabel="Continue to Construction"
          >
            <Card title="Design">
              <div className="space-y-4">
                <Field label="Base neoprene colour">
                  <SwatchGrid selected={d.baseColour} onPick={(s) => set("baseColour", s)} />
                </Field>
                <Field label="Print style">
                  <Select
                    value={d.designMode}
                    onValueChange={(v) => set("designMode", v as StubbyDesignMode)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(DESIGN_MODE_LABELS) as StubbyDesignMode[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {DESIGN_MODE_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {d.designMode === "logo-front-back" && (
                  <div className="space-y-3">
                    <Field label="Front logo">
                      <LibraryImageUpload
                        builder="stubby"
                        assetType="front_logo"
                        label="Upload front logo"
                        value={frontLogo}
                        onChange={setFrontLogo}
                      />
                    </Field>
                    <Field label="Rear logo">
                      <LibraryImageUpload
                        builder="stubby"
                        assetType="back_patch"
                        label="Upload rear logo"
                        value={rearLogo}
                        onChange={setRearLogo}
                      />
                    </Field>
                  </div>
                )}
                {d.designMode === "all-over-image" && (
                  <Field label="Full wrap image">
                    <LibraryImageUpload
                      builder="stubby"
                      assetType="hero"
                      label="Upload hero image"
                      value={heroImg}
                      onChange={setHeroImg}
                    />
                  </Field>
                )}
                {d.designMode === "all-over-tiled" && (
                  <Field label="Logo to tile">
                    <LibraryImageUpload
                      builder="stubby"
                      assetType="tile"
                      label="Upload tile logo"
                      value={tileLogo}
                      onChange={setTileLogo}
                    />
                  </Field>
                )}
                {d.designMode === "all-over-layered" && (
                  <div className="space-y-3">
                    <Field label="Layer 1 – background">
                      <LibraryImageUpload
                        builder="stubby"
                        assetType="layer"
                        label="Upload background"
                        value={layer1}
                        onChange={setLayer1}
                      />
                    </Field>
                    <Field label="Layer 2 – mid-ground">
                      <LibraryImageUpload
                        builder="stubby"
                        assetType="layer"
                        label="Upload mid-ground graphic"
                        value={layer2}
                        onChange={setLayer2}
                      />
                    </Field>
                    <Field label="Layer 3 – hero / focal">
                      <LibraryImageUpload
                        builder="stubby"
                        assetType="layer"
                        label="Upload hero logo"
                        value={layer3}
                        onChange={setLayer3}
                      />
                    </Field>
                  </div>
                )}
                {(d.designMode === "all-over-image" || d.designMode === "all-over-layered") && (
                  <div className="space-y-3 rounded-md border border-border p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Overlay text (optional)
                    </p>
                    <Field label="Line 1">
                      <Input
                        value={d.overlayLine1}
                        onChange={(e) => set("overlayLine1", e.target.value)}
                        placeholder="MAIN TEXT"
                      />
                    </Field>
                    <MoreOptions label="More options">
                      <Field label="Line 2">
                        <Input
                          value={d.overlayLine2}
                          onChange={(e) => set("overlayLine2", e.target.value)}
                          placeholder="SUBTEXT"
                        />
                      </Field>
                      <Field label="Font">
                        <FontSelect value={d.overlayFont} onChange={(v) => set("overlayFont", v)} />
                      </Field>
                      <Field label="Text colour">
                        <SwatchGrid
                          selected={d.overlayColour}
                          onPick={(s) => set("overlayColour", s)}
                        />
                      </Field>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={d.overlayUseOutline}
                          onCheckedChange={(v) => set("overlayUseOutline", !!v)}
                        />
                        Outline
                      </label>
                      {d.overlayUseOutline && (
                        <Field label="Outline colour">
                          <SwatchGrid
                            selected={d.overlayOutlineColour}
                            onPick={(s) => set("overlayOutlineColour", s)}
                          />
                        </Field>
                      )}
                    </MoreOptions>
                  </div>
                )}
              </div>
            </Card>
          </StageSection>

          <StageSection
            step={2}
            title="Construction"
            subtitle="Base, stitching & finish"
            open={openStage === 2}
            onToggle={() => toggleStage(2)}
          >
            <Card title="Construction">
              <div className="space-y-3">
                <Field label="Edge finish">
                  <Select
                    value={d.edgeFinish}
                    onValueChange={(v) => set("edgeFinish", v as EdgeFinish)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(EDGE_FINISH_LABELS) as EdgeFinish[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {EDGE_FINISH_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                {d.edgeFinish !== "glued-base-only" && (
                  <Field label={`Overlock thread colour — ${d.stitchColour.name}`}>
                    <SwatchGrid
                      selected={d.stitchColour}
                      onPick={(s) => set("stitchColour", s)}
                      palette={STITCH_PALETTE_GROUPS}
                    />
                  </Field>
                )}

                <Field label={`Joiner tape colour — ${d.joinerTapeColour.name}`}>
                  <SwatchGrid
                    selected={d.joinerTapeColour}
                    onPick={(s) => set("joinerTapeColour", s)}
                    palette={STITCH_PALETTE_GROUPS}
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
