import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, ImageIcon, Loader2, MoreHorizontal, Plus, Trash2, X } from "lucide-react";
import {
  PALETTE_GROUPS,
  FONT_OPTIONS,
  WORD_COLOURS,
  LEATHER_COMBOS,
  BADGE_SHAPES,
  PROMPT_TEMPLATE,
  buildPrompt,
  MAX_BODY_STRIPES,
  MAX_CUFF_STRIPES,
  STRIPE_PATTERN_PRESETS,
  STRIPE_WIDTH_FRAC,
  pickDefaultStripeColour,
  type Swatch,
  type Stripe,
  type StripeLocation,
  type BeanieDesign,
  type BadgeShape,
  type LeatherCombo,
  type LeatherFinish,
  type DirectEmbroideryMode,
  type PomMode,
  type StripePatternPreset,
} from "@/lib/beanie-config";
import { buildBeanieTemplateSvg } from "@/lib/beanie-template";
import { svgToPngDataUrl } from "@/lib/cap-template";
import type { CapOverlay } from "@/lib/cap-template";
import { BeanieTemplateStage } from "@/components/BeanieTemplateStage";
import { effectiveOverlayWidth, type OverlayState } from "@/components/CapTemplateStage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { BadgeUploader } from "@/components/BadgeUploader";
import { SavedArtworkPicker } from "@/components/builder/SavedArtworkPicker";
import { useAssetLibrary } from "@/hooks/use-asset-library";
import { categoriesForSlot } from "@/lib/asset-categories";
import { BuilderTabs } from "@/components/BuilderTabs";
import { BuilderHeader } from "@/components/BuilderHeader";
import { useColourFollow } from "@/hooks/use-colour-follow";
import { StageSection } from "@/components/builder/StageSection";
import { HelpFab } from "@/components/builder/HelpFab";
import { WelcomeOverlay, useWelcome } from "@/components/WelcomeOverlay";
import { WELCOME_CONTENT } from "@/lib/welcome-content";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { consumeBuilderLoadRequest } from "@/lib/builder-load";
import { SwatchGrid, FontSelect, Card, Field } from "@/components/builder";
import { MoreOptions } from "@/components/builder/MoreOptions";
import { GeneratingSkeleton } from "@/components/builder";
import { useShopifyCustomer } from "@/hooks/use-shopify-customer";

export const Route = createFileRoute("/beanie")({
  head: () => ({
    meta: [
      { title: "Beanie Designer" },
      {
        name: "description",
        content: "Design your custom knitted beanie — main, stripes, words, badge & pom.",
      },
    ],
  }),
  component: BeanieDesigner,
});

// =============================================================================
// Module-scope presentational components
// =============================================================================

function WordColourPicker({ selected, onPick }: { selected: Swatch; onPick: (s: Swatch) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-border p-2">
        <span
          className="h-9 w-9 rounded-md border border-border"
          style={{ backgroundColor: selected.hex }}
        />
        <div className="flex flex-1 flex-col">
          <span className="text-sm font-medium">{selected.name}</span>
          <span className="text-[10px] text-muted-foreground">{selected.hex}</span>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
      <div className="grid grid-cols-6 gap-2">
        {WORD_COLOURS.map((s) => {
          const active = s.hex === selected.hex;
          return (
            <button
              key={s.hex}
              type="button"
              onClick={() => {
                onPick(s);
                setOpen(false);
              }}
              className="flex flex-col items-center gap-1"
            >
              <span
                className={cn(
                  "h-8 w-8 rounded-md border",
                  active
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                    : "border-border",
                )}
                style={{ backgroundColor: s.hex }}
              />
              <span className="text-[9px] leading-tight text-muted-foreground">{s.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModSlot({
  innerRef,
  flicker,
  onTouch,
  children,
}: {
  innerRef: (el: HTMLDivElement | null) => void;
  flicker: boolean;
  onTouch: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={innerRef}
      onPointerDownCapture={onTouch}
      onChangeCapture={onTouch}
      className={cn(flicker && "module-flicker")}
    >
      {children}
    </div>
  );
}

// FontSelect lives in `@/components/builder`.

// =============================================================================
// Constants
// =============================================================================

const GEN_BUDGET = 15;
const VERSIONS_PER_GEN = 1;
const MAX_SELECT = 10;

type ModuleKey = "main" | "stripes" | "words" | "badge" | "pom";
const MODULE_LABELS: Record<ModuleKey, string> = {
  main: "Main colour",
  stripes: "Stripes",
  words: "Knitted words",
  badge: "Front badge",
  pom: "Pom pom",
};
const MODULE_ORDER: ModuleKey[] = ["main", "stripes", "words", "badge", "pom"];

type HistoryItem = {
  id: string;
  thumb: string;
  full: string;
  promptKey: string;
  upscale?: boolean;
  design?: BeanieDesign;
};
type Submission = { id: string; ts: number; items: HistoryItem[]; prompt: string };

const DEFAULT_DESIGN: BeanieDesign = {
  rotation: "45° to the right",
  facing: "front",
  mainTone: "mid",
  mainColour:
    PALETTE_GROUPS[0].swatches.find((s) => s.name === "Charcoal") ?? PALETTE_GROUPS[0].swatches[8],
  cuffColour:
    PALETTE_GROUPS[0].swatches.find((s) => s.name === "Charcoal") ?? PALETTE_GROUPS[0].swatches[8],
  stripes: [
    { width: "mid", colour: PALETTE_GROUPS[5].swatches[18], location: "body" }, // Navy
    { width: "thin", colour: PALETTE_GROUPS[0].swatches[0], location: "cuff" }, // White
  ],
  words: "",
  wordsFont: FONT_OPTIONS[0],
  wordsColour: WORD_COLOURS[0],
  wordsColourMode: "swatch",
  wordsStripeIndex: null,
  wordsLocation: "body",
  badge: "3-colour 3D embroidered",
  badgeShape: "rectangle",
  badgeRounded: true,
  directMode: "keep-as-per-image",
  leatherCombo: LEATHER_COMBOS[0],
  leatherFinish: "new",
  pom: false,
  pomMode: "main",
  hasBadgeImage: false,
};

// =============================================================================
// Main
// =============================================================================
function BeanieDesigner() {
  const [d, setD] = useState<BeanieDesign>(DEFAULT_DESIGN);
  const set = <K extends keyof BeanieDesign>(k: K, v: BeanieDesign[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  // Approved render loaded from an admin submission — used as the base image so
  // every generation recreates that exact design (including at other camera angles).
  const [adminBase, setAdminBase] = useState<string | null>(null);
  useEffect(() => {
    const req = consumeBuilderLoadRequest("beanie");
    if (!req) return;
    if (req.design && typeof req.design === "object") {
      const loaded = req.design as Partial<BeanieDesign>;
      const migratedStripes: Stripe[] = Array.isArray(loaded.stripes)
        ? (loaded.stripes as Stripe[]).map((s) => ({
            ...s,
            // Legacy saves may have no location — default to body.
            location: (s.location as StripeLocation) ?? "body",
          }))
        : DEFAULT_DESIGN.stripes;
      setD({ ...DEFAULT_DESIGN, ...loaded, stripes: migratedStripes });
    }
    if (req.baseImage && req.baseImage.startsWith("data:image/")) setAdminBase(req.baseImage);
    toast.success("Design loaded from submission — generations will recreate this exact design.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const customer = useShopifyCustomer();

  const [badgeImage, setBadgeImage] = useState<string | null>(null);
  const [badgeAnalysis, setBadgeAnalysis] = useState<
    import("@/components/BadgeUploader").BadgeAnalysis | null
  >(null);
  const badgeHasWarnings = !!badgeImage && !!badgeAnalysis && !badgeAnalysis.ok;

  // Overlay placement (single-view — beanie preview shows one template regardless of rotation/facing).
  // Badge default: centre of the main body, above the cuff.
  const [badgeOverlay, setBadgeOverlay] = useState<OverlayState>({ x: 0.5, y: 0.42, w: 0.28 });
  // Beanie knitted text is BAKED INTO the template SVG (see
  // `buildBeanieTemplateSvg`) at a fixed knit row height, centred on the
  // region, and clipped to the beanie silhouette. It is not a DOM overlay
  // and has no size/scale — long words visibly wrap around the sides of
  // the beanie, exactly like real knitted-in lettering. The route just
  // reports whether text is present, for prompt/UI purposes.
  const hasKnittedText = d.words.trim().length > 0;

  // Preset badge artwork (admin-uploaded per-client library).
  const badgeLibrary = useAssetLibrary("beanie", "badge", categoriesForSlot("beanie", "badge"));
  const [presetBadge, setPresetBadge] = useState<string | null>(null);
  const pickPresetBadge = async (url: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      setPresetBadge(dataUrl);
    } catch {
      toast.error("Couldn't load that saved logo — please try again.");
    }
  };

  // Keep hasBadgeImage in the design state in sync with the badgeImage upload.
  // This drives the prompt — when an image is present the badge clause fires.
  useEffect(() => {
    set("hasBadgeImage", !!badgeImage);
  }, [badgeImage]);

  // Theme
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Stripes
  const updateStripe = (i: number, patch: Partial<Stripe>) =>
    setD((p) => ({
      ...p,
      stripes: p.stripes.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }));
  const bodyCount = d.stripes.filter((s) => s.location === "body").length;
  const cuffCount = d.stripes.filter((s) => s.location === "cuff").length;
  const bodyFull = bodyCount >= MAX_BODY_STRIPES;
  const cuffFull = cuffCount >= MAX_CUFF_STRIPES;

  /** Original indices for stripes in a given region, in list order. */
  const regionIndices = (loc: StripeLocation): number[] =>
    d.stripes.reduce<number[]>((acc, s, i) => (s.location === loc ? [...acc, i] : acc), []);

  /** Reorder inside a single region (leaves the other region untouched). */
  const reorderInRegion = (loc: StripeLocation, from: number, to: number) => {
    if (from === to) return;
    setD((p) => {
      const idxs = p.stripes.reduce<number[]>(
        (acc, s, i) => (s.location === loc ? [...acc, i] : acc),
        [],
      );
      if (from < 0 || from >= idxs.length || to < 0 || to >= idxs.length) return p;
      const items = idxs.map((i) => p.stripes[i]);
      const [m] = items.splice(from, 1);
      items.splice(to, 0, m);
      const arr = [...p.stripes];
      idxs.forEach((origI, k) => {
        arr[origI] = items[k];
      });
      return { ...p, stripes: arr };
    });
  };

  const removeStripe = (i: number) =>
    setD((p) => ({ ...p, stripes: p.stripes.filter((_, idx) => idx !== i) }));

  const addStripeTo = (loc: StripeLocation) => {
    const targetFull = loc === "cuff" ? cuffFull : bodyFull;
    if (targetFull) return;
    setD((p) => ({
      ...p,
      stripes: [
        ...p.stripes,
        {
          width: "mid",
          location: loc,
          colour: pickDefaultStripeColour(p.mainColour, p.stripes.length),
        },
      ],
    }));
  };

  const switchLocation = (i: number, target: StripeLocation) => {
    const cur = d.stripes[i];
    if (cur.location === target) return;
    const targetCount = target === "cuff" ? cuffCount : bodyCount;
    const targetMax = target === "cuff" ? MAX_CUFF_STRIPES : MAX_BODY_STRIPES;
    if (targetCount >= targetMax) return;
    updateStripe(i, { location: target });
  };

  const applyStripePreset = (p: StripePatternPreset) => {
    setD((prev) => {
      const stripes: Stripe[] = p.stripes.map((sp, i) => ({
        width: sp.width,
        location: sp.location,
        colour: pickDefaultStripeColour(prev.mainColour, i),
      }));
      return { ...prev, stripes };
    });
  };

  const [drag, setDrag] = useState<{ loc: StripeLocation; from: number } | null>(null);

  // Module touch tracking
  const [touched, setTouched] = useState<Record<ModuleKey, boolean>>({
    main: false,
    stripes: false,
    words: false,
    badge: false,
    pom: false,
  });
  const [flickering, setFlickering] = useState<Record<ModuleKey, boolean>>({
    main: false,
    stripes: false,
    words: false,
    badge: false,
    pom: false,
  });
  const refs = useRef<Record<ModuleKey, HTMLDivElement | null>>({
    main: null,
    stripes: null,
    words: null,
    badge: null,
    pom: null,
  });
  const mark = (k: ModuleKey) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));

  // Generation
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [genCount, setGenCount] = useState(0);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [iters, setIters] = useState(0);
  const [loading, setLoading] = useState(false);
  const [upscaling, setUpscaling] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lockRef = useRef(false);

  // Template override persists in localStorage, but is invalidated whenever
  // the shipped PROMPT_TEMPLATE changes — otherwise every template fix in
  // code was silently ignored for anyone with an old cached override.
  const TEMPLATE_KEY = "beanie_template_override_v2";
  const [templateOverride, setTemplateOverride] = useState<string>(() => {
    if (typeof window === "undefined") return PROMPT_TEMPLATE;
    try {
      const stored = JSON.parse(window.localStorage.getItem(TEMPLATE_KEY) || "null") as {
        base?: string;
        value?: string;
      } | null;
      if (stored?.value && stored.base === PROMPT_TEMPLATE) return stored.value;
    } catch {
      /* fall through to default */
    }
    return PROMPT_TEMPLATE;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      TEMPLATE_KEY,
      JSON.stringify({ base: PROMPT_TEMPLATE, value: templateOverride }),
    );
  }, [templateOverride]);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(
        window.localStorage.getItem("beanie_customer_submissions") || "[]",
      ) as Submission[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    let list = submissions;
    for (let i = 0; i < 8; i++) {
      try {
        window.localStorage.setItem("beanie_customer_submissions", JSON.stringify(list));
        return;
      } catch {
        if (list.length <= 1) {
          try {
            window.localStorage.removeItem("beanie_customer_submissions");
          } catch {
            /* ignore */
          }
          return;
        }
        list = list.slice(0, Math.max(1, list.length - Math.ceil(list.length / 2)));
      }
    }
  }, [submissions]);

  const livePrompt = useMemo(() => buildPrompt(d, templateOverride), [d, templateOverride]);

  useEffect(() => {
    if (lastKey != null && lastKey !== livePrompt) setIters(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePrompt]);

  const makeThumb = (dataUrl: string, max = 256): Promise<string> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(c.toDataURL("image/webp", 0.8));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });

  const callGenerate = async (
    prompt: string,
    baseImage?: string,
    baseMode?: "recreate" | "reangle",
  ): Promise<string> => {
    const referenceImages = refImages.filter(Boolean).slice(0, 4) as string[];
    const labeledReferences: { label: string; url: string }[] = [];
    try {
      const svg = await buildBeanieTemplateSvg(d);
      const overlays: CapOverlay[] = [];
      if (badgeImage)
        overlays.push({
          url: badgeImage,
          ...badgeOverlay,
          w: effectiveOverlayWidth(badgeOverlay),
        });
      // Knitted text is baked into the template SVG itself — no overlay pass.
      const templateDataUrl = await svgToPngDataUrl(svg, 1024, overlays);
      const noArt = !badgeImage && !d.words.trim();
      labeledReferences.push({
        label:
          "COLOUR-LAYOUT TEMPLATE — a flat schematic of the beanie showing which colour goes on which part (main body colour, folded cuff colour, pom pom colour layers, and ONLY the stripe bands that are visible — render exactly that number of stripes in that exact bottom-to-top order, on the body vs cuff as shown, no extras). Follow the attached COLOUR-LAYOUT TEMPLATE exactly for body colour, cuff colour, pom pom colours, stripe count/order/colours, and text/artwork placement — it is a flat colour guide, render it as a photorealistic knitted beanie. Do NOT copy the line-art style, flat vector fills, hand-drawn outlines, or 2D flat look — the final render must remain realistic 3D product photography as described in the text prompt." +
          (noArt
            ? " NO ARTWORK OR TEXT — do NOT invent any badge, patch, embroidered logo, knitted text or emblem on the beanie; keep the knit fabric clean."
            : ""),
        url: templateDataUrl,
      });
    } catch (err) {
      console.warn("Beanie template rasterisation failed; continuing without it.", err);
    }
    const doFetch = () =>
      fetch("/api/generate-beanie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          referenceImages,
          badgeImage,
          labeledReferences,
          baseImage: baseImage?.startsWith("data:image/") ? baseImage : undefined,
          baseMode: baseImage?.startsWith("data:image/") ? (baseMode ?? "recreate") : undefined,
        }),
      });
    let res = await doFetch();
    if ((res.status === 429 || res.status === 502) && !res.ok) {
      await new Promise((r) => setTimeout(r, 2000));
      res = await doFetch();
    }
    const data = (await res.json()) as { imageUrl?: string; error?: string };
    if (!res.ok || !data.imageUrl) throw new Error(data.error ?? "Generation failed");
    return data.imageUrl;
  };

  const generate = async () => {
    if (lockRef.current || loading) return;
    if (genCount >= GEN_BUDGET) {
      setError("Generation limit reached.");
      return;
    }
    if (lastKey === livePrompt && iters >= 2) {
      setError("You've generated this design twice — adjust something and try again.");
      return;
    }
    lockRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const designSnap = d;
      const genResults = await Promise.allSettled(
        Array.from({ length: VERSIONS_PER_GEN }).map(() =>
          callGenerate(livePrompt, adminBase ?? undefined, adminBase ? "reangle" : undefined),
        ),
      );
      const urls = genResults.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (urls.length === 0) throw new Error("All generation attempts failed — please try again.");
      const items: HistoryItem[] = await Promise.all(
        urls.map(async (u) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          thumb: await makeThumb(u),
          full: u,
          promptKey: livePrompt,
          design: designSnap,
        })),
      );
      setHistory((h) => [...items, ...h]);
      setImageUrl(items[0].full);
      setGenCount((c) => c + 1);
      if (lastKey === livePrompt) setIters((i) => i + 1);
      else {
        setLastKey(livePrompt);
        setIters(1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
      setTimeout(() => {
        lockRef.current = false;
      }, 1200);
    }
  };

  const sameDesign = lastKey === livePrompt;
  const budgetReached = genCount >= GEN_BUDGET;
  const locked = budgetReached || (sameDesign && iters >= 2);
  const buttonColour = locked
    ? "bg-red-600 hover:bg-red-700"
    : sameDesign && iters === 1
      ? "bg-orange-500 hover:bg-orange-600"
      : "bg-emerald-600 hover:bg-emerald-700";
  const buttonLabel = budgetReached
    ? "Limit reached"
    : locked
      ? "Vary your design to continue"
      : sameDesign
        ? `Generate again (${iters}/2)`
        : `Generate (${genCount}/${GEN_BUDGET})`;

  // Generate one render per key camera angle, all anchored to the approved base image.
  const ALL_BEANIE_ANGLES: { rotation: BeanieDesign["rotation"]; facing: "front" | "back" }[] = [
    { rotation: "45° to the right", facing: "front" },
    { rotation: "straight front (no rotation)", facing: "front" },
    { rotation: "45° to the right", facing: "back" },
  ];
  const generateAllAngles = async () => {
    if (lockRef.current || loading || !adminBase) return;
    if (genCount + ALL_BEANIE_ANGLES.length > GEN_BUDGET) {
      setError("Not enough generation budget left for all 3 angles.");
      return;
    }
    lockRef.current = true;
    setLoading(true);
    setError(null);
    try {
      for (const a of ALL_BEANIE_ANGLES) {
        const design: BeanieDesign = { ...d, rotation: a.rotation, facing: a.facing };
        const prompt = buildPrompt(design, templateOverride);
        const u = await callGenerate(prompt, adminBase, "reangle");
        const item: HistoryItem = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          thumb: await makeThumb(u),
          full: u,
          promptKey: prompt,
          design,
        };
        setHistory((h) => [item, ...h]);
        setImageUrl(u);
        setGenCount((c) => c + 1);
      }
      toast.success("All 3 angles generated from the approved design.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
      setTimeout(() => {
        lockRef.current = false;
      }, 1200);
    }
  };

  const toggleSelect = (id: string) =>
    setSelectedIds((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_SELECT ? s : [...s, id],
    );

  const [submitting, setSubmitting] = useState(false);
  const [submitNotes, setSubmitNotes] = useState("");
  const submitSelection = async () => {
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    const items = history.filter((h) => selectedIds.includes(h.id));
    const sub: Submission = { id: `${Date.now()}`, ts: Date.now(), items, prompt: livePrompt };
    setSubmissions((s) => [sub, ...s]);
    const snapshot = await Promise.all(
      items.map(async (it) => ({
        image_url: await makeThumb(it.full, 512).catch(() => it.full),
        view: "beanie",
        settings: it.design ? ({ design: it.design } as Record<string, unknown>) : null,
      })),
    );
    const { error } = await supabase.from("admin_submissions").insert({
      user_id: null,
      product_type: "beanie",
      designs_snapshot: snapshot as unknown as never,
      notes:
        [
          submitNotes.trim(),
          badgeHasWarnings
            ? `[Auto] Badge artwork warnings: ${badgeAnalysis!.warnings.join(" | ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n") || null,
      status: "pending",
      client_name: customer.name,
      user_email: customer.email,
    });
    setSubmitting(false);
    if (error) {
      toast.error("Failed to send — please try again.");
      return;
    }
    toast.success("Sent. We'll be in touch.");
    setSelectedIds([]);
    setSubmitNotes("");
  };

  const upscaleTop = async () => {
    if (selectedIds.length === 0 || upscaling) return;
    setUpscaling(true);
    try {
      const picks = history.filter((h) => selectedIds.includes(h.id)).slice(0, 3);
      for (const pick of picks) {
        // Pass the picked image as the base so the model re-renders THIS
        // design at higher fidelity — previously this regenerated from the
        // text prompt alone, returning a different design than the one the
        // customer picked.
        const regenResults = await Promise.allSettled(
          [0, 1].map(() =>
            callGenerate(
              pick.promptKey + " Ultra high resolution 4K render, maximum detail.",
              pick.full,
            ),
          ),
        );
        const urls = regenResults.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
        if (urls.length === 0) throw new Error("Regeneration failed — please try again.");
        const items: HistoryItem[] = await Promise.all(
          urls.map(async (u) => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            thumb: await makeThumb(u),
            full: u,
            promptKey: pick.promptKey,
            upscale: true,
          })),
        );
        setHistory((h) => [...items, ...h]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upscale failed");
    } finally {
      setUpscaling(false);
    }
  };

  // ---- Stripe SVG preview (split by location) ----

  // ---- Submissions grouped by day (10 days) ----
  const startOfDay = (ts: number) => {
    const x = new Date(ts);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const dayLabel = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  const days = useMemo(() => {
    const today = startOfDay(Date.now());
    return Array.from({ length: 10 }).map((_, i) => {
      const day = today - i * 86400000;
      return {
        day,
        label: i === 0 ? "Today" : i === 1 ? "Yesterday" : dayLabel(day),
        subs: submissions.filter((s) => startOfDay(s.ts) === day),
      };
    });
  }, [submissions]);

  const renderMod = (key: ModuleKey, node: React.ReactNode) => (
    <ModSlot
      innerRef={(el) => {
        refs.current[key] = el;
      }}
      flicker={flickering[key]}
      onTouch={() => mark(key)}
    >
      {node}
    </ModSlot>
  );

  const renderStripeRow = (
    loc: StripeLocation,
    origI: number,
    posInRegion: number,
    regionFracTotal: number,
    regionFull: boolean,
  ) => {
    const s = d.stripes[origI];
    const isDragging = drag && drag.loc === loc && drag.from === posInRegion;
    const otherLoc: StripeLocation = loc === "cuff" ? "body" : "cuff";
    const otherFullForMove = otherLoc === "cuff" ? cuffFull : bodyFull;
    return (
      <div
        draggable
        onDragStart={() => setDrag({ loc, from: posInRegion })}
        onDragOver={(e) => {
          if (!drag) return;
          // Same region → reorder; cross-region → move to this region (subject to caps).
          if (drag.loc === loc) e.preventDefault();
          else if (!regionFull) e.preventDefault();
        }}
        onDrop={(e) => {
          e.stopPropagation();
          if (drag && drag.loc === loc) {
            reorderInRegion(loc, drag.from, posInRegion);
          } else if (drag && !regionFull) {
            const sourceIdxs = regionIndices(drag.loc);
            const src = sourceIdxs[drag.from];
            if (src !== undefined) switchLocation(src, loc);
          }
          setDrag(null);
        }}
        onDragEnd={() => setDrag(null)}
        className={cn(
          "flex items-center gap-2 rounded-md border border-l-4 border-border bg-background/50 px-2 py-1.5 min-h-[44px]",
          isDragging && "opacity-50",
        )}
        style={{ borderLeftColor: s.colour.hex }}
      >
        <GripVertical
          className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground"
          aria-label="Drag to reorder"
        />
        {/* Colour swatch dot — click opens picker */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Change colour (currently ${s.colour.name})`}
              title={`${s.colour.name} · ${s.colour.hex}`}
              className="h-7 w-7 shrink-0 rounded-full border border-border shadow-sm transition-transform hover:scale-105"
              style={{ backgroundColor: s.colour.hex }}
            />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-3">
            <SwatchGrid selected={s.colour} onPick={(c) => updateStripe(origI, { colour: c })} />
          </PopoverContent>
        </Popover>
        {/* Width — segmented control */}
        <div className="ml-1 inline-flex overflow-hidden rounded-md border border-border">
          {(["thin", "mid", "thick", "fat"] as Stripe["width"][]).map((w) => {
            const active = s.width === w;
            const projected = regionFracTotal - STRIPE_WIDTH_FRAC[s.width] + STRIPE_WIDTH_FRAC[w];
            const overflow = projected > 1;
            const disabled = !active && overflow;
            return (
              <button
                key={w}
                type="button"
                disabled={disabled}
                onClick={() => updateStripe(origI, { width: w })}
                title={disabled ? "Not enough space in this region" : undefined}
                className={cn(
                  "px-2 py-1 text-[10px] font-medium capitalize transition-colors border-r border-border last:border-r-0",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                  disabled && "cursor-not-allowed opacity-40",
                )}
              >
                {w}
              </button>
            );
          })}
        </div>
        {/* Overflow menu — cross-region move fallback */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="ml-auto h-7 w-7"
              aria-label="More stripe actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={otherFullForMove}
              onClick={() => switchLocation(origI, otherLoc)}
            >
              Move to {otherLoc === "cuff" ? "cuff" : "body"}
              {otherFullForMove ? " (full)" : ""}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => removeStripe(origI)}
          aria-label="Remove stripe"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  const welcome = useWelcome();
  // Linked defaults: cuff follows main body until the user diverges it.
  useColourFollow(d.mainColour, d.cuffColour, (s) => set("cuffColour", s as typeof d.cuffColour));

  const [openStage, setOpenStage] = useState(1);
  // Opening a stage counts as reviewing every section inside it.
  const STAGE_MODULES: Record<number, ModuleKey[]> = {
    1: ["main", "pom", "stripes"],
    2: ["words", "badge"],
  };
  const markStage = (n: number) => (STAGE_MODULES[n] ?? []).forEach((k) => mark(k));
  useEffect(() => {
    if (openStage > 0) markStage(openStage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openStage]);
  const toggleStage = (n: number) => setOpenStage((cur) => (cur === n ? 0 : n));
  const STAGE_LIST = [
    { step: 1, title: "Base design" },
    { step: 2, title: "Text & badge" },
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
        productName={WELCOME_CONTENT["beanie"].productName}
        slides={WELCOME_CONTENT["beanie"].slides}
        onDone={welcome.dismiss}
      />
      <BuilderTabs active="beanie" hasUnsavedWork={history.length > 0} />
      {!welcome.open && welcome.hydrated && (
        <HelpFab onClick={welcome.replay} label="Show intro again" />
      )}
      <BuilderHeader
        title="Beanie Designer"
        subtitle="Knitted beanie — colours, stripes, knitted words & badge."
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      />

      <div className="mx-auto max-w-7xl px-4 pt-4">
        <main className="grid gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-start">
          <section className="space-y-3">
            <StageSection
              step={1}
              title="Base design"
              subtitle="Colours, pom pom & stripes"
              open={openStage === 1}
              onToggle={() => toggleStage(1)}
              onNext={() => goToStage(2)}
              nextLabel="Continue to Text & badge"
            >
              {/* Colours */}
              <Card title="Colours">
                <div className="grid grid-cols-1 gap-4">
                  <ModSlot
                    innerRef={(el) => {
                      refs.current.main = el;
                    }}
                    flicker={flickering.main}
                    onTouch={() => mark("main")}
                  >
                    <div className="space-y-4">
                      <Field label="Main body">
                        <SwatchGrid selected={d.mainColour} onPick={(s) => set("mainColour", s)} />
                      </Field>
                      <Field label="Cuff">
                        <SwatchGrid selected={d.cuffColour} onPick={(s) => set("cuffColour", s)} />
                      </Field>
                    </div>
                  </ModSlot>

                  <ModSlot
                    innerRef={(el) => {
                      refs.current.pom = el;
                    }}
                    flicker={flickering.pom}
                    onTouch={() => mark("pom")}
                  >
                    <div className="space-y-3">
                      <label className="flex items-center gap-2 rounded-md border border-dashed border-border p-2 text-sm">
                        <Checkbox checked={d.pom} onCheckedChange={(v) => set("pom", !!v)} />
                        Include pom pom
                      </label>
                      {d.pom && (
                        <Field label="Pom mode">
                          <div className="flex flex-wrap gap-3">
                            {(["main", "main-first-stripe", "three-colours"] as PomMode[]).map(
                              (m) => (
                                <label key={m} className="flex items-center gap-1 text-xs">
                                  <Checkbox
                                    checked={d.pomMode === m}
                                    onCheckedChange={() => set("pomMode", m)}
                                  />
                                  {m === "main"
                                    ? "Main colour"
                                    : m === "main-first-stripe"
                                      ? "Main + first stripe"
                                      : "3 colours"}
                                </label>
                              ),
                            )}
                          </div>
                        </Field>
                      )}
                    </div>
                  </ModSlot>
                </div>
              </Card>

              {/* Stripes */}
              {renderMod(
                "stripes",
                <Card title="Stripes">
                  <div className="space-y-4">
                    {/* Pattern presets */}
                    <div className="flex flex-wrap gap-2">
                      {STRIPE_PATTERN_PRESETS.map((p) => (
                        <Button
                          key={p.id}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => applyStripePreset(p)}
                        >
                          {p.label}
                        </Button>
                      ))}
                    </div>

                    {/* Body / Cuff columns */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {(["body", "cuff"] as StripeLocation[]).map((loc) => {
                        const idxs = regionIndices(loc);
                        const max = loc === "cuff" ? MAX_CUFF_STRIPES : MAX_BODY_STRIPES;
                        const regionFull = loc === "cuff" ? cuffFull : bodyFull;
                        const regionFracTotal = idxs.reduce(
                          (sum, i) => sum + STRIPE_WIDTH_FRAC[d.stripes[i].width],
                          0,
                        );
                        return (
                          <div
                            key={loc}
                            className="space-y-1.5"
                            onDragOver={(e) => {
                              if (drag && drag.loc !== loc && !regionFull) e.preventDefault();
                            }}
                            onDrop={() => {
                              if (drag && drag.loc !== loc && !regionFull) {
                                const sourceIdxs = regionIndices(drag.loc);
                                const origI = sourceIdxs[drag.from];
                                if (origI !== undefined) switchLocation(origI, loc);
                              }
                              setDrag(null);
                            }}
                          >
                            <div className="flex items-baseline justify-between">
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {loc === "body" ? "Body" : "Cuff"}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {idxs.length}/{max}
                              </span>
                            </div>
                            {idxs.length === 0 ? (
                              <p className="text-[10px] italic text-muted-foreground">
                                No stripes.
                              </p>
                            ) : (
                              <div className="space-y-1.5">
                                {idxs.map((origI, posInRegion) => (
                                  <div key={origI}>
                                    {renderStripeRow(
                                      loc,
                                      origI,
                                      posInRegion,
                                      regionFracTotal,
                                      regionFull,
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-3">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={regionFull}
                                onClick={() => addStripeTo(loc)}
                              >
                                <Plus className="mr-1 h-3.5 w-3.5" /> Add stripe
                              </Button>
                              {regionFull ? (
                                <span className="text-[10px] text-muted-foreground">
                                  {loc === "body" ? "Body full" : "Cuff full"} — max {max} stripes.
                                </span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </Card>,
              )}
            </StageSection>

            <StageSection
              step={2}
              title="Text & badge"
              subtitle="Knitted words & front badge"
              open={openStage === 2}
              onToggle={() => toggleStage(2)}
            >
              {/* Knitted words */}
              {renderMod(
                "words",
                <Card title="Knitted words">
                  <div className="space-y-3">
                    <Field label="Text">
                      <Input
                        value={d.words}
                        maxLength={25}
                        placeholder="e.g. YOUR TEXT"
                        onChange={(e) => set("words", e.target.value)}
                      />
                      <p className="text-[10px] text-muted-foreground">{d.words.length}/25</p>
                    </Field>

                    <MoreOptions label="More options">
                      <Field label="Font">
                        <FontSelect value={d.wordsFont} onChange={(v) => set("wordsFont", v)} />
                      </Field>
                      <Field label="Location">
                        <div className="flex gap-3 pt-1">
                          {(["cuff", "body"] as StripeLocation[]).map((loc) => (
                            <label key={loc} className="flex items-center gap-1 text-xs">
                              <Checkbox
                                checked={d.wordsLocation === loc}
                                onCheckedChange={() => set("wordsLocation", loc)}
                              />
                              {loc === "cuff" ? "Cuff" : "Main body"}
                            </label>
                          ))}
                        </div>
                      </Field>

                      <Field label="Yarn colour">
                        <div className="mb-2 flex items-center gap-3">
                          <label className="flex items-center gap-1 text-xs">
                            <Checkbox
                              checked={d.wordsColourMode === "swatch"}
                              onCheckedChange={() => set("wordsColourMode", "swatch")}
                            />
                            Use colour picker
                          </label>
                          {d.hasBadgeImage && (
                            <label className="flex items-center gap-1 text-xs">
                              <Checkbox
                                checked={d.wordsColourMode === "image"}
                                onCheckedChange={() => set("wordsColourMode", "image")}
                              />
                              Match badge colours
                            </label>
                          )}
                        </div>
                        {d.wordsColourMode === "swatch" && (
                          <WordColourPicker
                            selected={d.wordsColour}
                            onPick={(s) => set("wordsColour", s)}
                          />
                        )}
                      </Field>
                    </MoreOptions>

                    {(() => {
                      const stripeBg =
                        d.wordsStripeIndex != null && d.stripes[d.wordsStripeIndex]
                          ? d.stripes[d.wordsStripeIndex].colour.hex
                          : d.mainColour.hex;
                      return (
                        <div
                          className="rounded-md border border-border p-3 text-center"
                          style={{ backgroundColor: stripeBg }}
                        >
                          <span
                            style={{
                              fontFamily: `'${d.wordsFont}', monospace`,
                              color: d.wordsColour.hex,
                              fontSize: "24px",
                            }}
                          >
                            {d.words || "PREVIEW"}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </Card>,
              )}

              {/* Front badge */}
              {renderMod(
                "badge",
                <Card title="Front badge">
                  <div className="space-y-3">
                    <Field label="Badge artwork">
                      <SavedArtworkPicker
                        assets={badgeLibrary.assets}
                        loading={badgeLibrary.loading}
                        isLoggedIn={badgeLibrary.isLoggedIn}
                        onSelect={(url) => void pickPresetBadge(url)}
                        onDelete={(a) => void badgeLibrary.deleteAsset(a)}
                      />
                      <BadgeUploader
                        onChange={setBadgeImage}
                        badgeType={d.badge}
                        onAnalysis={setBadgeAnalysis}
                        externalDataUrl={presetBadge}
                        builder="beanie"
                        assetType="badge"
                      />
                    </Field>

                    <MoreOptions label="More options">
                      <Field label="Badge type">
                        <Select
                          value={d.badge}
                          onValueChange={(v) => set("badge", v as BeanieDesign["badge"])}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="3-colour 3D embroidered">
                              3-colour 3D embroidered
                            </SelectItem>
                            <SelectItem value="leather debossed">Leather debossed</SelectItem>
                            <SelectItem value="direct embroidered">Direct embroidered</SelectItem>
                            <SelectItem value="PVC badge">PVC badge</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>

                      <Field label="Shape">
                        <div className="flex flex-wrap gap-3">
                          {BADGE_SHAPES.map((sh) => (
                            <label key={sh} className="flex items-center gap-1 text-xs capitalize">
                              <Checkbox
                                checked={d.badgeShape === sh}
                                onCheckedChange={() => set("badgeShape", sh as BadgeShape)}
                              />
                              {sh}
                            </label>
                          ))}
                          {(d.badgeShape === "rectangle" || d.badgeShape === "square") && (
                            <label className="flex items-center gap-1 text-xs">
                              <Checkbox
                                checked={d.badgeRounded}
                                onCheckedChange={(v) => set("badgeRounded", !!v)}
                              />
                              Rounded corners
                            </label>
                          )}
                        </div>
                      </Field>

                      {d.badge === "direct embroidered" && (
                        <Field label="Embroidery colour">
                          <div className="flex gap-3 pt-1">
                            {(["keep-as-per-image", "match-to-beanie"] as DirectEmbroideryMode[]).map(
                              (m) => (
                                <label key={m} className="flex items-center gap-1 text-xs">
                                  <Checkbox
                                    checked={d.directMode === m}
                                    onCheckedChange={() => set("directMode", m)}
                                  />
                                  {m === "keep-as-per-image"
                                    ? "Keep as per image"
                                    : "Match to beanie"}
                                </label>
                              ),
                            )}
                          </div>
                        </Field>
                      )}

                      {d.badge === "leather debossed" && (
                        <>
                          <Field label="Combo">
                            <Select
                              value={d.leatherCombo.label}
                              onValueChange={(v) =>
                                set(
                                  "leatherCombo",
                                  LEATHER_COMBOS.find((c) => c.label === v) as LeatherCombo,
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {LEATHER_COMBOS.map((c) => (
                                  <SelectItem key={c.label} value={c.label}>
                                    {c.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field label="Finish">
                            <div className="flex gap-3 pt-1">
                              {(["new", "distressed"] as LeatherFinish[]).map((f) => (
                                <label key={f} className="flex items-center gap-1 text-xs capitalize">
                                  <Checkbox
                                    checked={d.leatherFinish === f}
                                    onCheckedChange={() => set("leatherFinish", f)}
                                  />
                                  {f}
                                </label>
                              ))}
                            </div>
                          </Field>
                        </>
                      )}
                    </MoreOptions>
                  </div>
                </Card>,
              )}
            </StageSection>
          </section>

          {/* Preview */}
          <aside className="space-y-4 preview-col">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Colour layout template
                </span>
                <span className="text-[10px] text-muted-foreground">Colour preview</span>
              </div>
              <BeanieTemplateStage
                design={d}
                className="mx-auto w-full max-w-[420px] rounded-lg bg-zinc-600"
                overlays={
                  badgeImage
                    ? [
                        {
                          id: "beanieBadge",
                          label: "Badge artwork",
                          url: badgeImage,
                          state: badgeOverlay,
                          onChange: setBadgeOverlay,
                        },
                      ]
                    : []
                }
                // Knitted text is now rendered inside the template SVG
                // itself (fixed knit height, clipped to the beanie silhouette),
                // so the stage does not receive it as a DOM overlay.
                textOverlays={[]}
              />
              {(badgeImage || hasKnittedText) && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {badgeImage
                    ? "Drag the badge to position. Corner handle to resize, top handle to rotate."
                    : "Knitted text is a fixed knit-row height, centred on its region — long words wrap around the beanie and are clipped at the sides, just like real knitted lettering."}
                </p>
              )}
            </div>
            <Card title="Preview">
              <div
                className={
                  loading || imageUrl
                    ? "aspect-square overflow-hidden rounded-lg border border-border bg-muted/30"
                    : "h-28 overflow-hidden rounded-lg border border-dashed border-border bg-muted/20"
                }
              >
                {loading ? (
                  <GeneratingSkeleton />
                ) : imageUrl ? (
                  <img
                    src={imageUrl}
                    alt="Beanie preview"
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                    onDragStart={(e) => e.preventDefault()}
                    className="no-save-img h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <ImageIcon className="mr-2 h-5 w-5" /> No preview yet
                  </div>
                )}
              </div>
              <div className="generate-row">
                <Button
                  type="button"
                  disabled={loading || locked}
                  onClick={generate}
                  className={cn("w-full text-white", buttonColour)}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
                    </>
                  ) : (
                    buttonLabel
                  )}
                </Button>
                {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
              </div>
              {adminBase && (
                <div className="mt-3 rounded-md border border-blue-500/40 bg-blue-500/10 p-3 text-xs">
                  <div className="flex items-start gap-2">
                    <ImageIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                    <div>
                      <p className="font-semibold">Recreating approved design</p>
                      <p className="mt-1 text-muted-foreground">
                        Generations will match this exact design. Use Generate all 3 angles to
                        render the other views, or detach to start fresh.
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={generateAllAngles}
                      disabled={loading || genCount + 3 > GEN_BUDGET}
                    >
                      Generate all 3 angles
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setAdminBase(null)}
                    >
                      Detach
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            {history.length > 0 && (
              <Card title={`History — pick up to ${MAX_SELECT}`}>
                <div className="grid grid-cols-3 gap-2">
                  {history.map((h) => {
                    const idx = selectedIds.indexOf(h.id);
                    return (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => {
                          setImageUrl(h.full);
                          toggleSelect(h.id);
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        className={cn(
                          "relative overflow-hidden rounded border-2 transition-all",
                          idx >= 0 ? "border-primary" : "border-border",
                        )}
                      >
                        <img
                          src={h.thumb}
                          draggable={false}
                          onDragStart={(e) => e.preventDefault()}
                          className="no-save-img aspect-square w-full object-cover"
                          alt=""
                        />
                        {idx >= 0 && (
                          <span className="absolute right-1 top-1 grid h-5 w-5 place-content-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                            {idx + 1}
                          </span>
                        )}
                        {h.upscale && (
                          <span className="absolute left-1 top-1 rounded bg-emerald-600 px-1 text-[9px] font-bold text-white">
                            4K
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 space-y-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
                    <Textarea
                      rows={3}
                      value={submitNotes}
                      onChange={(e) => setSubmitNotes(e.target.value)}
                      placeholder="Sizing, deadlines, anything specific about these designs."
                    />
                  </div>
                  {badgeHasWarnings && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-500">
                      Your badge artwork still has embroidery warnings — designs may come back
                      needing revision. Use "Simplify for embroidery" in the badge section, or send
                      anyway and we'll flag it in your notes.
                    </div>
                  )}
                  <Button
                    type="button"
                    disabled={selectedIds.length === 0 || submitting}
                    onClick={submitSelection}
                    className="w-full"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…
                      </>
                    ) : (
                      `Send ${selectedIds.length} designs`
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={selectedIds.length === 0 || upscaling}
                    onClick={upscaleTop}
                    className="w-full"
                  >
                    {upscaling ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rendering 4K…
                      </>
                    ) : (
                      `Render 4K (2 per pick, top 3)`
                    )}
                  </Button>
                </div>
              </Card>
            )}
          </aside>
        </main>
      </div>
    </div>
  );
}
