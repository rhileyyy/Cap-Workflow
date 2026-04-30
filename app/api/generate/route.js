// ============================================================================
// app/api/generate/route.js
// Uses Google's Gemini API (gemini-3.1-flash-image-preview) directly.
// Synchronous — image returns in the same response, no polling.
//
// Two view angles supported:
//   - 'front' → front 3/4 RIGHT view (shows front panel + right side)
//   - 'rear'  → rear 3/4 LEFT view  (shows rear panel + left side)
//
// ENVIRONMENT VARIABLES (set in Vercel dashboard):
//   GOOGLE_API_KEY        — from https://aistudio.google.com/apikey
//   BLOB_READ_WRITE_TOKEN — auto-set when you connect Vercel Blob
// ============================================================================

import { GoogleGenAI } from '@google/genai';
import { put } from '@vercel/blob';
import { headers } from 'next/headers';
import { createHash } from 'crypto';
import sharp from 'sharp';

// ============================================================================
// LOGO SHAPE ANALYSIS
// Reads real pixel dimensions from the uploaded file buffer via Sharp metadata.
// Returns a scale range and plain-English shape description for the prompt.
//
// Scale is expressed as a fraction of the visible mesh panel width, calibrated
// so the embroidered logo reads at the same visual weight regardless of shape:
//
//   Very wide  (AR > 3.5) — wordmark/banner     → needs large % to be readable
//   Wide       (AR 2–3.5) — standard horizontal  → default range
//   Squarish   (AR 0.8–2) — badge/icon/stacked   → slightly smaller %
//   Tall       (AR < 0.8) — vertical/portrait     → narrower %, let height fill
//
// The base ranges are tuned for the side mesh panel (~1/3 of total cap width).
// ============================================================================

async function analyseLogoShape(buffer) {
  try {
    // Trim transparent pixels first so we measure the actual artwork, not canvas.
    const trimmed = await sharp(buffer).trim().metadata();
    const w = trimmed.width  || 1;
    const h = trimmed.height || 1;
    const ar = w / h; // aspect ratio

    let minScale, maxScale, shapeDesc, verticalBias;

    if (ar > 3.5) {
      // Very wide banner / long wordmark — needs more width to be legible
      minScale     = 0.38;
      maxScale     = 0.48;
      shapeDesc    = 'a very wide horizontal wordmark or banner';
      verticalBias = 'centred vertically across the stripe band, sitting slightly above the stripe midpoint';
    } else if (ar > 2.0) {
      // Standard wide logo / horizontal text+icon
      minScale     = 0.30;
      maxScale     = 0.40;
      shapeDesc    = 'a wide horizontal logo';
      verticalBias = 'centred with a slight downward bias so the lower portion overlaps the stripe band';
    } else if (ar > 1.2) {
      // Mildly wide — landscape badge or compact wordmark
      minScale     = 0.26;
      maxScale     = 0.34;
      shapeDesc    = 'a landscape badge or compact horizontal logo';
      verticalBias = 'centred with a slight downward bias so the lower portion overlaps the stripe band';
    } else if (ar >= 0.8) {
      // Square or nearly square — icon, round badge, crest
      minScale     = 0.22;
      maxScale     = 0.30;
      shapeDesc    = 'a square or round badge logo';
      verticalBias = 'centred with the lower third overlapping the stripe band';
    } else {
      // Tall / portrait — vertical stacked text or narrow icon
      minScale     = 0.18;
      maxScale     = 0.26;
      shapeDesc    = 'a tall vertical logo';
      verticalBias = 'centred vertically so it spans equally above and below the stripe band';
    }

    return { minScale, maxScale, shapeDesc, verticalBias, ar, w, h };
  } catch {
    // Fallback if Sharp can't read the file — use safe middle values
    return {
      minScale:    0.26,
      maxScale:    0.34,
      shapeDesc:   'a logo',
      verticalBias: 'centred with a slight downward bias so the lower portion overlaps the stripe band',
      ar: 1, w: 0, h: 0,
    };
  }
}

// ============================================================================
// SHARED PROMPT CONSTANTS
// ============================================================================

// Colour-only changes: cap fabric parts only — NEVER touch logo colours.
const LOGO_COLOUR_LOCKDOWN =
  'CRITICAL: Reproduce every logo EXACTLY as provided — same shapes, same colours, same text, same proportions. ' +
  'Do NOT alter, recolour, simplify, or substitute any element of any logo. ' +
  'Only the cap fabric (front panel, mesh, brim, stripes) changes colour — logos never change colour.';

// Embroidery rendering — satin-stitch language gives better 3D results than
// "puff embroidery" for detailed logos. Describes physical height and shadow.
const EMBROIDERY_RULES =
  'All logos are rendered as professional satin-stitch machine embroidery: ' +
  'smooth parallel thread fills within each colour section, raised above the fabric on a firm stabiliser backing, ' +
  'sitting proud of the surface like a solid sewn patch. ' +
  'The raised edge of the embroidery casts a hard-edged shadow onto the fabric directly beneath it. ' +
  'Individual stitches and thread texture are clearly visible at the edges of each filled section.';

// ============================================================================
// PROMPT TEMPLATES
// ============================================================================

const PROMPT_FRONT = {
  subject:
    'Edit Image 1, which is a photograph of a blank grey trucker cap shown from a front 3/4 right angle. ' +
    'Keep the cap shape, construction, angle, lighting, mesh texture, brim shape, and stripe placement EXACTLY as they are in Image 1. ' +
    'Do NOT reimagine or redraw the cap. Only make the colour and embroidery changes described below.',

  construction:
    'Preserve from Image 1 exactly: the high crown shape, single-piece structured front panel, mesh rear panels, ' +
    'brim curve, squatchee button, snapback closure, and the stripe count and placement. ' +
    'Do not add or remove stripes. Do not change the brim shape. No topstitching on the brim.',

  logoLockdown:
    'Image 2 is the front logo. Use this image ONLY for the front panel — do NOT reuse it anywhere else on the cap. ' +
    'Embroider it centred on the front panel with even margins and clear spacing from all seams. ' +
    'Scale to approximately 40–46% of the front panel width.',

  avoid:
    'Do not change the cap shape or construction. Do NOT add parts. Do NOT repeat any logo on multiple positions. ' +
    'Preserve the EXACT stripe count, thickness, spacing, curvature, and position from Image 1 — only the stripe colour changes. ' +
    'Stripes exist ONLY on the side mesh panels and must NOT appear on the brim. ' +
    'Side embroidery sits in the foreground on top of stripes — stripes remain visible beneath it. ' +
    'Do not add topstitching to the brim. Do not change the mesh. Do not add a model or person. Do not change the background colour.',
};

const PROMPT_REAR = {
  subject:
    'Edit Image 1, which is a photograph of a blank grey trucker cap shown from a rear 3/4 left angle ' +
    '(looking at the back of the cap from the left side). ' +
    'Keep the EXACT same camera angle, perspective, and composition as Image 1 — do NOT rotate the cap or change the viewing angle. ' +
    'Keep the cap shape, construction, lighting, mesh texture, brim shape, snapback closure, and stripe placement EXACTLY as they are in Image 1. ' +
    'Do NOT reimagine or redraw the cap. Only make the colour and embroidery changes described below.',

  construction:
    'Preserve from Image 1 exactly: the mesh panels, snapback closure, brim curve from behind, squatchee button, and any stripe positions. ' +
    'Do not add or remove stripes. Do not change the brim shape. No topstitching on the brim. Do NOT rotate the cap to show the front panel.',

  avoid:
    'Do not change the cap shape or construction. Do NOT add parts. Do NOT repeat any logo on multiple positions. ' +
    'Do not change the camera angle or rotate the cap. ' +
    'Preserve the EXACT stripe count, thickness, spacing, curvature, and position from Image 1 — only the stripe colour changes. ' +
    'Stripes exist ONLY on the side mesh panels and must NOT appear on the brim. ' +
    'Side embroidery sits in the foreground on top of stripes — stripes remain visible beneath it. ' +
    'Do not add topstitching to the brim. Do not change the mesh. Do not add a model or person. Do not change the background colour. ' +
    'Do NOT place any embroidery on the right side of the cap — it is not visible from this rear 3/4 left angle.',
};

// ── Colour description helper ─────────────────────────────────────────────
function describeColor(hex) {
  if (!hex || hex.length < 4) return hex;
  const h = hex.replace('#', '').toLowerCase();
  let r, g, b;
  if (h.length === 3) { r = parseInt(h[0]+h[0],16); g = parseInt(h[1]+h[1],16); b = parseInt(h[2]+h[2],16); }
  else { r = parseInt(h.slice(0,2),16); g = parseInt(h.slice(2,4),16); b = parseInt(h.slice(4,6),16); }
  const brightness = (r*299+g*587+b*114)/1000;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  const saturation = max === 0 ? 0 : (max-min)/max;
  if (brightness > 230) return `white (${hex})`;
  if (brightness < 30)  return `black (${hex})`;
  if (brightness > 180 && saturation < 0.1) return `light grey (${hex})`;
  if (brightness > 120 && saturation < 0.1) return `grey (${hex})`;
  if (brightness > 60  && saturation < 0.1) return `dark grey (${hex})`;
  if (brightness < 60  && saturation < 0.15) return `near black (${hex})`;
  if (saturation < 0.15) return `grey (${hex})`;
  const hue = Math.round(Math.atan2(Math.sqrt(3)*(g-b), 2*r-g-b)*180/Math.PI);
  const h360 = (hue+360)%360;
  if (h360 < 15  || h360 >= 345) return brightness < 100 ? `dark red (${hex})`    : `red (${hex})`;
  if (h360 < 45)                  return brightness < 100 ? `dark orange (${hex})` : `orange (${hex})`;
  if (h360 < 70)                  return brightness < 120 ? `dark yellow (${hex})` : `yellow (${hex})`;
  if (h360 < 150)                 return brightness < 100 ? `dark green (${hex})`  : `green (${hex})`;
  if (h360 < 195)                 return brightness < 100 ? `dark teal (${hex})`   : `teal (${hex})`;
  if (h360 < 255)                 return brightness < 100 ? `navy blue (${hex})`   : `blue (${hex})`;
  if (h360 < 290)                 return brightness < 100 ? `dark purple (${hex})` : `purple (${hex})`;
  if (h360 < 345)                 return brightness < 100 ? `dark pink (${hex})`   : `pink (${hex})`;
  return hex;
}

// ── Build right-side logo instruction from measured shape data ───────────
// RIGHT side is visible in the FRONT 3/4 view.
// Landmark-relative positioning: Gemini's spatial reasoning handles physical
// descriptions ("midpoint of the visible mesh panel") much better than
// abstract percentage numbers.
function buildRightLogoInstruction(imgNum, shape) {
  const minPct = Math.round(shape.minScale * 100);
  const maxPct = Math.round(shape.maxScale * 100);

  return (
    `Image ${imgNum} is the RIGHT SIDE DESIGN — ${shape.shapeDesc}. ` +
    `Reproduce it EXACTLY — same shapes, same colours, same text, same proportions. ` +
    `Placement on the right mesh panel: ` +
    `centre the logo horizontally at the midpoint of the visible right mesh panel, ` +
    `well clear of both the front panel seam and the rear mesh seam. ` +
    `Vertically: ${shape.verticalBias}. ` +
    `Scale: ~${minPct}–${maxPct}% of the mesh panel width — it is ${shape.shapeDesc}, ` +
    `so adjust within this range so it reads clearly without crowding any seam edge. ` +
    `The embroidery sits proud of the mesh surface like a solid raised patch in the foreground; ` +
    `stripes are visible behind and beneath it. ` +
    `Satin-stitch thread fills, hard-edged shadow at the base of the raised patch.`
  );
}

// ── Build left-side logo instruction from measured shape data ────────────
// LEFT side is visible in the REAR 3/4 view.
// Positioned in the forward half of the mesh panel (closer to brim seam).
function buildLeftLogoInstruction(imgNum, shape) {
  const minPct = Math.round(shape.minScale * 100);
  const maxPct = Math.round(shape.maxScale * 100);

  return (
    `Image ${imgNum} is the LEFT SIDE DESIGN — ${shape.shapeDesc}. ` +
    `Reproduce it EXACTLY — same shapes, same colours, same text, same proportions. ` +
    `Placement on the left mesh panel: ` +
    `centre the logo horizontally in the forward half of the mesh panel, ` +
    `biased toward the brim-side seam and well clear of the rear mesh seam. ` +
    `Vertically: ${shape.verticalBias}. ` +
    `Scale: ~${minPct}–${maxPct}% of the mesh panel width — it is ${shape.shapeDesc}, ` +
    `so adjust within this range so it reads clearly without crowding any seam edge. ` +
    `The embroidery sits proud of the mesh surface like a solid raised patch in the foreground; ` +
    `stripes are visible behind and beneath it. ` +
    `Satin-stitch thread fills, hard-edged shadow at the base of the raised patch.`
  );
}

// ── FRONT VIEW — Product prompt (Choose Colours) ─────────────────────────
function buildFrontProductPrompt(s) {
  const P = PROMPT_FRONT;
  const front = describeColor(s.colors.front);
  const mesh  = describeColor(s.colors.mesh);
  const brim  = describeColor(s.colors.brim);

  const colourLine =
    `Change the cap fabric colours only: front panel → ${front}, mesh → ${mesh}, brim → ${brim}.` +
    (s.sandwichBrim
      ? ` Add a sandwich brim — a contrasting ${describeColor(s.sandwichColor)} layer visible along the underside edge of the brim.`
      : '');

  const stripeLine = s.stripeCount === 0 ? '' : (
    `Change the stripe colour to ${describeColor(s.stripeColor)}. ` +
    `Keep every other stripe property (count, thickness, spacing, curvature, position) EXACTLY as in Image 1 — do NOT move or redraw them.`
  );

  const rightLogoLine = s.hasRight && s.rightShape
    ? buildRightLogoInstruction(3, s.rightShape)
    : '';

  return [
    P.subject,
    P.construction,
    colourLine,
    stripeLine,
    LOGO_COLOUR_LOCKDOWN,
    EMBROIDERY_RULES,
    P.logoLockdown,
    rightLogoLine,
    P.avoid,
  ].filter(Boolean).join(' ');
}

// ── REAR VIEW — Product prompt (Choose Colours) ──────────────────────────
function buildRearProductPrompt(s) {
  const P = PROMPT_REAR;
  const front = describeColor(s.colors.front);
  const mesh  = describeColor(s.colors.mesh);
  const brim  = describeColor(s.colors.brim);

  const colourLine =
    `Change the cap fabric colours only: front panel → ${front}, mesh → ${mesh}, brim → ${brim}.` +
    (s.sandwichBrim
      ? ` Add a sandwich brim — a contrasting ${describeColor(s.sandwichColor)} layer visible along the underside edge of the brim.`
      : '');

  const stripeLine = s.stripeCount === 0 ? '' : (
    `Change the stripe colour to ${describeColor(s.stripeColor)}. ` +
    `Keep every other stripe property (count, thickness, spacing, curvature, position) EXACTLY as in Image 1 — do NOT move or redraw them.`
  );

  const logoLines = [];
  let imgIndex = 2;

  if (s.hasRear) {
    logoLines.push(
      `Image ${imgIndex} is the REAR LOGO. Use this image ONLY for the rear centre of the cap above the snapback closure — do NOT reuse it elsewhere. ` +
      `Embroider it centred above the closure. Scale it SMALL so it reads as a compact accent badge — ` +
      `approximately 18–22% of the visible rear panel width. ` +
      `Satin-stitch embroidery, raised on a firm backing, hard-edged shadow at the base.`
    );
    imgIndex++;
  }

  if (s.hasLeft && s.leftShape) {
    logoLines.push(buildLeftLogoInstruction(imgIndex, s.leftShape));
    imgIndex++;
  }

  logoLines.push(
    'IMPORTANT: Only place embroidery on parts of the cap visible in Image 1. ' +
    'Do NOT invent a different camera angle. The output must match Image 1\'s exact viewing angle.'
  );

  return [
    P.subject,
    P.construction,
    colourLine,
    stripeLine,
    LOGO_COLOUR_LOCKDOWN,
    EMBROIDERY_RULES,
    ...logoLines,
    P.avoid,
  ].filter(Boolean).join(' ');
}

// ── FRONT VIEW — Auto prompt (Surprise Me) ────────────────────────────────
function buildFrontAutoPrompt(s) {
  const directions = [
    'Choose a bold dark cap with high contrast elements.',
    'Choose a lighter neutral-toned cap with subtle complementary accents.',
    'Choose a vibrant colour that echoes a dominant colour from the logo.',
    'Choose a classic two-tone — contrasting front and mesh colours.',
    'Choose an understated monochrome with a single accent colour on the stripes.',
    'Choose a warm earthy palette that complements the logo.',
    'Choose a cool-toned palette — navy, slate, or grey family.',
    'Be bold — choose an unexpected but commercially attractive colour combination.',
  ];
  const direction = directions[s.variationSeed % directions.length];

  const stripeNote = s.stripeCount > 0
    ? `The reference cap already has ${s.stripeCount} stripe${s.stripeCount > 1 ? 's' : ''} — keep them exactly where they are and choose a complementary stripe colour.`
    : 'The reference cap has no stripes — keep it that way.';

  const rightInstruction = s.hasRight && s.rightShape
    ? buildRightLogoInstruction(3, s.rightShape)
    : '';

  return [
    PROMPT_FRONT.subject,
    PROMPT_FRONT.construction,
    `Analyse the logo in Image 2. Based on its colours, style, and brand aesthetic, choose the ideal cap fabric colours: front panel, mesh, and brim. ${direction} ${stripeNote} Decide whether a sandwich brim would complement the look. Make choices a professional cap designer would make.`,
    LOGO_COLOUR_LOCKDOWN,
    EMBROIDERY_RULES,
    'Image 2 is the front logo. Embroider it centred on the front panel EXACTLY as provided — same shapes, same colours, same text, same proportions. Scale to approximately 40–46% of the front panel width, with clear breathing room from all seams. Do NOT redraw, simplify, or substitute any part.',
    rightInstruction,
    PROMPT_FRONT.avoid,
  ].filter(Boolean).join(' ');
}

// ── REAR VIEW — Auto prompt (Surprise Me) ─────────────────────────────────
function buildRearAutoPrompt(s) {
  const directions = [
    'Choose a bold dark cap with high contrast elements.',
    'Choose a lighter neutral-toned cap with subtle complementary accents.',
    'Choose a vibrant colour that echoes a dominant colour from the logo.',
    'Choose a classic two-tone — contrasting front and mesh colours.',
    'Choose an understated monochrome with a single accent colour on the stripes.',
    'Choose a warm earthy palette that complements the logo.',
    'Choose a cool-toned palette — navy, slate, or grey family.',
    'Be bold — choose an unexpected but commercially attractive colour combination.',
  ];
  const direction = directions[s.variationSeed % directions.length];

  const stripeNote = s.stripeCount > 0
    ? `The reference cap already has ${s.stripeCount} stripe${s.stripeCount > 1 ? 's' : ''} — keep them exactly where they are and choose a complementary stripe colour.`
    : 'The reference cap has no stripes — keep it that way.';

  const logoLines = [];
  let imgIndex = 2;

  if (s.hasRear) {
    logoLines.push(
      `Image ${imgIndex} is the REAR LOGO. Embroider it centred on the rear of the cap above the snapback closure. ` +
      `Scale it SMALL — approximately 18–22% of the visible rear panel width. ` +
      `Satin-stitch embroidery, raised on a firm backing, hard-edged shadow at the base.`
    );
    imgIndex++;
  }

  if (s.hasLeft && s.leftShape) {
    logoLines.push(buildLeftLogoInstruction(imgIndex, s.leftShape));
    imgIndex++;
  }

  return [
    PROMPT_REAR.subject,
    PROMPT_REAR.construction,
    `Analyse the logo in Image 2. Based on its colours, style, and brand aesthetic, choose the ideal cap fabric colours: front panel, mesh, and brim. ${direction} ${stripeNote} Make choices a professional cap designer would make.`,
    LOGO_COLOUR_LOCKDOWN,
    EMBROIDERY_RULES,
    ...logoLines,
    PROMPT_REAR.avoid,
  ].filter(Boolean).join(' ');
}


export const maxDuration = 60;

// ── In-memory rate limiter ─────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX       = 10;
const rateLimitStore       = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (rateLimitStore.get(ip) || []).filter(t => t > windowStart);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    const resetIn = Math.ceil((timestamps[0] - windowStart) / 60000);
    return { limited: true, resetIn };
  }
  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);
  return { limited: false };
}

// ── Logo processing: scale for API + shape analysis, one buffer read ──────
// Both the scaled image (for Gemini) and the shape metadata (for the prompt)
// are derived from the same buffer so the file is only read once per request.
const scaledCache = new Map();
const shapeCache  = new Map();

async function processLogoFile(file, maxPx = 280) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const hash   = createHash('sha256').update(buffer).digest('hex').slice(0, 16);

  // ── Scaled image for Gemini ──────────────────────────────────────────────
  const scaleCacheKey = `scaled-${maxPx}-${hash}`;
  let scaledData, mimeType;
  if (scaledCache.has(scaleCacheKey)) {
    scaledData = scaledCache.get(scaleCacheKey);
    mimeType   = 'image/png';
  } else {
    try {
      const resized = await sharp(buffer)
        .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      scaledData = resized.toString('base64');
      mimeType   = 'image/png';
    } catch {
      scaledData = buffer.toString('base64');
      mimeType   = file.type || 'image/png';
    }
    scaledCache.set(scaleCacheKey, scaledData);
  }

  // ── Shape analysis (cached by content hash) ──────────────────────────────
  let shape;
  if (shapeCache.has(hash)) {
    shape = shapeCache.get(hash);
  } else {
    shape = await analyseLogoShape(buffer);
    shapeCache.set(hash, shape);
    console.log(`Logo shape [${hash.slice(0,8)}]: AR=${shape.ar.toFixed(2)} → ${shape.shapeDesc} (${Math.round(shape.minScale*100)}–${Math.round(shape.maxScale*100)}%)`);
  }

  return { data: scaledData, mimeType, hash, shape };
}

// ── Result cache ───────────────────────────────────────────────────────────
const resultCache = new Map();

function buildCacheKey(mode, viewAngle, logoHashes, effectiveSettings) {
  const hashStr = Object.values(logoHashes).join(':');
  if (mode === 'auto') {
    return `auto:${viewAngle}:${hashStr}:${effectiveSettings.variationSeed}`;
  }
  const { colors, stripeCount, stripeColor, sandwichBrim, sandwichColor } = effectiveSettings;
  return [`product`, viewAngle, hashStr, colors.front, colors.mesh, colors.brim,
          stripeCount, stripeColor, sandwichBrim, sandwichColor].join(':');
}

// ── Main handler ──────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    if (!process.env.GOOGLE_API_KEY) {
      return jsonError('Preview service is not configured. Please contact support.', 500);
    }

    const headersList = await headers();
    const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim()
            || headersList.get('x-real-ip')
            || 'unknown';
    const rateCheck = checkRateLimit(ip);
    if (rateCheck.limited) {
      return jsonError(
        `You've reached the preview limit. Please try again in ${rateCheck.resetIn} minute${rateCheck.resetIn === 1 ? '' : 's'}.`,
        429
      );
    }

    const formData  = await request.formData();
    const mode      = formData.get('mode') || 'product';
    const viewAngle = formData.get('viewAngle') || 'front';
    const frontFile = formData.get('design_front');
    const leftFile  = formData.get('design_left');
    const rightFile = formData.get('design_right');
    const rearFile  = formData.get('design_rear');

    if (!frontFile || frontFile.size === 0) {
      return jsonError('Missing front design.', 400);
    }

    // ── Process all logo files (scale + shape analysis in one pass) ───────
    const frontImg   = await processLogoFile(frontFile, 420);
    const logoHashes = { front: frontImg.hash };

    // Front 3/4 right view → RIGHT side logo visible
    // Rear 3/4 left view  → LEFT side + rear logos visible
    let rightImg = null, leftImg = null, rearImg = null;
    if (viewAngle === 'front' && rightFile?.size > 0) {
      rightImg = await processLogoFile(rightFile, 280);
      logoHashes.right = rightImg.hash;
    }
    if (viewAngle === 'rear' && leftFile?.size > 0) {
      leftImg = await processLogoFile(leftFile, 280);
      logoHashes.left = leftImg.hash;
    }
    if (viewAngle === 'rear' && rearFile?.size > 0) {
      rearImg = await processLogoFile(rearFile, 280);
      logoHashes.rear = rearImg.hash;
    }

    const settings = {
      colors: {
        front: formData.get('color_front') || '#1a1a1a',
        mesh:  formData.get('color_mesh')  || '#1a1a1a',
        brim:  formData.get('color_brim')  || '#1a1a1a',
      },
      stripeCount:   Number(formData.get('stripeCount') || 0),
      stripeColor:   formData.get('stripeColor')   || '#ffffff',
      sandwichBrim:  formData.get('sandwichBrim')  === 'true',
      sandwichColor: formData.get('sandwichColor') || '#c2410c',
      hasLeft:       !!leftImg,
      hasRight:      !!rightImg,
      hasRear:       !!rearImg,
      // Shape data from real pixel analysis — drives scale % in the prompts
      rightShape:    rightImg?.shape || null,
      leftShape:     leftImg?.shape  || null,
      variationSeed: Number(formData.get('variationSeed') || 0),
    };

    const autoStripeCount = mode === 'auto' ? settings.variationSeed % 4 : settings.stripeCount;
    const effectiveSettings = mode === 'auto'
      ? { ...settings, stripeCount: autoStripeCount }
      : settings;

    // ── Result cache check ────────────────────────────────────────────────
    const cacheKey = buildCacheKey(mode, viewAngle, logoHashes, effectiveSettings);
    if (resultCache.has(cacheKey)) {
      console.log('Cache hit:', cacheKey.slice(0, 40));
      return Response.json(resultCache.get(cacheKey));
    }

    // ── Build prompt ──────────────────────────────────────────────────────
    let prompt;
    if (viewAngle === 'rear') {
      prompt = mode === 'auto'
        ? buildRearAutoPrompt(effectiveSettings)
        : buildRearProductPrompt(effectiveSettings);
    } else {
      prompt = mode === 'auto'
        ? buildFrontAutoPrompt(effectiveSettings)
        : buildFrontProductPrompt(effectiveSettings);
    }

    // ── Pick the correct reference cap photo ──────────────────────────────
    const stripeNum = effectiveSettings.stripeCount;
    const refFilename = viewAngle === 'rear'
      ? (stripeNum === 1 ? 'cap-rear-1stripe.jpg'
        : stripeNum === 2 ? 'cap-rear-2stripe.jpg'
        : stripeNum === 3 ? 'cap-rear-3stripe.jpg'
        : 'cap-rear-0stripe.jpg')
      : (stripeNum === 1 ? 'cap-1stripe.jpg'
        : stripeNum === 2 ? 'cap-2stripe.jpg'
        : stripeNum === 3 ? 'cap-3stripe.jpg'
        : 'cap-0stripe.jpg');

    const host     = headersList.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const refUrl   = `${protocol}://${host}/${refFilename}`;

    let refPart = null;
    try {
      const refResp = await fetch(refUrl);
      if (refResp.ok) {
        const refBuffer = Buffer.from(await refResp.arrayBuffer());
        refPart = { inlineData: { mimeType: 'image/jpeg', data: refBuffer.toString('base64') } };
      }
    } catch {
      console.warn('Could not fetch reference cap:', refFilename);
    }

    // ── Assemble Gemini parts ─────────────────────────────────────────────
    const parts = [];
    if (refPart) parts.push(refPart);

    if (viewAngle === 'front') {
      const imageRefs = settings.hasRight
        ? 'Image 1 is the REFERENCE CAP to edit. Image 2 is the FRONT PANEL LOGO. Image 3 is the RIGHT SIDE DESIGN. '
        : 'Image 1 is the REFERENCE CAP to edit. Image 2 is the FRONT PANEL LOGO. ';
      parts.push({ text: imageRefs + prompt });
      parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
      if (rightImg) parts.push({ inlineData: { mimeType: rightImg.mimeType, data: rightImg.data } });
    } else {
      const logoLabels = ['Image 1 is the REFERENCE CAP to edit.'];
      let imgIdx = 2;
      logoLabels.push(`Image ${imgIdx} is the FRONT LOGO for brand colour reference ONLY — do NOT embroider it on this rear view.`);
      imgIdx++;
      if (settings.hasRear) { logoLabels.push(`Image ${imgIdx} is the REAR LOGO.`);        imgIdx++; }
      if (settings.hasLeft) { logoLabels.push(`Image ${imgIdx} is the LEFT SIDE DESIGN.`); imgIdx++; }

      parts.push({ text: logoLabels.join(' ') + ' ' + prompt });
      parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
      if (rearImg) parts.push({ inlineData: { mimeType: rearImg.mimeType, data: rearImg.data } });
      if (leftImg) parts.push({ inlineData: { mimeType: leftImg.mimeType, data: leftImg.data } });
    }

    // ── Call Gemini ────────────────────────────────────────────────────────
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: '1:1',
          imageSize: '1k',
        },
      },
    });

    // ── Extract image from response ────────────────────────────────────────
    let imageBase64 = null;
    let imageMime   = 'image/png';

    const responseParts = response.candidates?.[0]?.content?.parts || [];
    for (const part of responseParts) {
      if (part.thought) continue;
      if (part.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        imageMime   = part.inlineData.mimeType || 'image/png';
        break;
      }
    }

    if (!imageBase64) {
      console.error('No image in response. Parts:', JSON.stringify(responseParts?.map(p => ({
        hasText: !!p.text, hasInlineData: !!p.inlineData, thought: p.thought,
      }))));
      return jsonError('Preview creation failed — no image returned. Please try again.', 502);
    }

    // ── Store in Vercel Blob ──────────────────────────────────────────────
    const shareId     = crypto.randomUUID();
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const ext         = imageMime.includes('jpeg') ? 'jpg' : 'png';
    let permanentImageUrl = null;

    try {
      const blobResult = await put(
        `generations/${shareId}/${viewAngle}.${ext}`,
        imageBuffer,
        { access: 'public', contentType: imageMime, addRandomSuffix: false }
      );
      permanentImageUrl = blobResult.url;

      const metadata = {
        shareId,
        imageUrl: permanentImageUrl,
        viewAngle,
        createdAt: new Date().toISOString(),
        mode,
        settings: {
          colors: settings.colors,
          stripeCount: settings.stripeCount,
          sandwichBrim: settings.sandwichBrim,
        },
      };
      await put(
        `generations/${shareId}/meta.json`,
        JSON.stringify(metadata),
        { access: 'public', contentType: 'application/json', addRandomSuffix: false }
      );
    } catch (storageErr) {
      console.error('Blob storage error (non-fatal):', storageErr);
      permanentImageUrl = `data:${imageMime};base64,${imageBase64}`;
    }

    const result = { imageUrl: permanentImageUrl, shareId };
    resultCache.set(cacheKey, result);
    return Response.json(result);
  } catch (err) {
    console.error('Generation error:', err);
    const msg = err.message || '';
    if (msg.includes('API_KEY') || msg.includes('authentication'))
      return jsonError('Preview service configuration error. Please contact support.', 500);
    if (msg.includes('SAFETY') || msg.includes('blocked'))
      return jsonError('The image was blocked by safety filters. Please try a different logo or colour combination.', 422);
    if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED'))
      return jsonError('Preview service is temporarily busy. Please try again in a moment.', 429);
    return jsonError('Something went wrong. Please try again.', 500);
  }
}

function jsonError(message, status) {
  return Response.json({ error: message }, { status });
}
