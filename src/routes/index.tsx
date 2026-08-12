import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/integrations/supabase/types";
import { Download, ImageIcon, Loader2, Lock, RefreshCw, Trash2 } from "lucide-react";
import {
  PALETTE_GROUPS,
  FONT_OPTIONS,
  BACK_PATCH_FONT_OPTIONS,
  BACK_PATCH_FLOW_LABELS,
  buildCapPrompt,
  DEFAULT_CAP_DESIGN,
  CAP_VIEW_LABELS,
  CROWN_STYLE_LABELS,
  SEWN_PATTERN_OPTIONS,
  type CapDesign,
  type CapView,
  type CrownStyle,
  type SewnPattern,
  type StripeBand,
  type StripeWidth,
  type BadgeType,
  type BadgeShape,
  type SnapbackStrap,
  type BackPatchFlow,
  type Swatch,
  LEATHER_DUO_OPTIONS,
} from "@/lib/cap-config";

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
import { cn } from "@/lib/utils";
import { BuilderTabs } from "@/components/BuilderTabs";
import { BuilderHeader } from "@/components/BuilderHeader";
import { useColourFollow } from "@/hooks/use-colour-follow";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { UnderBrimCropDialog } from "@/components/UnderBrimCropDialog";
import { TourOverlay } from "@/components/TourOverlay";
import { WelcomeOverlay, useWelcome } from "@/components/WelcomeOverlay";
import { WELCOME_CONTENT } from "@/lib/welcome-content";
import { StageSection } from "@/components/builder/StageSection";
import { StripeListEditor } from "@/components/builder/StripeListEditor";
import { MoreOptions } from "@/components/builder/MoreOptions";
import { HelpFab } from "@/components/builder/HelpFab";
import { useIsMobile } from "@/hooks/use-mobile";
import { useGuide, type GuideAction } from "@/hooks/use-guide";
import { useShopifyCustomer } from "@/hooks/use-shopify-customer";
import { useAuth } from "@/hooks/use-auth";
import { GeneratingSkeleton } from "@/components/builder";
import { HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { consumeBuilderLoadRequest } from "@/lib/builder-load";
import { SpecSheetEditor } from "@/components/admin/SpecSheetEditor";
import { Badge } from "@/components/ui/badge";
import { defaultSpecSheet, type ProductKind, type SpecSheet } from "@/lib/spec-sheet";
import {
  recolorCapSvg,
  svgToPngDataUrl,
  buildTemplateSvg,
  type CapTemplateColors,
  type CapTemplateOptions,
  type CapOverlay,
} from "@/lib/cap-template";
import {
  CapTemplateStage,
  effectiveOverlayWidth,
  type OverlayState,
} from "@/components/CapTemplateStage";
import {
  buildEmbroideryTextSvg,
  type EmbroideryTextProps,
} from "@/components/EmbroideryTextOverlay";
import { makeThumb } from "@/lib/image-utils";
import {
  SwatchGrid,
  ImageUpload,
  FontSelect,
  Card,
  Field,
  TextSizeSlider,
} from "@/components/builder";
import { EmbroideryImageUpload } from "@/components/EmbroideryImageUpload";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cap Designer" },
      {
        name: "description",
        content: "Design your custom 5-panel trucker cap — front, back & underside views.",
      },
    ],
  }),
  component: CapDesigner,
});

// =============================================================================
// Module-scope presentational components.
// IMPORTANT: never define these inside CapDesigner — doing so creates a new
// component type on every render, which unmounts/remounts subtrees on each
// keystroke (focus loss, file inputs cleared, scroll jumping to top).
// =============================================================================

// SwatchGrid / ImageUpload / FontSelect / Card / Field live in
// `@/components/builder`. Cap-specific overlays (ModSlot, view labels) stay
// local because they reference module-tour wiring that's unique to the cap
// builder.

// Module slot — stable component, props carry per-module wiring.
function ModSlot({
  innerRef,
  flicker,
  onTouch,
  isGuideTarget = false,
  guideActive = false,
  children,
}: {
  innerRef: (el: HTMLDivElement | null) => void;
  flicker: boolean;
  onTouch: () => void;
  isGuideTarget?: boolean;
  guideActive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={innerRef}
      onPointerDownCapture={onTouch}
      onChangeCapture={onTouch}
      style={isGuideTarget ? { position: "relative", zIndex: 50 } : undefined}
      className={cn(
        flicker && "module-flicker",
        guideActive && !isGuideTarget && "opacity-20 transition-opacity pointer-events-none",
      )}
    >
      {children}
    </div>
  );
}

// =============================================================================
// View → which modules are relevant
// =============================================================================
type ModuleKey =
  | "view"
  | "crown"
  | "mesh"
  | "brim"
  | "stripes"
  | "frontLogo"
  | "sideLogo"
  | "backPatch"
  | "snapback"
  | "underbrim";

const VIEW_MODULES: Record<CapView, Record<ModuleKey, boolean>> = {
  "front-3q": {
    view: true,
    crown: true,
    mesh: true,
    brim: true,
    stripes: true,
    frontLogo: true,
    sideLogo: true,
    backPatch: false,
    snapback: false,
    underbrim: false,
  },
  "back-3q": {
    view: true,
    crown: true,
    mesh: true,
    brim: true,
    stripes: true,
    frontLogo: false,
    sideLogo: true,
    backPatch: true,
    snapback: true,
    underbrim: false,
  },
  underside: {
    view: true,
    crown: false,
    mesh: false,
    brim: true,
    stripes: false,
    frontLogo: false,
    sideLogo: false,
    backPatch: false,
    snapback: false,
    underbrim: true,
  },
};

// =============================================================================
// Main
// =============================================================================
function CapDesigner() {
  const [d, setD] = useState<CapDesign>(DEFAULT_CAP_DESIGN);
  const set = <K extends keyof CapDesign>(k: K, v: CapDesign[K]) => setD((p) => ({ ...p, [k]: v }));
  const customer = useShopifyCustomer();
  void customer;

  // Uploaded images (data URLs)
  const [crownPrint, setCrownPrint] = useState<string | null>(null);
  const [frontLogoImg, setFrontLogoImg] = useState<string | null>(null);
  const [backPatchImg, setBackPatchImg] = useState<string | null>(null);
  const [underBrimImg, setUnderBrimImg] = useState<string | null>(null);
  const [underBrimRaw, setUnderBrimRaw] = useState<string | null>(null);
  type UnderBrimMode = "plain" | "upload" | "logo-pattern";
  const [underBrimMode, setUnderBrimMode] = useState<UnderBrimMode>("plain");
  const [sideLogoImg, setSideLogoImg] = useState<string | null>(null);

  // Positionable overlays placed on top of the colour-layout SVG template
  // (front 3/4 view only). Coordinates are normalised 0..1 inside the SVG box.
  const [frontLogoOverlay, setFrontLogoOverlay] = useState<OverlayState>({
    x: 0.42,
    y: 0.55,
    w: 0.18,
  });
  const [crownPrintOverlay, setCrownPrintOverlay] = useState<OverlayState>({
    x: 0.5,
    y: 0.35,
    w: 0.5,
  });
  const [sideLogoOverlay, setSideLogoOverlay] = useState<OverlayState>({ x: 0.78, y: 0.6, w: 0.1 });
  const [backLogoOverlay, setBackLogoOverlay] = useState<OverlayState>({
    x: 0.5,
    y: 0.45,
    w: 0.22,
  });
  const [underBrimOverlay, setUnderBrimOverlay] = useState<OverlayState>({
    x: 0.5,
    y: 0.55,
    w: 0.6,
  });
  // Embroidered-text overlays (positioned separately from any image overlay)
  const [frontBadgeTextOverlay, setFrontBadgeTextOverlay] = useState<OverlayState>({
    x: 0.42,
    y: 0.66,
    w: 0.38,
  });
  const [sideLogoTextOverlay, setSideLogoTextOverlay] = useState<OverlayState>({
    x: 0.78,
    y: 0.62,
    w: 0.35,
  });
  const [backPatchTextOverlay, setBackPatchTextOverlay] = useState<OverlayState>({
    x: 0.5,
    y: 0.5,
    w: 0.4,
  });
  // "Sublimation pattern from logo" — when set, the model is told to build an
  // all-over repeating sublimation pattern from this single logo artwork.
  const [crownSublimationLogo, setCrownSublimationLogo] = useState<string | null>(null);
  const [underBrimSublimationLogo, setUnderBrimSublimationLogo] = useState<string | null>(null);

  // Text is opt-in: uploaded artwork is treated as artwork-only unless the
  // user explicitly turns lettering on.
  const [frontLogoTextOn, setFrontLogoTextOn] = useState(false);
  const [backPatchTextOff, setBackPatchTextOff] = useState(false);
  const [sideLogoTextOn, setSideLogoTextOn] = useState(false);
  // Front badge is always available; it simply isn't rendered unless there is
  // artwork uploaded or embroidered text turned on.
  const frontLogoEnabled = Boolean(frontLogoImg) || frontLogoTextOn;
  const [sideLogoEnabled, setSideLogoEnabled] = useState(false);
  // Match embroidery thread to the cap's main colours (crown base + accent)
  const [frontLogoMatchMain, setFrontLogoMatchMain] = useState(false);
  const [sideLogoMatchMain, setSideLogoMatchMain] = useState(false);

  useEffect(() => {
    setD((p) => ({
      ...p,
      hasCrownPrint: !!crownPrint,
      hasFrontLogoImage: !!frontLogoImg,
      hasBackPatchImage: !!backPatchImg,
      hasUnderBrimImage: !!underBrimImg,
      hasSideLogoImage: !!sideLogoImg,
    }));
  }, [crownPrint, frontLogoImg, backPatchImg, underBrimImg, sideLogoImg]);

  // Theme
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Stripes
  const setStripeCount = (n: number) => {
    setD((p) => {
      const next = [...p.stripes];
      while (next.length < n) next.push({ width: "mid", colour: p.crownColour });
      return { ...p, stripes: next.slice(0, n) };
    });
  };
  const updateStripe = (i: number, patch: Partial<StripeBand>) =>
    setD((p) => ({
      ...p,
      stripes: p.stripes.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }));

  // Module visibility for the active view
  const visible = VIEW_MODULES[d.view];

  // Module touch tracking (gate first generate). Only required for visible modules.
  const MODULE_LABELS: Record<ModuleKey, string> = {
    view: "View",
    crown: "Crown",
    mesh: "Mesh",
    brim: "Brim",
    stripes: "Side stripes",
    frontLogo: "Front logo",
    sideLogo: "Side logo",
    backPatch: "Back patch",
    snapback: "Snapback",
    underbrim: "Under-brim",
  };
  const moduleOrder = (Object.keys(visible) as ModuleKey[]).filter(
    (k) => k !== "view" && visible[k],
  );

  const [touched, setTouched] = useState<Record<ModuleKey, boolean>>({
    view: true,
    crown: false,
    mesh: false,
    brim: false,
    stripes: false,
    frontLogo: false,
    sideLogo: false,
    backPatch: false,
    snapback: false,
    underbrim: false,
  });
  const [flickering, setFlickering] = useState<Record<ModuleKey, boolean>>({
    view: false,
    crown: false,
    mesh: false,
    brim: false,
    stripes: false,
    frontLogo: false,
    sideLogo: false,
    backPatch: false,
    snapback: false,
    underbrim: false,
  });
  const refs = useRef<Record<ModuleKey, HTMLDivElement | null>>({
    view: null,
    crown: null,
    mesh: null,
    brim: null,
    stripes: null,
    frontLogo: null,
    sideLogo: null,
    backPatch: null,
    snapback: null,
    underbrim: null,
  });
  const mark = (k: ModuleKey) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));

  // Generation state
  const GEN_BUDGET = 15;
  const VERSIONS_PER_GEN = 1;
  // Width used when rasterising the colour-layout template that is sent to the
  // model as a reference. 512px = 1 image tile instead of 4, cutting input
  // tokens ~4x. Safe here because every piece of client artwork is ALSO sent
  // as its own full-resolution reference — the template only conveys layout.
  const TEMPLATE_REF_PX = 512;
  const MAX_SELECT = 10;
  type HistoryItem = {
    id: string;
    n: number;
    thumb: string;
    full: string;
    promptKey: string;
    view: CapView;
    design: CapDesign;
    supabaseId?: string;
    settings?: Record<string, unknown>;
  };
  const nextNRef = useRef(1);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  // Approved render loaded from an admin submission — used as the base image so
  // every generation recreates that exact design (including at other camera angles).
  const [adminBase, setAdminBase] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [genCount, setGenCount] = useState(0);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [iters, setIters] = useState(0);
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lockRef = useRef(false);

  const { user, isAdmin } = useAuth();
  type CapSubmission = {
    id: string;
    ts: number;
    picks: HistoryItem[];
    prompt: string;
    notes?: string;
    noteImageNumbers?: number[];
  };
  const [submissions, setSubmissions] = useState<CapSubmission[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(
        window.localStorage.getItem("cap_customer_submissions") || "[]",
      ) as CapSubmission[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Submissions embed base64 images and can exceed the ~5MB localStorage quota.
    // Trim oldest entries on QuotaExceededError so the app never crashes on save.
    let list = submissions;
    for (let i = 0; i < 8; i++) {
      try {
        window.localStorage.setItem("cap_customer_submissions", JSON.stringify(list));
        return;
      } catch {
        if (list.length <= 1) {
          try {
            window.localStorage.removeItem("cap_customer_submissions");
          } catch {
            /* ignore */
          }
          return;
        }
        list = list.slice(0, Math.max(1, list.length - Math.ceil(list.length / 2)));
      }
    }
  }, [submissions]);

  // Spec Sheet (admin tool)
  const [sheetKind, setSheetKind] = useState<ProductKind>("cap");
  const [sheetInitial, setSheetInitial] = useState<SpecSheet | null>(null);
  const [sheetReloadKey, setSheetReloadKey] = useState(0);
  // Admin submissions dashboard
  const [tab, setTab] = useState("design");
  const [adminSubmissions, setAdminSubmissions] = useState<
    Database["public"]["Tables"]["admin_submissions"]["Row"][]
  >([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminFilter, setAdminFilter] = useState<"all" | "pending" | "in_progress" | "completed">(
    "all",
  );
  const loadSubmissionIntoSheet = (s: CapSubmission) => {
    const base = defaultSpecSheet("cap");
    const views = base.views.map((v, i) => ({ ...v, dataUrl: s.picks[i]?.full ?? null }));
    setSheetKind("cap");
    setSheetInitial({
      ...base,
      views,
      notes: s.notes ?? "",
      jobNumber: s.id.slice(-6).toUpperCase(),
    });
    setSheetReloadKey((k) => k + 1);
  };

  // Apply "text off" overrides to the design used for prompt building.
  const effectiveDesign = useMemo<CapDesign>(() => {
    let next = d;
    if (!frontLogoTextOn) {
      next = { ...next, frontLogoLine1: "", frontLogoLine2: "" };
    }
    if (backPatchImg && backPatchTextOff) {
      next = { ...next, backPatchLine1: "", backPatchLine2: "" };
    }
    if (!sideLogoTextOn) {
      next = { ...next, sideLogoLine1: "", sideLogoLine2: "" };
    }
    if (!frontLogoEnabled) {
      next = { ...next, frontLogoLine1: "", frontLogoLine2: "", hasFrontLogoImage: false };
    }
    if (!sideLogoEnabled) {
      next = { ...next, sideLogoLine1: "", sideLogoLine2: "", hasSideLogoImage: false };
    }
    if (frontLogoMatchMain) {
      next = {
        ...next,
        frontLogoColour: next.crownColour,
        frontLogoUseOutline: true,
        frontLogoOutlineColour: next.crownPatternAccent,
        frontLogoMatchMain: true,
      };
    }
    if (sideLogoMatchMain) {
      next = {
        ...next,
        sideLogoColour: next.crownColour,
        sideLogoUseOutline: true,
        sideLogoOutlineColour: next.crownPatternAccent,
        sideLogoMatchMain: true,
      };
    }
    return next;
  }, [
    d,
    frontLogoTextOn,
    backPatchImg,
    backPatchTextOff,
    sideLogoTextOn,
    frontLogoEnabled,
    sideLogoEnabled,
    frontLogoMatchMain,
    sideLogoMatchMain,
  ]);
  const livePrompt = useMemo(() => buildCapPrompt(effectiveDesign), [effectiveDesign]);

  // Build EmbroideryTextOverlay props for each of the three text features
  // from the currently effective design. Returns null when both lines are
  // empty (so the overlay renders/composites nothing).
  const frontLogoTextProps = useMemo<EmbroideryTextProps | null>(() => {
    const l1 = effectiveDesign.frontLogoLine1;
    const l2 = effectiveDesign.frontLogoLine2;
    if (!l1.trim() && !l2.trim()) return null;
    return {
      line1: l1,
      line2: l2,
      font: effectiveDesign.frontLogoFont,
      flow: effectiveDesign.frontLogoFlow,
      colour: effectiveDesign.frontLogoColour,
      useOutline: effectiveDesign.frontLogoUseOutline,
      outlineColour: effectiveDesign.frontLogoOutlineColour,
    };
  }, [effectiveDesign]);

  const sideLogoTextProps = useMemo<EmbroideryTextProps | null>(() => {
    const l1 = effectiveDesign.sideLogoLine1;
    const l2 = effectiveDesign.sideLogoLine2;
    if (!l1.trim() && !l2.trim()) return null;
    return {
      line1: l1,
      line2: l2,
      font: effectiveDesign.sideLogoFont,
      flow: effectiveDesign.sideLogoFlow,
      colour: effectiveDesign.sideLogoColour,
      useOutline: effectiveDesign.sideLogoUseOutline,
      outlineColour: effectiveDesign.sideLogoOutlineColour,
    };
  }, [effectiveDesign]);

  const backPatchTextProps = useMemo<EmbroideryTextProps | null>(() => {
    const l1 = effectiveDesign.backPatchLine1;
    const l2 = effectiveDesign.backPatchLine2;
    if (!l1.trim() && !l2.trim()) return null;
    return {
      line1: l1,
      line2: l2,
      font: effectiveDesign.backPatchFont,
      flow: effectiveDesign.backPatchFlow,
      colour: effectiveDesign.backPatchColour,
      useOutline: effectiveDesign.backPatchUseOutline,
      outlineColour: effectiveDesign.backPatchOutlineColour,
    };
  }, [effectiveDesign]);

  // Default x for the side-logo text overlay depends on which side-panel
  // slot the user picked (front / middle / rear). Reset the overlay to the
  // default for that slot when the user changes the picker, so the label
  // ends up in the right area without needing to drag it every time.
  useEffect(() => {
    const x = d.sideLogoPosition === "front" ? 0.68 : d.sideLogoPosition === "rear" ? 0.88 : 0.78;
    setSideLogoTextOverlay((prev) => ({ ...prev, x }));
  }, [d.sideLogoPosition]);

  // Front 3/4 view: derive the colour-layout template from the current design
  // so the SVG preview tracks the colour pickers in real time.
  const templateColors = useMemo<CapTemplateColors>(() => {
    const meshHex = effectiveDesign.meshColour.hex;
    const stripes = effectiveDesign.stripes;
    // Visible SVG slots based on stripe count:
    //   0 → none, 1 → middle, 2 → middle + bottom, 3 → all three
    const n = stripes.length;
    const visibleSlotMap: Record<number, number[]> = {
      0: [],
      1: [1],
      2: [1, 2],
      3: [0, 1, 2],
    };
    const slots: [string, string, string] = [meshHex, meshHex, meshHex];
    (visibleSlotMap[Math.max(0, Math.min(3, n))] ?? []).forEach((slot, i) => {
      slots[slot] = stripes[i]?.colour.hex ?? meshHex;
    });
    return {
      crown: effectiveDesign.crownColour.hex,
      brim: effectiveDesign.brimColour.hex,
      underBrim: effectiveDesign.sandwichBrim
        ? effectiveDesign.sandwichColour.hex
        : effectiveDesign.brimColour.hex,
      button: effectiveDesign.crownColour.hex,
      mesh: meshHex,
      stripe1: slots[0],
      stripe2: slots[1],
      stripe3: slots[2],
    };
  }, [effectiveDesign]);

  const templateOptions = useMemo<CapTemplateOptions>(() => {
    const n = effectiveDesign.stripes.length;
    // 0 = none, 1 = middle only, 2 = middle + bottom, 3 = all
    const map: Record<number, [boolean, boolean, boolean]> = {
      0: [false, false, false],
      1: [false, true, false],
      2: [false, true, true],
      3: [true, true, true],
    };
    // Make visible stripes thicker when fewer are selected.
    const heightMap: Record<number, [number, number, number]> = {
      0: [1, 1, 1],
      1: [1, 2.0, 1],
      2: [1, 1.35, 1.35],
      3: [1, 1, 1],
    };
    const idx = Math.max(0, Math.min(3, n));
    return {
      stripeVisible: map[idx],
      stripeHeightScale: heightMap[idx],
      meshSolid: effectiveDesign.meshSolid,
      rope: effectiveDesign.rope,
      ropeHex: effectiveDesign.ropeColour.hex,
    };
  }, [
    effectiveDesign.stripes.length,
    effectiveDesign.meshSolid,
    effectiveDesign.rope,
    effectiveDesign.ropeColour.hex,
  ]);

  useEffect(() => {
    if (lastKey != null && lastKey !== livePrompt) setIters(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePrompt]);

  const callGenerate = async (
    prompt: string,
    baseImage?: string,
    baseMode?: "recreate" | "reangle",
    viewOverride?: CapView,
  ): Promise<string> => {
    const view = viewOverride ?? d.view;
    const labeledReferences: { label: string; url: string }[] = [];
    if (view === "front-3q") {
      try {
        const svg = recolorCapSvg(templateColors, templateOptions);
        const overlays: CapOverlay[] = [];
        if (frontLogoEnabled && frontLogoImg)
          overlays.push({ url: frontLogoImg, ...frontLogoOverlay });
        if (crownPrint && d.crownStyle === "sublimation")
          overlays.push({ url: crownPrint, ...crownPrintOverlay });
        if (sideLogoEnabled && sideLogoImg) overlays.push({ url: sideLogoImg, ...sideLogoOverlay });
        if (frontLogoTextProps) {
          const s = buildEmbroideryTextSvg(frontLogoTextProps);
          if (s)
            overlays.push({
              svg: s,
              ...frontBadgeTextOverlay,
              w: effectiveOverlayWidth(frontBadgeTextOverlay),
            });
        }
        if (sideLogoEnabled && sideLogoTextProps) {
          const s = buildEmbroideryTextSvg(sideLogoTextProps);
          if (s)
            overlays.push({
              svg: s,
              ...sideLogoTextOverlay,
              w: effectiveOverlayWidth(sideLogoTextOverlay),
            });
        }
        const templateDataUrl = await svgToPngDataUrl(svg, TEMPLATE_REF_PX, overlays);
        labeledReferences.push({
          label:
            "COLOUR-LAYOUT TEMPLATE — a flat line-art schematic of the cap showing which colour goes on which part (front-panel crown, peak/brim, under-brim trim, top button matching the crown, side/back mesh, and ONLY the stripe bands that are visible — render exactly that number of stripes, no extras). Any uploaded artwork composited onto the schematic indicates the EXACT position, size and orientation of that artwork on the finished cap. Use this STRICTLY as a colour-and-placement guide. Do NOT copy the line-art style, halftone dot mesh pattern, hand-drawn outlines, or 2D flat look — the final render must remain realistic 3D product photography as described in the text prompt.",
          url: templateDataUrl,
        });
      } catch (err) {
        console.warn("Cap template rasterisation failed; continuing without it.", err);
      }
    }
    if (view === "back-3q") {
      try {
        const svg = await buildTemplateSvg("back-3q", effectiveDesign);
        const overlays: CapOverlay[] = [];
        if (backPatchImg) overlays.push({ url: backPatchImg, ...backLogoOverlay });
        if (backPatchTextProps) {
          const s = buildEmbroideryTextSvg(backPatchTextProps);
          if (s)
            overlays.push({
              svg: s,
              ...backPatchTextOverlay,
              w: effectiveOverlayWidth(backPatchTextOverlay),
            });
        }
        if (sideLogoEnabled && sideLogoTextProps) {
          const s = buildEmbroideryTextSvg(sideLogoTextProps);
          if (s)
            overlays.push({
              svg: s,
              ...sideLogoTextOverlay,
              w: effectiveOverlayWidth(sideLogoTextOverlay),
            });
        }
        const templateDataUrl = await svgToPngDataUrl(svg, TEMPLATE_REF_PX, overlays);
        const noArt = !backPatchImg;
        labeledReferences.push({
          label:
            "COLOUR-LAYOUT TEMPLATE — a flat schematic of the REAR of the cap showing which colour goes on which part (back mesh panels and their darker shading, snapback strap and closure, top button matching the crown, bottom hem, brim edges and brim stitching). Any uploaded artwork composited onto the schematic indicates the EXACT position, size and orientation of that artwork on the finished cap. Follow the attached COLOUR-LAYOUT TEMPLATE exactly for panel colours, strap colour and logo placement — it is a flat colour guide, render it as a photorealistic cap. Do NOT copy the line-art style, halftone dot mesh pattern, hand-drawn outlines, or 2D flat look — the final render must remain realistic 3D product photography as described in the text prompt." +
            (noArt
              ? " NO REAR LOGO — do NOT invent any patch, badge, embroidered logo or text on the rear panel above the snapback; keep the back mesh clean."
              : ""),
          url: templateDataUrl,
        });
      } catch (err) {
        console.warn("Cap back-template rasterisation failed; continuing without it.", err);
      }
    }
    if (view === "underside") {
      try {
        const svg = await buildTemplateSvg("underside", effectiveDesign);
        const overlays: CapOverlay[] = [];
        const hasArt =
          (underBrimMode === "upload" || underBrimMode === "logo-pattern") &&
          (underBrimImg || underBrimSublimationLogo);
        if (hasArt) {
          const url = (underBrimImg || underBrimSublimationLogo) as string;
          overlays.push({ url, ...underBrimOverlay });
        }
        const templateDataUrl = await svgToPngDataUrl(svg, TEMPLATE_REF_PX, overlays);
        labeledReferences.push({
          label:
            "COLOUR-LAYOUT TEMPLATE — a flat schematic of the UNDERSIDE of the cap (under-brim trim colour, brim edge, interior crown, sweatband, mesh, and the crown panels visible from below). Any uploaded artwork composited onto the schematic indicates the EXACT position, size and orientation of that artwork within the under-brim print zone. Follow the attached COLOUR-LAYOUT TEMPLATE exactly for panel colours and artwork placement — it is a flat colour guide, render it as a photorealistic cap underside. Do NOT copy the line-art style, halftone dot mesh pattern, hand-drawn outlines, or 2D flat look — the final render must remain realistic 3D product photography as described in the text prompt." +
            (hasArt
              ? ""
              : " NO UNDER-BRIM ARTWORK — do NOT invent any print, pattern, badge, embroidered logo or text on the underside of the brim; keep the under-brim a clean solid colour."),
          url: templateDataUrl,
        });
      } catch (err) {
        console.warn("Cap underside-template rasterisation failed; continuing without it.", err);
      }
    }
    if (view === "front-3q" && frontLogoEnabled && frontLogoImg)
      labeledReferences.push({
        label:
          "FRONT LOGO artwork — use ONLY for the front centre badge. Reproduce the ENTIRE supplied artwork faithfully as the embroidered badge, INCLUDING any solid or shaped background it sits on (e.g. a black circle or square panel) — that background is part of the badge and must appear on the final product. Do NOT mask, knock out, remove or make transparent any part of the background, and do NOT crop or reshape the artwork. Do NOT copy this artwork onto the side panel, back patch, crown print or under-brim.",
        url: frontLogoImg,
      });
    if (view === "front-3q" && crownPrint && d.crownStyle === "sublimation")
      labeledReferences.push({
        label:
          "CROWN SUBLIMATION pattern — use ONLY as the all-over print on the front-panel crown fabric. Do NOT place this artwork on the front logo, side logo, back patch or under-brim.",
        url: crownPrint,
      });
    if (view === "front-3q" && crownSublimationLogo && d.crownStyle === "sublimation")
      labeledReferences.push({
        label:
          "CROWN SUBLIMATION SOURCE LOGO — generate an original all-over repeating sublimation pattern derived from this single logo (tiled/scattered/mirrored at varying scales and rotations, in coordinated colours) and apply it ONLY to the front-panel crown fabric. Do NOT place a single instance of this logo as a badge, and do NOT use it on the front logo, side logo, back patch or under-brim.",
        url: crownSublimationLogo,
      });
    if (view === "back-3q" && backPatchImg)
      labeledReferences.push({
        label:
          "BACK PATCH artwork — use ONLY for the flat embroidered patch above the snapback. Reproduce the ENTIRE supplied artwork faithfully as the embroidered patch, INCLUDING any solid or shaped background it sits on (e.g. a black circle or square panel) — that background is part of the patch and must appear on the final product. Do NOT mask, knock out, remove or make transparent any part of the background, and do NOT crop or reshape the artwork. Do NOT copy this artwork onto the side panel, front logo or under-brim.",
        url: backPatchImg,
      });
    if (view === "underside" && underBrimImg)
      labeledReferences.push({
        label:
          "UNDER-BRIM print — this artwork has ALREADY been pre-cropped by the customer to the exact brim-underside shape (transparent outside the brim outline; the opaque region IS the final print area). Treat the supplied artwork as the finished, final print and reproduce every visible (non-transparent) pixel on the brim underside as a natural, realistic dye-sublimation print. CRITICAL: do NOT crop, trim, mask, shrink, inset, re-fit or re-position the artwork further — the opaque area must map 1:1 to the brim underside edge-to-edge with nothing cut off at the sides, tip or base. Do NOT scale, rotate, recompose, repeat, mirror or recolour it. Do NOT add a border, background fill, or letterboxing around it. Do NOT place this artwork anywhere else on the cap (no crown, panels, front logo, side logo or back patch).",
        url: underBrimImg,
      });
    if (view === "underside" && underBrimSublimationLogo)
      labeledReferences.push({
        label:
          "UNDER-BRIM SUBLIMATION SOURCE LOGO — generate an original all-over repeating sublimation pattern derived from this single logo (tiled/scattered/mirrored at varying scales and rotations, coordinated colour palette, edge-to-edge, following the brim curve) and apply it ONLY to the underside of the brim. Do NOT place a single instance of this logo as a badge, and do NOT use it on the crown, front logo, side logo or back patch.",
        url: underBrimSublimationLogo,
      });
    if ((view === "front-3q" || view === "back-3q") && sideLogoEnabled && sideLogoImg)
      labeledReferences.push({
        label:
          "SIDE LOGO artwork — use ONLY for the small embroidered logo on the LEFT or RIGHT mesh side panel of the cap. This is NOT the back patch. Reproduce the ENTIRE supplied artwork faithfully as the embroidered logo, INCLUDING any solid or shaped background it sits on (e.g. a black circle or square panel) — that background is part of the logo and must appear on the final product. Do NOT mask, knock out, remove or make transparent any part of the background, and do NOT crop or reshape the artwork. Do NOT place this artwork on the back panel above the snapback, on the front badge, on the crown or on the under-brim. The back patch (if any) is described separately in text only.",
        url: sideLogoImg,
      });

    // Retry once on transient 429/502 with a short backoff
    const doFetch = async () =>
      fetch("/api/generate-cap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
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
      const results = await Promise.allSettled(
        Array.from({ length: VERSIONS_PER_GEN }).map(() =>
          callGenerate(livePrompt, adminBase ?? undefined, adminBase ? "reangle" : undefined),
        ),
      );
      const urls = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (urls.length === 0) throw new Error("All generation attempts failed — please try again.");
      const snapshot = effectiveDesign;
      const items: HistoryItem[] = await Promise.all(
        urls.map(async (u) => {
          const settings = buildSettingsSnapshot(snapshot, sideLogoEnabled);
          let supabaseId: string | undefined;
          if (user) {
            const { data: saved } = await supabase
              .from("cap_designs")
              .insert({
                user_id: user.id,
                image_url: u,
                view: d.view,
                settings: settings as unknown as never,
              })
              .select()
              .single();
            supabaseId = saved?.id;
          }
          return {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            n: nextNRef.current++,
            thumb: await makeThumb(u),
            full: u,
            promptKey: livePrompt,
            view: d.view,
            design: snapshot,
            settings,
            supabaseId,
          };
        }),
      );
      setHistory((h) => [...items, ...h]);
      setImageUrl(items[0].full);
      setGenCount((c) => c + 1);
      setIters((n) => (lastKey === livePrompt ? n + 1 : 1));
      setLastKey(livePrompt);
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
    setSelectedIds((cur) =>
      cur.includes(id)
        ? cur.filter((x) => x !== id)
        : cur.length >= MAX_SELECT
          ? cur
          : [...cur, id],
    );

  const [submitted, setSubmitted] = useState(false);
  const [notes, setNotes] = useState("");
  const [noteImageNumbers, setNoteImageNumbers] = useState<number[]>([]);
  const NOTE_MAX_IMAGES = 5;
  const toggleNoteImage = (n: number) =>
    setNoteImageNumbers((cur) =>
      cur.includes(n)
        ? cur.filter((x) => x !== n)
        : cur.length >= NOTE_MAX_IMAGES
          ? cur
          : [...cur, n],
    );

  const saveImage = (h: HistoryItem) => {
    const a = document.createElement("a");
    a.href = h.full;
    a.download = `cap-${h.view}-${h.n}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const deleteHistoryItem = (id: string) => {
    setHistory((h) => h.filter((x) => x.id !== id));
    setSelectedIds((cur) => cur.filter((x) => x !== id));
    const removed = history.find((x) => x.id === id);
    if (removed) setNoteImageNumbers((cur) => cur.filter((x) => x !== removed.n));
  };
  const buildSettingsSnapshot = (
    snap: CapDesign,
    sideLogoOn: boolean,
  ): Record<string, unknown> => ({
    crownStyle: snap.crownStyle,
    crownColour: snap.crownColour,
    meshColour: snap.meshColour,
    meshSolid: snap.meshSolid,
    brimColour: snap.brimColour,
    sandwichBrim: snap.sandwichBrim,
    rope: snap.rope,
    stripeCount: snap.stripes.length,
    stripes: snap.stripes,
    frontBadgeType: snap.frontBadgeType,
    frontLogoLine1: snap.frontLogoLine1,
    frontLogoLine2: snap.frontLogoLine2,
    backPatchLine1: snap.backPatchLine1,
    backPatchLine2: snap.backPatchLine2,
    backPatchFont: snap.backPatchFont,
    backPatchTextFlow: (snap as unknown as { backPatchFlow?: unknown }).backPatchFlow,
    backPatchThreadColour: (snap as unknown as { backPatchColour?: unknown }).backPatchColour,
    snapbackStrap: snap.snapbackStrap,
    snapbackColour: snap.snapbackColour,
    sideLogoEnabled: sideLogoOn,
    design: snap,
  });

  // Consume a pending admin "Open in builder" request (written by the admin panel).
  useEffect(() => {
    const req = consumeBuilderLoadRequest("cap");
    if (!req) return;
    if (req.design && typeof req.design === "object") {
      setD({ ...DEFAULT_CAP_DESIGN, ...(req.design as Partial<CapDesign>) });
    }
    if (req.view === "front-3q" || req.view === "back-3q" || req.view === "underside") {
      set("view", req.view);
    }
    if (req.baseImage && req.baseImage.startsWith("data:image/")) setAdminBase(req.baseImage);
    toast.success("Design loaded from submission — generations will recreate this exact design.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Generate one render per camera view, all anchored to the approved base image.
  const ALL_CAP_VIEWS: CapView[] = ["front-3q", "back-3q", "underside"];
  const generateAllViews = async () => {
    if (lockRef.current || loading || !adminBase) return;
    if (genCount + ALL_CAP_VIEWS.length > GEN_BUDGET) {
      setError("Not enough generation budget left for all 3 views.");
      return;
    }
    lockRef.current = true;
    setLoading(true);
    setError(null);
    try {
      for (const v of ALL_CAP_VIEWS) {
        const design: CapDesign = { ...effectiveDesign, view: v };
        const prompt = buildCapPrompt(design);
        const u = await callGenerate(prompt, adminBase, "reangle", v);
        const settings = buildSettingsSnapshot(design, sideLogoEnabled);
        const item: HistoryItem = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          n: nextNRef.current++,
          thumb: await makeThumb(u),
          full: u,
          promptKey: prompt,
          view: v,
          design,
          settings,
        };
        setHistory((h) => [item, ...h]);
        setImageUrl(u);
        setGenCount((c) => c + 1);
      }
      toast.success("All 3 views generated from the approved design.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
      setTimeout(() => {
        lockRef.current = false;
      }, 1200);
    }
  };

  const restoreSettings = (item: HistoryItem) => {
    const s = item.settings as Record<string, unknown> | undefined;
    if (!s) {
      if (item.design) setD(item.design);
      if (item.view) set("view", item.view);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // Prefer the full design snapshot when present — guarantees fidelity.
    if (s.design && typeof s.design === "object") {
      setD(s.design as CapDesign);
    } else {
      setD((p) => {
        const next = { ...p };
        const assign = <K extends keyof CapDesign>(k: K, v: unknown) => {
          if (v !== undefined) (next[k] as unknown) = v;
        };
        assign("crownStyle", s.crownStyle);
        assign("crownColour", s.crownColour);
        assign("meshColour", s.meshColour);
        assign("meshSolid", s.meshSolid);
        assign("brimColour", s.brimColour);
        assign("sandwichBrim", s.sandwichBrim);
        assign("rope", s.rope);
        assign("stripes", s.stripes);
        assign("frontBadgeType", s.frontBadgeType);
        assign("frontLogoLine1", s.frontLogoLine1);
        assign("frontLogoLine2", s.frontLogoLine2);
        assign("backPatchLine1", s.backPatchLine1);
        assign("backPatchLine2", s.backPatchLine2);
        assign("snapbackStrap", s.snapbackStrap);
        assign("snapbackColour", s.snapbackColour);
        return next;
      });
    }
    if (s.sideLogoEnabled !== undefined) setSideLogoEnabled(Boolean(s.sideLogoEnabled));
    if (item.view) set("view", item.view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Load saved cap designs for the signed-in user.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("cap_designs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled || !data) return;
      const items: HistoryItem[] = await Promise.all(
        data.map(async (row) => {
          const settings = (row.settings ?? {}) as Record<string, unknown>;
          const design = (settings.design as CapDesign | undefined) ?? DEFAULT_CAP_DESIGN;
          return {
            id: `db-${row.id}`,
            n: nextNRef.current++,
            thumb: await makeThumb(row.image_url).catch(() => row.image_url),
            full: row.image_url,
            promptKey: "",
            view: row.view as CapView,
            design,
            supabaseId: row.id,
            settings,
          };
        }),
      );
      if (!cancelled) setHistory((h) => [...h, ...items]);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Fetch admin submissions when admin tab is active
  useEffect(() => {
    if (tab !== "admin" || !isAdmin) return;
    setAdminLoading(true);
    supabase
      .from("admin_submissions")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setAdminSubmissions(data);
        setAdminLoading(false);
      });
  }, [tab, isAdmin]);

  const updateSubmissionStatus = async (
    id: string,
    status: "pending" | "in_progress" | "completed",
  ) => {
    const { error } = await supabase.from("admin_submissions").update({ status }).eq("id", id);
    if (error) {
      toast.error("Failed to update status.");
      return;
    }
    setAdminSubmissions((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
  };

  const regenerateFrom = async (h: HistoryItem) => {
    if (lockRef.current || loading) return;
    if (genCount >= GEN_BUDGET) {
      setError("Generation limit reached.");
      return;
    }
    setD(h.design);
    lockRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        // Pass the picked render as the base so "regenerate from this" produces
        // fresh renders of the SAME cap design instead of new random samples.
        Array.from({ length: VERSIONS_PER_GEN }).map(() => callGenerate(h.promptKey, h.full)),
      );
      const urls = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (urls.length === 0) throw new Error("All generation attempts failed — please try again.");
      const items: HistoryItem[] = await Promise.all(
        urls.map(async (u) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          n: nextNRef.current++,
          thumb: await makeThumb(u),
          full: u,
          promptKey: h.promptKey,
          view: h.view,
          design: h.design,
        })),
      );
      setHistory((cur) => [...items, ...cur]);
      setImageUrl(items[0].full);
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

  const submitSelection = async () => {
    if (selectedIds.length === 0) return;
    const picks = selectedIds
      .map((id) => history.find((h) => h.id === id))
      .filter(Boolean) as HistoryItem[];
    const noteTargets = noteImageNumbers.filter((n) => picks.some((p) => p.n === n));
    const sub: CapSubmission = {
      id: `sub-${Date.now()}`,
      ts: Date.now(),
      picks,
      prompt: livePrompt,
      notes: notes.trim() || undefined,
      noteImageNumbers: noteTargets.length ? noteTargets : undefined,
    };
    setSubmissions((cur) => [sub, ...cur]);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);

    const selectedDesigns = history.filter((h) => selectedIds.includes(h.id));

    const snapshot = await Promise.all(
      selectedDesigns.map(async (d) => {
        const src = d.full ?? d.thumb;
        return {
          image_url: await makeThumb(src, 512).catch(() => src),
          view: d.view,
          settings: d.settings ?? null,
        };
      }),
    );

    const { error: submitError } = await supabase.from("admin_submissions").insert({
      user_id: user?.id ?? null,
      brand_name: (user?.user_metadata?.brand_name as string | null) ?? null,
      product_type: "cap",
      designs_snapshot: snapshot as unknown as never,
      notes: notes,
      status: "pending",
      client_name: customer.name,
      user_email: customer.email,
    });

    if (submitError) {
      toast.error("Failed to send — please try again.");
    } else {
      toast.success("Sent. We'll be in touch.");
    }
  };

  const downloadSubmissionDocx = async (sub: CapSubmission) => {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, PageBreak } =
      await import("docx");
    const dataUrlToUint8 = (u: string): { bytes: Uint8Array; type: "png" | "jpg" } => {
      const [meta, b64] = u.split(",");
      const isPng = /png/i.test(meta);
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return { bytes: arr, type: isPng ? "png" : "jpg" };
    };
    const noteHeading =
      sub.noteImageNumbers && sub.noteImageNumbers.length > 0
        ? `Customer notes (applies to: ${sub.noteImageNumbers.map((n) => `#${n}`).join(", ")})`
        : "Customer notes";
    const children: InstanceType<typeof Paragraph>[] = [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun(`Cap Design Submission`)],
      }),
      new Paragraph({ children: [new TextRun(`Submitted: ${new Date(sub.ts).toLocaleString()}`)] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(noteHeading)] }),
      new Paragraph({
        children: [new TextRun(sub.notes && sub.notes.length ? sub.notes : "(none)")],
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Selected designs")],
      }),
    ];
    for (let i = 0; i < sub.picks.length; i++) {
      const p = sub.picks[i];
      try {
        const { bytes, type } = dataUrlToUint8(p.full);
        children.push(
          new Paragraph({ children: [new TextRun(`Image #${p.n} — view: ${p.view}`)] }),
        );
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                type,
                data: bytes,
                transformation: { width: 480, height: 480 },
                altText: { title: `Image #${p.n}`, description: p.view, name: `image-${p.n}` },
              }),
            ],
          }),
        );
      } catch {
        children.push(
          new Paragraph({ children: [new TextRun(`Design ${i + 1} (image unavailable)`)] }),
        );
      }
    }
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Generation prompt")],
      }),
    );
    sub.prompt
      .split(/\n+/)
      .forEach((line) => children.push(new Paragraph({ children: [new TextRun(line)] })));

    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cap-submission-${new Date(sub.ts).toISOString().replace(/[:.]/g, "-")}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Submissions grouped by day (last 10 days)
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

  // Helper to render a module slot with stable wiring.
  const renderMod = (k: ModuleKey, children: React.ReactNode) => {
    const isGuideTarget =
      guide.active && !guide.isCompleted && guide.currentStep.targetModule === k;
    return (
      <ModSlot
        innerRef={(el) => {
          refs.current[k] = el;
        }}
        flicker={flickering[k]}
        onTouch={() => mark(k)}
        isGuideTarget={isGuideTarget}
        guideActive={guide.active && !guide.isCompleted}
      >
        {children}
      </ModSlot>
    );
  };

  const handleGuideAction = (action: GuideAction) => {
    switch (action.type) {
      case "set-view":
        set("view", action.value as CapView);
        break;
      case "set-crown-style":
        set("crownStyle", action.value as CrownStyle);
        break;
      case "set-stripe-count":
        setStripeCount(action.value);
        break;
      case "set-badge-type":
        set("frontBadgeType", action.value as BadgeType);
        break;
      case "set-snapback-strap":
        set("snapbackStrap", action.value as SnapbackStrap);
        break;
      case "set-underbrim-mode":
        setUnderBrimMode(action.value);
        break;
      case "set-mesh-solid":
        set("meshSolid", action.value);
        break;
      case "set-sandwich-brim":
        set("sandwichBrim", action.value);
        break;
      case "set-rope":
        set("rope", action.value);
        break;
    }
  };

  // ── Guide walkthrough wiring ────────────────────────────────────────────
  const isMobile = useIsMobile();
  const welcome = useWelcome();
  // Linked defaults: mesh follows crown until the user diverges it.
  useColourFollow(d.crownColour, d.meshColour, (s) => set("meshColour", s as typeof d.meshColour));

  const guide = useGuide(d.view);

  // Numbered stage accordion for the controls column. One open at a time;
  // all pinned open while the guided tour is running so targets stay visible.
  const [openStage, setOpenStage] = useState(1);
  // Opening a stage counts as reviewing every section inside it — users
  // shouldn't have to click each individual card to unlock Generate.
  const STAGE_MODULES: Record<number, ModuleKey[]> = {
    1: ["view"],
    2: ["crown", "mesh", "brim", "stripes"],
    3: ["frontLogo", "sideLogo", "backPatch", "snapback", "underbrim"],
  };
  const markStage = (n: number) => (STAGE_MODULES[n] ?? []).forEach((k) => mark(k));
  useEffect(() => {
    if (openStage > 0) markStage(openStage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openStage]);
  const toggleStage = (n: number) => setOpenStage((cur) => (cur === n ? 0 : n));
  const STAGE_LIST = [
    { step: 1, title: "View" },
    { step: 2, title: "Base design" },
    { step: 3, title: "Branding" },
  ];
  const goToStage = (n: number) => {
    setOpenStage(n);
    // Jump back to the top so the newly opened stage starts in view instead of
    // leaving the reader stranded at the bottom of the previous one.
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };
  const visibleSteps = useMemo(
    () =>
      guide.steps
        .map((step, absoluteIndex) => ({ step, absoluteIndex }))
        .filter(({ step }) => {
          if (["welcome", "view", "brim", "generate"].includes(step.id)) return true;
          if (d.view === "front-3q")
            return ["crown", "mesh", "stripes", "frontLogo", "sideLogo"].includes(step.id);
          if (d.view === "back-3q")
            return ["crown", "mesh", "stripes", "sideLogo", "backPatch", "snapback"].includes(
              step.id,
            );
          if (d.view === "underside") return step.id === "underbrim";
          return false;
        }),
    [guide.steps, d.view],
  );
  const visibleStepIndex = Math.max(
    0,
    visibleSteps.findIndex((vs) => vs.absoluteIndex === guide.stepIndex),
  );

  // View-change mid-guide: if current step is no longer visible, skip forward;
  // also show a brief notice in the panel.
  const [viewChangeNotice, setViewChangeNotice] = useState<string | null>(null);
  const prevViewRef = useRef(d.view);
  useEffect(() => {
    if (prevViewRef.current === d.view) return;
    prevViewRef.current = d.view;
    if (!guide.active) return;
    const stillVisible = visibleSteps.some((vs) => vs.absoluteIndex === guide.stepIndex);
    if (!stillVisible) {
      // Jump to nearest next visible step's absolute index
      const nextVs =
        visibleSteps.find((vs) => vs.absoluteIndex >= guide.stepIndex) ?? visibleSteps[0];
      if (nextVs) guide.goTo(nextVs.absoluteIndex);
    }
    const label =
      d.view === "front-3q" ? "Front 3/4" : d.view === "back-3q" ? "Back 3/4" : "Underside";
    setViewChangeNotice(`Switched to ${label} view`);
    const t = window.setTimeout(() => setViewChangeNotice(null), 3000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.view]);

  // Force front-3q view while guide is active
  useEffect(() => {
    if (guide.active && d.view !== "front-3q") {
      set("view", "front-3q");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide.active]);

  // Derive a confirmation message describing what the user just configured
  // in the current section. Driven by the live design state `d` and the
  // local underBrimMode (which lives outside `d`).
  const deriveConfirmedMessage = (
    stepId: string,
    design: CapDesign,
    ubMode: "plain" | "upload" | "logo-pattern",
  ): string => {
    switch (stepId) {
      case "view":
        return "View selected";
      case "crown": {
        const label = CROWN_STYLE_LABELS[design.crownStyle] ?? "Crown style";
        return `${label} selected`;
      }
      case "mesh":
        return `${design.meshColour.name} mesh selected`;
      case "brim":
        return design.sandwichBrim ? "Sandwich trim added" : "Brim colour updated";
      case "stripes": {
        const n = design.stripes.length;
        return `${n} stripe${n === 1 ? "" : "s"} configured`;
      }
      case "frontLogo":
        return `${design.frontBadgeType} selected`;
      case "sideLogo":
        return "Side logo configured";
      case "backPatch":
        return "Back patch configured";
      case "snapback":
        return design.snapbackStrap === "leather"
          ? "Leather strap selected"
          : "Plastic snapback selected";
      case "underbrim":
        return ubMode === "plain"
          ? "Plain brim"
          : ubMode === "upload"
            ? "Artwork upload ready"
            : "Logo pattern selected";
      default:
        return "Section complete";
    }
  };

  // Confirmed state — once the active step has any detected change, we show
  // a confirmation block and require an explicit "Continue" click to advance.
  const [confirmedMessage, setConfirmedMessage] = useState<string | null>(null);
  const [justCompleted] = useState(false);

  // Snapshot the design at the moment a step becomes active. Used to detect
  // ANY interaction with the active section.
  const stepEntrySnapshotRef = useRef<CapDesign | null>(null);
  useEffect(() => {
    if (!guide.active) {
      stepEntrySnapshotRef.current = null;
      setConfirmedMessage(null);
      return;
    }
    stepEntrySnapshotRef.current = { ...d };
    setConfirmedMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide.currentStep.id, guide.active]);

  // When the active step's watched fields diverge from the entry snapshot,
  // enter (or refresh) the confirmed state. NEVER auto-advance.
  useEffect(() => {
    if (!guide.active) return;
    const snap = stepEntrySnapshotRef.current;
    if (!snap) return;
    const keys = guide.currentStep.watchKeys as (keyof CapDesign)[];
    if (!keys.length) return;
    const changed = keys.some((k) => JSON.stringify(d[k]) !== JSON.stringify(snap[k]));
    if (changed) {
      if (guide.currentStep.targetModule) {
        mark(guide.currentStep.targetModule as ModuleKey);
      }
      setConfirmedMessage(deriveConfirmedMessage(guide.currentStep.id, d, underBrimMode));
      if (guide.watchingForChange) guide.setWatchingForChange(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, underBrimMode, guide.active, guide.currentStep.id]);

  const ALL_MODULE_KEYS: ModuleKey[] = [
    "view",
    "crown",
    "mesh",
    "brim",
    "stripes",
    "frontLogo",
    "sideLogo",
    "backPatch",
    "snapback",
    "underbrim",
  ];

  const advanceGuide = () => {
    // If advancing from the last visible step will complete the guide,
    // mark every module touched so the generate gate doesn't block.
    const curIdx = visibleSteps.findIndex((vs) => vs.absoluteIndex === guide.stepIndex);
    const isLastVisible = curIdx === visibleSteps.length - 1;
    if (isLastVisible) {
      ALL_MODULE_KEYS.forEach((k) => mark(k));
    }
    guide.advance();
  };

  const handleAccept = () => {
    const step = guide.currentStep;
    const action = step.recommendationAction;
    if (step.targetModule) {
      mark(step.targetModule as ModuleKey);
    }
    if (!action) {
      // No action attached (e.g. "Skip for now" on optional steps) → advance.
      setConfirmedMessage(null);
      advanceGuide();
      return;
    }
    handleGuideAction(action);
    // Fallback message; the d-effect above will refine it once state updates.
    setConfirmedMessage(`${step.recommendationLabel} applied`);
  };
  const handleOwnChoice = () => {
    guide.setWatchingForChange(true);
  };
  const handlePickUnderBrim = (mode: "plain" | "upload" | "logo-pattern") => {
    setUnderBrimMode(mode);
    setConfirmedMessage(deriveConfirmedMessage("underbrim", d, mode));
  };
  const handleGuideNext = () => {
    setConfirmedMessage(null);
    advanceGuide();
  };

  const guideActive = guide.hydrated && guide.active && !guide.guideComplete;

  const guideSelectedOption = (() => {
    const mod = guide.currentStep.targetModule;
    if (mod === "crown") return d.crownStyle;
    if (mod === "frontLogo") return d.frontBadgeType;
    if (mod === "snapback") return d.snapbackStrap;
    if (mod === "mesh") return String(d.meshSolid);
    return undefined;
  })();

  // Guide panel ref (for the SVG arrow endpoint)

  // Pulse the Generate button + toast for ~8s after the guide finishes.
  const [generatePulse, setGeneratePulse] = useState(false);
  const prevGuideCompleteRef = useRef(false);
  useEffect(() => {
    if (guide.guideComplete && !prevGuideCompleteRef.current) {
      setGeneratePulse(true);
      toast("You're all set — hit Generate to see your cap.", {
        position: "bottom-left",
        duration: 5000,
      });
      const t = setTimeout(() => setGeneratePulse(false), 8000);
      prevGuideCompleteRef.current = true;
      return () => clearTimeout(t);
    }
    if (!guide.guideComplete) prevGuideCompleteRef.current = false;
  }, [guide.guideComplete]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <WelcomeOverlay
        open={welcome.open}
        productName={WELCOME_CONTENT.cap.productName}
        slides={WELCOME_CONTENT.cap.slides}
        onTakeTour={() => {
          welcome.dismiss();
          guide.open();
        }}
        onDone={welcome.dismiss}
      />
      <UnderBrimCropDialog
        open={underBrimRaw !== null}
        source={underBrimRaw}
        onCancel={() => setUnderBrimRaw(null)}
        onConfirm={(cropped) => {
          setUnderBrimImg(cropped);
          setUnderBrimRaw(null);
        }}
      />
      {!guideActive && guide.hydrated && (
        <HelpFab onClick={guide.open} label="Reopen guide">
          <HelpCircle className="h-4 w-4" />
        </HelpFab>
      )}
      <BuilderTabs active="cap" hasUnsavedWork={history.length > 0} />
      <BuilderHeader
        title="Cap Designer"
        subtitle="5-panel trucker cap — design front, back & underside views."
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      />

      <div className="mx-auto max-w-7xl px-4">
        <main className="grid gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-start">
          {/* Controls */}
          <section className="space-y-3">
            {/* Stage 1 — View (always visible) */}
            <StageSection
              step={1}
              title="Choose your view"
              subtitle="Front, back or underside — design each separately"
              open={openStage === 1}
              forceOpen={guideActive}
              onToggle={() => toggleStage(1)}
              onNext={() => goToStage(2)}
              nextLabel="Continue to Base design"
            >
              {renderMod(
                "view",
                <Card data-guide-id="view" title="View">
                  <Field label="Select view">
                    <div className="grid gap-2 sm:grid-cols-3">
                      {(Object.keys(CAP_VIEW_LABELS) as CapView[]).map((v) => {
                        const locked = guide.active && v !== "front-3q";
                        return (
                          <button
                            key={v}
                            type="button"
                            onClick={() => {
                              if (!guide.active) set("view", v);
                            }}
                            disabled={locked}
                            className={cn(
                              "rounded-md border p-3 text-left text-sm transition-all",
                              d.view === v
                                ? "border-foreground ring-2 ring-foreground"
                                : "border-border hover:bg-muted",
                              locked && "opacity-30 pointer-events-none",
                            )}
                          >
                            <div className="font-medium">{CAP_VIEW_LABELS[v]}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {v === "front-3q" &&
                                "Crown, front logo, brim, stripes wrapping forward"}
                              {v === "back-3q" &&
                                "Mesh, back patch, snapback, stripes wrapping rear"}
                              {v === "underside" && "Under-brim print, inner tape, peak up"}
                            </div>
                            {locked && (
                              <div className="mt-1 text-[10px] text-muted-foreground italic">
                                Complete the guide to unlock
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Modules not visible in this shot are hidden below to keep things simple.
                  </p>
                </Card>,
              )}
            </StageSection>

            {(visible.crown || visible.mesh || visible.brim || visible.stripes) && (
              <StageSection
                step={2}
                title="Base design"
                subtitle="Crown, mesh, brim & stripes"
                open={openStage === 2}
                forceOpen={guideActive}
                onToggle={() => toggleStage(2)}
                onNext={() => goToStage(3)}
                nextLabel="Continue to Branding"
              >
                {visible.crown &&
                  renderMod(
                    "crown",
                    <Card data-guide-id="crown" title="Crown">
                      <div className="space-y-4">
                        <Field label="Crown style">
                          <Select
                            value={d.crownStyle}
                            onValueChange={(v) => set("crownStyle", v as CrownStyle)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(CROWN_STYLE_LABELS) as CrownStyle[]).map((s) => (
                                <SelectItem key={s} value={s}>
                                  {CROWN_STYLE_LABELS[s]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field
                          label={d.crownStyle === "solid" ? "Crown colour" : "Crown base colour"}
                        >
                          <SwatchGrid
                            selected={d.crownColour}
                            onPick={(s) => set("crownColour", s)}
                          />
                        </Field>
                        {d.crownStyle !== "solid" && d.crownStyle !== "sublimation" && (
                          <Field label="Accent colour">
                            <SwatchGrid
                              selected={d.crownPatternAccent}
                              onPick={(s) => set("crownPatternAccent", s)}
                            />
                          </Field>
                        )}
                        {d.crownStyle === "sewn-pattern" && (
                          <Field label="Stitched pattern">
                            {(() => {
                              const selected = d.crownSewnPatterns[0];
                              const visible = selected ? [selected] : SEWN_PATTERN_OPTIONS;
                              return (
                                <div className="grid grid-cols-2 gap-2">
                                  {visible.map((p) => {
                                    const checked = selected === p;
                                    return (
                                      <label
                                        key={p}
                                        className="flex items-center gap-2 rounded-md border border-border p-2 text-sm"
                                      >
                                        <Checkbox
                                          checked={checked}
                                          onCheckedChange={(v) => {
                                            set("crownSewnPatterns", v ? [p] : []);
                                          }}
                                        />
                                        {p}
                                      </label>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              Single-row thick stitched thread laid directly into the crown fabric.
                            </p>
                          </Field>
                        )}
                        {d.crownStyle === "sublimation" && (
                          <>
                            <Field label="Sublimation print">
                              <ImageUpload
                                label="Upload crown sublimation print"
                                value={crownPrint}
                                onChange={setCrownPrint}
                                maxSizeMB={12}
                                verboseWarnings
                                builder="cap"
                                assetType="crown_sublimation"
                              />
                            </Field>
                            <Field label="Generate from logo">
                              <ImageUpload
                                label="Upload logo to build pattern from"
                                value={crownSublimationLogo}
                                onChange={setCrownSublimationLogo}
                                maxSizeMB={12}
                                verboseWarnings
                                builder="cap"
                                assetType="crown_sublimation_tile"
                              />
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                Your logo will be tiled into a sublimation pattern across the crown.
                              </p>
                            </Field>
                          </>
                        )}
                      </div>
                    </Card>,
                  )}

                {(visible.mesh || visible.brim) && (
                  <Card data-guide-id="colours" title="Colours">
                    <div
                      className={cn(
                        "grid gap-4",
                        visible.mesh && visible.brim && "sm:grid-cols-2",
                      )}
                    >
                      {visible.mesh &&
                        renderMod(
                          "mesh",
                          <div className="space-y-3">
                            <Field label="Mesh colour">
                              <SwatchGrid
                                selected={d.meshColour}
                                onPick={(s) => set("meshColour", s)}
                              />
                            </Field>
                            <label className="flex items-center gap-2 rounded-md border border-dashed border-border p-2 text-sm">
                              <Checkbox
                                checked={d.meshSolid}
                                onCheckedChange={(v) => set("meshSolid", Boolean(v))}
                              />
                              Solid fabric (closed back)
                            </label>
                          </div>,
                        )}
                      {visible.brim &&
                        renderMod(
                          "brim",
                          <div className="space-y-4">
                            <Field label="Brim colour">
                              <SwatchGrid
                                selected={d.brimColour}
                                onPick={(s) => set("brimColour", s)}
                              />
                            </Field>
                            <MoreOptions label="Brim finishes">
                              <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={d.sandwichBrim}
                                  onCheckedChange={(v) => set("sandwichBrim", Boolean(v))}
                                />
                                Sandwich brim trim
                              </label>
                              {d.sandwichBrim && (
                                <Field label="Sandwich colour">
                                  <SwatchGrid
                                    selected={d.sandwichColour}
                                    onPick={(s) => set("sandwichColour", s)}
                                  />
                                </Field>
                              )}
                              <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={d.rope}
                                  onCheckedChange={(v) => set("rope", Boolean(v))}
                                />
                                Rope detail along brim/crown seam
                              </label>
                              {d.rope && (
                                <Field label="Rope colour">
                                  <SwatchGrid
                                    selected={d.ropeColour}
                                    onPick={(s) => set("ropeColour", s)}
                                  />
                                </Field>
                              )}
                            </MoreOptions>
                          </div>,
                        )}
                    </div>
                  </Card>
                )}

                {visible.stripes &&
                  renderMod(
                    "stripes",
                    <Card data-guide-id="stripes" title="Stripes">
                      <StripeListEditor
                        stripes={d.stripes}
                        widths={["thin", "mid", "fat"] as const}
                        showWidths={false}
                        max={3}
                        onUpdate={(i, patch) => updateStripe(i, patch)}
                        onRemove={(i) =>
                          setD((p) => ({ ...p, stripes: p.stripes.filter((_, idx) => idx !== i) }))
                        }
                        onAdd={() =>
                          setD((p) =>
                            p.stripes.length >= 3
                              ? p
                              : {
                                  ...p,
                                  stripes: [...p.stripes, { width: "mid", colour: p.crownColour }],
                                },
                          )
                        }
                        onReorder={(from, to) =>
                          setD((p) => {
                            const next = [...p.stripes];
                            const [moved] = next.splice(from, 1);
                            next.splice(to, 0, moved);
                            return { ...p, stripes: next };
                          })
                        }
                        positionLabel={(i, len) =>
                          len <= 1 ? null : i === 0 ? "Top" : i === len - 1 ? "Bottom" : "Middle"
                        }
                        emptyLabel="No stripes — plain crown."
                        footnote="Bands wrap the mesh sides and rear, top to bottom in this order. Band thickness is fixed by the cap pattern — add or remove bands to change the look."
                      />
                    </Card>,
                  )}
              </StageSection>
            )}

            {(visible.frontLogo ||
              visible.sideLogo ||
              visible.backPatch ||
              visible.snapback ||
              visible.underbrim) && (
              <StageSection
                step={3}
                title="Branding & details"
                subtitle="Badges, logos, snapback & under-brim"
                open={openStage === 3}
                forceOpen={guideActive}
                onToggle={() => toggleStage(3)}
              >
                {(visible.frontLogo || visible.sideLogo) && (
                  <Card title="Logos">
                    <div className="space-y-6">
                      {visible.frontLogo &&
                        renderMod(
                          "frontLogo",
                          <div data-guide-id="frontLogo" className="space-y-4">
                            <div className="border-b border-border/60 pb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/60">
                              Front badge
                            </div>
                            <div className="space-y-4">
                              {/* The two decisions a good cap actually needs */}
                              <Field label="Logo">
                                <EmbroideryImageUpload
                                  label="Upload front logo artwork"
                                  value={frontLogoImg}
                                  onChange={(url) => setFrontLogoImg(url)}
                                  verboseWarnings
                                  builder="cap"
                                  assetType="front_logo"
                                />
                              </Field>

                              <label className="flex items-center gap-2 rounded-md border border-dashed border-border p-2 text-sm">
                                <Checkbox
                                  checked={frontLogoTextOn}
                                  onCheckedChange={(v) => setFrontLogoTextOn(Boolean(v))}
                                />
                                Add text
                              </label>

                              {frontLogoTextOn && (
                                <Field label="Line 1">
                                  <Input
                                    maxLength={25}
                                    value={d.frontLogoLine1}
                                    onChange={(e) => set("frontLogoLine1", e.target.value)}
                                  />
                                </Field>
                              )}

                              {/* Everything a beginner can ignore — one tuck, all defaulted */}
                              <MoreOptions label="More options">
                                <Field label="Badge type">
                                  <Select
                                    value={d.frontBadgeType}
                                    onValueChange={(v) => set("frontBadgeType", v as BadgeType)}
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="3-colour 3D embroidered">
                                        3D embroidery
                                      </SelectItem>
                                      <SelectItem value="direct embroidered">
                                        Flat embroidery
                                      </SelectItem>
                                      <SelectItem value="PVC badge">PVC badge</SelectItem>
                                      <SelectItem value="leather debossed">
                                        Debossed leather
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </Field>

                                {d.frontBadgeType === "leather debossed" && (
                                  <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
                                    <Field label="Leather & deboss">
                                      <div className="grid gap-2">
                                        {LEATHER_DUO_OPTIONS.map((opt) => {
                                          const active = d.leatherDuoId === opt.id;
                                          return (
                                            <button
                                              key={opt.id}
                                              type="button"
                                              onClick={() => set("leatherDuoId", opt.id)}
                                              className={cn(
                                                "flex items-center gap-3 rounded-md border p-2 text-left text-sm transition-all",
                                                active
                                                  ? "border-foreground ring-2 ring-foreground"
                                                  : "border-border hover:bg-muted",
                                              )}
                                            >
                                              <span className="flex -space-x-2">
                                                <span
                                                  className="h-7 w-7 rounded-full border-2 border-background"
                                                  style={{ backgroundColor: opt.leather.hex }}
                                                />
                                                <span
                                                  className="h-7 w-7 rounded-full border-2 border-background"
                                                  style={{ backgroundColor: opt.deboss.hex }}
                                                />
                                              </span>
                                              <span className="flex-1">{opt.label}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </Field>
                                    <label className="flex items-center gap-2 text-sm">
                                      <Checkbox
                                        checked={d.leatherDistressed}
                                        onCheckedChange={(v) => set("leatherDistressed", Boolean(v))}
                                      />
                                      Distressed finish
                                    </label>
                                  </div>
                                )}

                                <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/60">
                                    Thread / embroidery
                                  </div>
                                  <label className="flex items-center gap-2 text-sm font-medium">
                                    <Checkbox
                                      checked={frontLogoMatchMain}
                                      onCheckedChange={(v) => setFrontLogoMatchMain(Boolean(v))}
                                    />
                                    Match cap colours
                                  </label>
                                  {!frontLogoMatchMain && (
                                    <Field label="Thread colour">
                                      <SwatchGrid
                                        selected={d.frontLogoColour}
                                        onPick={(s) => set("frontLogoColour", s)}
                                      />
                                    </Field>
                                  )}
                                </div>

                                {frontLogoTextOn && (
                                  <>
                                    <Field label="Line 2 (optional)">
                                      <Input
                                        maxLength={25}
                                        value={d.frontLogoLine2}
                                        onChange={(e) => set("frontLogoLine2", e.target.value)}
                                      />
                                    </Field>
                                    <Field label="Font">
                                      <FontSelect
                                        value={d.frontLogoFont}
                                        onChange={(v) => set("frontLogoFont", v)}
                                        options={BACK_PATCH_FONT_OPTIONS}
                                      />
                                    </Field>
                                    <Field label="Curve">
                                      <Select
                                        value={d.frontLogoFlow}
                                        onValueChange={(v) => set("frontLogoFlow", v as BackPatchFlow)}
                                      >
                                        <SelectTrigger>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {(
                                            Object.entries(BACK_PATCH_FLOW_LABELS) as [
                                              BackPatchFlow,
                                              string,
                                            ][]
                                          ).map(([k, label]) => (
                                            <SelectItem key={k} value={k}>
                                              {label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </Field>
                                    <TextSizeSlider
                                      value={frontBadgeTextOverlay.scale}
                                      onChange={(scale) =>
                                        setFrontBadgeTextOverlay((p) => ({ ...p, scale }))
                                      }
                                    />
                                    {!frontLogoMatchMain && (
                                      <>
                                        <label className="flex items-center gap-2 text-sm">
                                          <Checkbox
                                            checked={d.frontLogoUseOutline}
                                            onCheckedChange={(v) => set("frontLogoUseOutline", Boolean(v))}
                                          />
                                          Outline
                                        </label>
                                        {d.frontLogoUseOutline && (
                                          <Field label="Outline colour">
                                            <SwatchGrid
                                              selected={d.frontLogoOutlineColour}
                                              onPick={(s) => set("frontLogoOutlineColour", s)}
                                            />
                                          </Field>
                                        )}
                                      </>
                                    )}
                                  </>
                                )}
                              </MoreOptions>
                            </div>
                          </div>,
                        )}

                      {visible.sideLogo &&
                        renderMod(
                          "sideLogo",
                          <div data-guide-id="sideLogo" className="space-y-4 border-t border-border pt-5">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/60">
                              Side logo
                            </div>
                            <label className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2 text-sm font-medium">
                              <Checkbox
                                checked={sideLogoEnabled}
                                onCheckedChange={(v) => setSideLogoEnabled(Boolean(v))}
                              />
                              Enable side logo
                            </label>

                            {sideLogoEnabled && (
                              <div className="space-y-4">
                                <Field label="Artwork (optional)">
                                  <EmbroideryImageUpload
                                    label="Upload side logo artwork"
                                    value={sideLogoImg}
                                    onChange={setSideLogoImg}
                                    verboseWarnings
                                    builder="cap"
                                    assetType="side_logo"
                                  />
                                </Field>

                                <label className="flex items-center gap-2 rounded-md border border-dashed border-border p-2 text-sm">
                                  <Checkbox
                                    checked={sideLogoTextOn}
                                    onCheckedChange={(v) => setSideLogoTextOn(Boolean(v))}
                                  />
                                  Add text
                                </label>

                                {sideLogoTextOn && (
                                  <Field label="Line 1">
                                    <Input
                                      maxLength={25}
                                      value={d.sideLogoLine1}
                                      onChange={(e) => set("sideLogoLine1", e.target.value)}
                                    />
                                  </Field>
                                )}

                                <MoreOptions label="More options">
                                  <Field label="Position">
                                    <Select
                                      value={d.sideLogoPosition}
                                      onValueChange={(v) =>
                                        set("sideLogoPosition", v as CapDesign["sideLogoPosition"])
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="front">
                                          Front (behind front-panel seam)
                                        </SelectItem>
                                        <SelectItem value="middle">
                                          Middle (over the stripe band)
                                        </SelectItem>
                                        <SelectItem value="rear">Rear (near snapback)</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </Field>

                                  {sideLogoTextOn && (
                                    <>
                                      <Field label="Line 2 (optional)">
                                        <Input
                                          maxLength={25}
                                          value={d.sideLogoLine2}
                                          onChange={(e) => set("sideLogoLine2", e.target.value)}
                                        />
                                      </Field>
                                      <Field label="Font">
                                        <FontSelect
                                          value={d.sideLogoFont}
                                          onChange={(v) => set("sideLogoFont", v)}
                                          options={BACK_PATCH_FONT_OPTIONS}
                                        />
                                      </Field>
                                      <Field label="Curve">
                                        <Select
                                          value={d.sideLogoFlow}
                                          onValueChange={(v) => set("sideLogoFlow", v as BackPatchFlow)}
                                        >
                                          <SelectTrigger>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {(
                                              Object.entries(BACK_PATCH_FLOW_LABELS) as [
                                                BackPatchFlow,
                                                string,
                                              ][]
                                            ).map(([k, label]) => (
                                              <SelectItem key={k} value={k}>
                                                {label}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </Field>
                                      <TextSizeSlider
                                        value={sideLogoTextOverlay.scale}
                                        onChange={(scale) =>
                                          setSideLogoTextOverlay((p) => ({ ...p, scale }))
                                        }
                                      />
                                    </>
                                  )}

                                  <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/60">
                                      Thread / embroidery
                                    </div>
                                    <label className="flex items-center gap-2 text-sm font-medium">
                                      <Checkbox
                                        checked={sideLogoMatchMain}
                                        onCheckedChange={(v) => setSideLogoMatchMain(Boolean(v))}
                                      />
                                      Match cap colours
                                    </label>
                                    {!sideLogoMatchMain && (
                                      <>
                                        <Field label="Thread colour">
                                          <SwatchGrid
                                            selected={d.sideLogoColour}
                                            onPick={(s) => set("sideLogoColour", s)}
                                          />
                                        </Field>
                                        {sideLogoTextOn && (
                                          <>
                                            <label className="flex items-center gap-2 text-sm">
                                              <Checkbox
                                                checked={d.sideLogoUseOutline}
                                                onCheckedChange={(v) =>
                                                  set("sideLogoUseOutline", Boolean(v))
                                                }
                                              />
                                              Outline
                                            </label>
                                            {d.sideLogoUseOutline && (
                                              <Field label="Outline colour">
                                                <SwatchGrid
                                                  selected={d.sideLogoOutlineColour}
                                                  onPick={(s) => set("sideLogoOutlineColour", s)}
                                                />
                                              </Field>
                                            )}
                                          </>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </MoreOptions>
                              </div>
                            )}
                          </div>,
                        )}
                    </div>
                  </Card>
                )}


                {visible.backPatch &&
                  renderMod(
                    "backPatch",
                    <Card data-guide-id="backPatch" title="Back patch">
                      <div className="space-y-4">
                        <Field label="Artwork (optional)">
                          <EmbroideryImageUpload
                            label="Upload back patch artwork"
                            value={backPatchImg}
                            onChange={setBackPatchImg}
                            verboseWarnings
                            builder="cap"
                            assetType="back_patch"
                          />
                        </Field>
                        {backPatchImg && (
                          <label className="flex items-center gap-2 rounded-md border border-dashed border-border p-2 text-sm">
                            <Checkbox
                              checked={backPatchTextOff}
                              onCheckedChange={(v) => setBackPatchTextOff(Boolean(v))}
                            />
                            Artwork only, no text
                          </label>
                        )}
                        {!(backPatchImg && backPatchTextOff) && (
                          <>
                            <Field label="Line 1">
                              <Input
                                maxLength={25}
                                value={d.backPatchLine1}
                                onChange={(e) => set("backPatchLine1", e.target.value)}
                              />
                            </Field>
                            <Field label="Line 2 (optional)">
                              <Input
                                maxLength={25}
                                value={d.backPatchLine2}
                                onChange={(e) => set("backPatchLine2", e.target.value)}
                              />
                            </Field>
                            <MoreOptions label="More options">
                              <Field label="Font">
                                <FontSelect
                                  value={d.backPatchFont}
                                  onChange={(v) => set("backPatchFont", v)}
                                  options={BACK_PATCH_FONT_OPTIONS}
                                />
                              </Field>
                              <Field label="Curve">
                                <Select
                                  value={d.backPatchFlow}
                                  onValueChange={(v) => set("backPatchFlow", v as BackPatchFlow)}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(
                                      Object.entries(BACK_PATCH_FLOW_LABELS) as [
                                        BackPatchFlow,
                                        string,
                                      ][]
                                    ).map(([k, label]) => (
                                      <SelectItem key={k} value={k}>
                                        {label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                              <TextSizeSlider
                                value={backPatchTextOverlay.scale}
                                onChange={(scale) =>
                                  setBackPatchTextOverlay((p) => ({ ...p, scale }))
                                }
                              />
                              <Field label="Thread colour">
                                <SwatchGrid
                                  selected={d.backPatchColour}
                                  onPick={(s) => set("backPatchColour", s)}
                                />
                              </Field>
                              <label className="flex items-center gap-2 rounded-md border border-dashed border-border p-2 text-sm">
                                <Checkbox
                                  checked={d.backPatchUseOutline}
                                  onCheckedChange={(v) => set("backPatchUseOutline", Boolean(v))}
                                />
                                Outline
                              </label>
                              {d.backPatchUseOutline && (
                                <Field label="Outline colour">
                                  <SwatchGrid
                                    selected={d.backPatchOutlineColour}
                                    onPick={(s) => set("backPatchOutlineColour", s)}
                                  />
                                </Field>
                              )}
                            </MoreOptions>
                          </>
                        )}
                      </div>
                    </Card>,
                  )}

                {visible.snapback &&
                  renderMod(
                    "snapback",
                    <Card data-guide-id="snapback" title="Snapback">
                      <div className="space-y-4">
                        <MoreOptions label="Snapback details">
                          <Field label="Strap type">
                            <Select
                              value={d.snapbackStrap}
                              onValueChange={(v) => set("snapbackStrap", v as SnapbackStrap)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="plastic">Plastic snapback</SelectItem>
                                <SelectItem value="leather">Leather strap</SelectItem>
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field label="Strap colour">
                            <SwatchGrid
                              selected={d.snapbackColour}
                              onPick={(s) => set("snapbackColour", s)}
                            />
                          </Field>
                        </MoreOptions>
                      </div>
                    </Card>,
                  )}

                {visible.underbrim &&
                  renderMod(
                    "underbrim",
                    <Card data-guide-id="underbrim" title="Under-brim print">
                      <div className="space-y-4">
                        {/* Mode selector */}
                        <div className="grid grid-cols-3 gap-2">
                          {(
                            [
                              {
                                mode: "plain",
                                label: "Plain brim",
                                desc: "Solid colour, no print",
                              },
                              {
                                mode: "upload",
                                label: "Upload artwork",
                                desc: "Position your own print",
                              },
                              {
                                mode: "logo-pattern",
                                label: "Generate from logo",
                                desc: "Tiles your logo into a pattern",
                              },
                            ] as { mode: UnderBrimMode; label: string; desc: string }[]
                          ).map(({ mode, label, desc }) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => {
                                setUnderBrimMode(mode);
                                if (mode === "plain") {
                                  setUnderBrimImg(null);
                                  setUnderBrimRaw(null);
                                  setUnderBrimSublimationLogo(null);
                                } else if (mode === "upload") {
                                  setUnderBrimSublimationLogo(null);
                                } else if (mode === "logo-pattern") {
                                  setUnderBrimImg(null);
                                  setUnderBrimRaw(null);
                                }
                              }}
                              className={cn(
                                "rounded-md border p-2 text-left text-xs transition-all",
                                underBrimMode === mode
                                  ? "border-foreground ring-2 ring-foreground"
                                  : "border-border hover:bg-muted",
                              )}
                            >
                              <div className="font-medium">{label}</div>
                              <div className="mt-0.5 text-[10px] text-muted-foreground">{desc}</div>
                            </button>
                          ))}
                        </div>

                        {/* Plain mode */}
                        {underBrimMode === "plain" && (
                          <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-[12px] text-muted-foreground">
                            Brim underside will match your brim colour:
                            <span className="ml-2 inline-flex items-center gap-1.5">
                              <span
                                className="inline-block h-3 w-3 rounded-sm border border-border"
                                style={{ backgroundColor: d.brimColour.hex }}
                              />
                              <span className="font-medium text-foreground">
                                {d.brimColour.name}
                              </span>
                            </span>
                            . Change it in the Peak / brim section above.
                          </div>
                        )}

                        {/* Upload mode */}
                        {underBrimMode === "upload" && (
                          <div className="space-y-3">
                            {!underBrimImg && (
                              <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 p-4">
                                <svg
                                  viewBox="0 0 200 80"
                                  className="w-full max-w-[180px] opacity-30"
                                >
                                  <path
                                    d="M10,70 Q100,5 190,70 Q100,48 10,70 Z"
                                    fill="currentColor"
                                    className="text-muted-foreground"
                                  />
                                </svg>
                                <p className="text-center text-[11px] text-muted-foreground">
                                  Your artwork will be cropped to this brim shape
                                </p>
                              </div>
                            )}
                            <ImageUpload
                              label="Upload under-brim print"
                              value={underBrimImg}
                              onChange={(url) => {
                                if (url) setUnderBrimRaw(url);
                                else setUnderBrimImg(null);
                              }}
                              maxSizeMB={12}
                              verboseWarnings
                              builder="cap"
                              assetType="underbrim"
                            />
                            {underBrimImg && (
                              <button
                                type="button"
                                onClick={() => setUnderBrimRaw(underBrimImg)}
                                className="text-[11px] text-muted-foreground underline hover:text-foreground"
                              >
                                Re-crop / reposition
                              </button>
                            )}
                            <p className="text-[11px] text-muted-foreground">
                              PNG or JPG, 1000px or wider recommended. We'll crop it to the brim
                              shape.
                            </p>
                          </div>
                        )}

                        {/* Logo pattern mode */}
                        {underBrimMode === "logo-pattern" && (
                          <div className="space-y-2">
                            <ImageUpload
                              label="Upload logo to build pattern from"
                              value={underBrimSublimationLogo}
                              onChange={setUnderBrimSublimationLogo}
                              maxSizeMB={12}
                              verboseWarnings
                              builder="cap"
                              assetType="underbrim_tile"
                            />
                            <p className="text-[11px] text-muted-foreground">
                              Your logo will be tiled into a sublimation pattern across the brim
                              underside. PNG with transparency works best.
                            </p>
                          </div>
                        )}

                        {/* Sweatband tape — always shown, separated */}
                        <hr className="border-border" />
                        <Field label="Under-brim colour">
                          <SwatchGrid
                            selected={d.underBrimColour}
                            onPick={(s) => set("underBrimColour", s)}
                          />
                        </Field>
                        <Field label="Inner sweatband tape colour">
                          <SwatchGrid
                            selected={d.sweatbandColour}
                            onPick={(s) => set("sweatbandColour", s)}
                          />
                        </Field>
                      </div>
                    </Card>,
                  )}
              </StageSection>
            )}
          </section>

          <section className="preview-enter preview-col">
            <div className="rounded-xl border border-border bg-card p-4">
              {
                <div className="mb-3 rounded-lg border border-border bg-muted/40 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Colour layout template
                    </span>
                    <span className="text-[10px] text-muted-foreground">Colour preview</span>
                  </div>
                  <CapTemplateStage
                    view={d.view}
                    design={effectiveDesign}
                    colors={templateColors}
                    options={templateOptions}
                    className="mx-auto w-full max-w-[420px] rounded-lg bg-zinc-600"
                    overlays={[
                      ...(d.view === "front-3q" && frontLogoEnabled && frontLogoImg
                        ? [
                            {
                              id: "frontLogo",
                              label: "Front logo",
                              url: frontLogoImg,
                              state: frontLogoOverlay,
                              onChange: setFrontLogoOverlay,
                            },
                          ]
                        : []),
                      ...(d.view === "front-3q" && crownPrint && d.crownStyle === "sublimation"
                        ? [
                            {
                              id: "crownPrint",
                              label: "Crown print",
                              url: crownPrint,
                              state: crownPrintOverlay,
                              onChange: setCrownPrintOverlay,
                            },
                          ]
                        : []),
                      ...(d.view === "front-3q" && sideLogoEnabled && sideLogoImg
                        ? [
                            {
                              id: "sideLogo",
                              label: "Side logo",
                              url: sideLogoImg,
                              state: sideLogoOverlay,
                              onChange: setSideLogoOverlay,
                            },
                          ]
                        : []),
                      ...(d.view === "back-3q" && backPatchImg
                        ? [
                            {
                              id: "backLogo",
                              label: "Rear logo",
                              url: backPatchImg,
                              state: backLogoOverlay,
                              onChange: setBackLogoOverlay,
                            },
                          ]
                        : []),
                      ...(d.view === "underside" &&
                      (underBrimMode === "upload" || underBrimMode === "logo-pattern") &&
                      (underBrimImg || underBrimSublimationLogo)
                        ? [
                            {
                              id: "underBrim",
                              label: "Under-brim artwork",
                              url: (underBrimImg || underBrimSublimationLogo)!,
                              state: underBrimOverlay,
                              onChange: setUnderBrimOverlay,
                            },
                          ]
                        : []),
                    ]}
                    textOverlays={[
                      ...(d.view === "front-3q" && frontLogoTextProps
                        ? [
                            {
                              id: "frontLogoText",
                              label: "Front badge text",
                              props: frontLogoTextProps,
                              state: frontBadgeTextOverlay,
                              onChange: setFrontBadgeTextOverlay,
                            },
                          ]
                        : []),
                      ...(d.view === "front-3q" && sideLogoEnabled && sideLogoTextProps
                        ? [
                            {
                              id: "sideLogoTextFront",
                              label: "Side logo text",
                              props: sideLogoTextProps,
                              state: sideLogoTextOverlay,
                              onChange: setSideLogoTextOverlay,
                            },
                          ]
                        : []),
                      ...(d.view === "back-3q" && backPatchTextProps
                        ? [
                            {
                              id: "backPatchText",
                              label: "Back patch text",
                              props: backPatchTextProps,
                              state: backPatchTextOverlay,
                              onChange: setBackPatchTextOverlay,
                            },
                          ]
                        : []),
                      ...(d.view === "back-3q" && sideLogoEnabled && sideLogoTextProps
                        ? [
                            {
                              id: "sideLogoTextBack",
                              label: "Side logo text",
                              props: sideLogoTextProps,
                              state: sideLogoTextOverlay,
                              onChange: setSideLogoTextOverlay,
                            },
                          ]
                        : []),
                    ]}
                  />
                  {((d.view === "front-3q" &&
                    ((frontLogoEnabled && frontLogoImg) ||
                      (crownPrint && d.crownStyle === "sublimation") ||
                      (sideLogoEnabled && sideLogoImg))) ||
                    (d.view === "back-3q" && backPatchImg) ||
                    (d.view === "underside" &&
                      (underBrimMode === "upload" || underBrimMode === "logo-pattern") &&
                      (underBrimImg || underBrimSublimationLogo))) && (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Drag to position. Corner handle to resize, top handle to rotate.
                    </p>
                  )}
                </div>
              }
              <div
                className={
                  loading || imageUrl
                    ? "aspect-square w-full overflow-hidden rounded-lg bg-muted"
                    : "h-32 w-full overflow-hidden rounded-lg border border-dashed border-border bg-muted/40"
                }
                onContextMenu={(e) => e.preventDefault()}
              >
                {loading ? (
                  <GeneratingSkeleton />
                ) : imageUrl ? (
                  <div style={{ position: "relative" }}>
                    <img
                      src={imageUrl}
                      alt="Generated cap"
                      className="no-save-img h-full w-full object-contain"
                      draggable={false}
                      onContextMenu={(e) => e.preventDefault()}
                      onDragStart={(e) => e.preventDefault()}
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 1,
                        cursor: "default",
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center text-muted-foreground">
                    <ImageIcon className="h-6 w-6" />
                    <span className="text-xs">
                      Your{" "}
                      {d.view === "front-3q"
                        ? "front 3/4"
                        : d.view === "back-3q"
                          ? "back 3/4"
                          : "underside"}{" "}
                      preview render appears here — hit{" "}
                      <span className="font-medium text-foreground">Generate</span> below
                    </span>
                  </div>
                )}
              </div>

              {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

              {(() => {
                const same = lastKey === livePrompt;
                const locked = same && iters >= 2;
                const budget = genCount >= GEN_BUDGET;
                const stage = budget || locked ? "red" : same && iters >= 1 ? "orange" : "green";
                const colourCls =
                  stage === "red"
                    ? "bg-red-600 hover:bg-red-600 text-white"
                    : stage === "orange"
                      ? "bg-orange-500 hover:bg-orange-500 text-white"
                      : "bg-green-600 hover:bg-green-600 text-white";
                const label = budget
                  ? "Limit reached"
                  : locked
                    ? "Vary your design to continue"
                    : loading
                      ? "Generating…"
                      : same && iters >= 1
                        ? `Generate again (${iters}/2)`
                        : `Generate (${genCount}/${GEN_BUDGET})`;
                return (
                  <>
                    <div className="generate-row">
                      <Button
                        className={cn(
                          "w-full transition-colors",
                          colourCls,
                          generatePulse && "generate-pulse",
                        )}
                        size="lg"
                        onClick={generate}
                        disabled={loading || locked || budget}
                      >
                        {loading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {label}
                          </>
                        ) : (
                          label
                        )}
                      </Button>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {VERSIONS_PER_GEN === 1
                          ? "Each generation produces 1 render."
                          : `Each generation produces ${VERSIONS_PER_GEN} versions.`}
                      </p>
                    </div>
                    {adminBase && (
                      <div className="mt-3 rounded-md border border-blue-500/40 bg-blue-500/10 p-3 text-xs">
                        <div className="flex items-start gap-2">
                          <ImageIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                          <div>
                            <p className="font-semibold">Recreating approved design</p>
                            <p className="mt-1 text-muted-foreground">
                              Generations will match this exact design. Change the camera view above
                              to render other angles, or generate all views at once.
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={generateAllViews}
                            disabled={loading || genCount + 3 > GEN_BUDGET}
                          >
                            Generate all 3 views
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
                  </>
                );
              })()}
            </div>

            {history.length > 0 && !guideActive && (
              <div className="mt-4 rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Your designs · pick up to {MAX_SELECT}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {selectedIds.length}/{MAX_SELECT}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {history.map((h) => {
                    const isSel = selectedIds.includes(h.id);
                    const order = selectedIds.indexOf(h.id);
                    return (
                      <div
                        key={h.id}
                        className={cn(
                          "group relative overflow-hidden rounded-md border transition-all",
                          isSel ? "border-primary ring-2 ring-primary" : "border-border",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setImageUrl(h.full);
                            toggleSelect(h.id);
                          }}
                          onContextMenu={(e) => e.preventDefault()}
                          className="block aspect-square w-full"
                        >
                          <img
                            src={h.thumb}
                            alt={`iteration ${h.n}`}
                            className="no-save-img h-full w-full object-cover"
                            draggable={false}
                            onContextMenu={(e) => e.preventDefault()}
                            onDragStart={(e) => e.preventDefault()}
                          />
                          <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            #{h.n}
                          </span>
                          <span className="absolute left-1 bottom-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium text-white">
                            {h.view === "front-3q"
                              ? "FRONT"
                              : h.view === "back-3q"
                                ? "BACK"
                                : "UNDER"}
                          </span>
                          {isSel && (
                            <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                              {order + 1}
                            </span>
                          )}
                        </button>
                        <div className="flex border-t border-border">
                          <button
                            type="button"
                            onClick={() => restoreSettings(h)}
                            disabled={loading}
                            className="flex flex-1 items-center justify-center gap-1 border-x border-border py-1.5 text-[11px] hover:bg-muted disabled:opacity-50"
                            title="Restore this design's settings"
                          >
                            <RefreshCw className="h-3 w-3" /> Restore
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteHistoryItem(h.id)}
                            className="flex flex-1 items-center justify-center gap-1 py-1.5 text-[11px] text-destructive hover:bg-destructive/10"
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Sizing, deadlines, anything specific about these designs."
                    rows={4}
                  />
                  {history.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[11px] text-muted-foreground">
                        Tag notes to specific images (up to {NOTE_MAX_IMAGES}) —{" "}
                        {noteImageNumbers.length}/{NOTE_MAX_IMAGES}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {history.map((h) => {
                          const on = noteImageNumbers.includes(h.n);
                          const disabled = !on && noteImageNumbers.length >= NOTE_MAX_IMAGES;
                          return (
                            <button
                              key={h.id}
                              type="button"
                              onClick={() => toggleNoteImage(h.n)}
                              disabled={disabled}
                              className={cn(
                                "rounded border px-2 py-0.5 text-[11px] transition-colors",
                                on
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-card hover:bg-muted",
                                disabled && "opacity-40",
                              )}
                            >
                              #{h.n}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  className="mt-3 w-full"
                  variant="secondary"
                  onClick={() => {
                    submitSelection();
                    setNotes("");
                    setNoteImageNumbers([]);
                  }}
                  disabled={selectedIds.length === 0}
                >
                  {submitted ? "Sent ✓" : `Send ${selectedIds.length} designs`}
                </Button>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Your designs will be sent to us as a brief.
                </p>
              </div>
            )}
          </section>
        </main>
      </div>

      <TourOverlay
        active={guideActive}
        step={guide.currentStep}
        stepIndex={visibleStepIndex}
        totalSteps={visibleSteps.length}
        onNext={handleGuideNext}
        onBack={guide.goBack}
        onSkip={guide.dismissForever}
        onApply={handleAccept}
        selectedOptionKey={guideSelectedOption}
      />
    </div>
  );
}
