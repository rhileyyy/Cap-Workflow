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

// ── Placement + Optical Scaling System ─────────────────────────────

const PLACEMENTS = {
  FRONT: {
    min: 0.38,
    max: 0.46,
  },

  LEFT: {
    // Horizontal: measured from the REAR seam. ~38% = forward-biased (closer to brim seam).
    position: 0.38,
    scale: [0.22, 0.28],
    vertical: {
      overlap: [0.50, 0.65], // % of logo height that overlaps the stripe band
    },
  },

  RIGHT: {
    // Horizontal: measured from the FRONT seam. ~55% = rear-biased (well clear of front seam).
    position: 0.55,
    scale: [0.28, 0.38],
    vertical: {
      overlap: [0.35, 0.45],
    },
  },

  REAR: {
    scale: [0.18, 0.22],
  },
};

// ── Logo Type Detection ───────────────────────────────────────────

function getLogoType(name = '') {
  const n = name.toLowerCase();
  if (n.includes('script') || n.includes('boogie') || n.includes('hand')) return 'script';
  if (n.includes('badge') || n.includes('round') || n.includes('crest')) return 'badge';
  if (n.length <= 3) return 'compact';
  return 'standard';
}

// ── Optical Scaling (visual weight balancing) ─────────────────────

function getOpticalScale([min, max], type) {
  switch (type) {
    case 'script':  return [min + 0.04, max + 0.04]; // thin logos need a size boost
    case 'compact': return [min - 0.02, max - 0.02]; // prevent heavy look
    case 'badge':   return [min - 0.02, max - 0.02];
    default:        return [min, max];
  }
}

// ── Vertical Offset Adjustment ────────────────────────────────────
// Returns a descriptive nudge word for the prompt.

function getVerticalBias(type) {
  switch (type) {
    case 'script':  return 'centred slightly above the stripe band midpoint';
    case 'compact': return 'centred with a slight downward bias toward the stripe band';
    case 'badge':   return 'centred with a slight downward bias toward the stripe band';
    default:        return 'centred with a slight downward bias toward the stripe band';
  }
}

// ============================================================================
// SHARED CONSTANTS
// ============================================================================

// Colour-only changes: cap fabric parts only — NEVER touch logo colours.
const LOGO_COLOUR_LOCKDOWN =
  'CRITICAL: Reproduce every logo EXACTLY as provided — same shapes, same colours, same text, same proportions. ' +
  'Do NOT alter, recolour, simplify, or substitute any element of any logo. ' +
  'Only the cap fabric (front panel, mesh, brim, stripes) changes colour — logos never change colour.';

// Embroidery rendering (no scale guidance — scale numbers are given per-logo below).
const EMBROIDERY_RULES =
  'All logos are rendered as 3D high-detail puff embroidery raised above the cap surface. ' +
  'Individual thread stitches clearly visible. Each embroidered element casts a distinct shadow onto the fabric beneath it.';

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
    'Side embroidery sits on top of stripes (foreground over background). ' +
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
    'Side embroidery sits on top of stripes (foreground over background). ' +
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

// ── Build the right-side logo instruction ────────────────────────────────
function buildRightLogoInstruction(imgNum, logoName) {
  const type = getLogoType(logoName);
  const [min, max] = getOpticalScale(PLACEMENTS.RIGHT.scale, type);
  const v = PLACEMENTS.RIGHT.vertical;
  const bias = getVerticalBias(type);

  return (
    `Image ${imgNum} is the RIGHT SIDE DESIGN. ` +
    `Reproduce it EXACTLY — same shapes, same colours, same text, same proportions. ` +
    `Place it on the right mesh panel: ` +
    `centre the logo horizontally at ~${Math.round(PLACEMENTS.RIGHT.position * 100)}% of the mesh panel width measured from the front seam ` +
    `(i.e. rear-biased, well clear of the front seam and rear seam). ` +
    `Vertically: ${bias}. ` +
    `The lower ${Math.round(v.overlap[0]*100)}–${Math.round(v.overlap[1]*100)}% of the logo height should overlap the stripe band. ` +
    `Scale: ~${Math.round(min*100)}–${Math.round(max*100)}% of the mesh panel width. ` +
    `Do not touch any seam edge. ` +
    `Raised 3D puff embroidery with clearly visible thread stitches casting a shadow on the mesh and stripes beneath.`
  );
}

// ── Build the left-side logo instruction ────────────────────────────────
function buildLeftLogoInstruction(imgNum, logoName) {
  const type = getLogoType(logoName);
  const [min, max] = getOpticalScale(PLACEMENTS.LEFT.scale, type);
  const v = PLACEMENTS.LEFT.vertical;
  const bias = getVerticalBias(type);

  return (
    `Image ${imgNum} is the LEFT SIDE DESIGN. ` +
    `Reproduce it EXACTLY — same shapes, same colours, same text, same proportions. ` +
    `Place it on the left mesh panel: ` +
    `centre the logo horizontally at ~${Math.round(PLACEMENTS.LEFT.position * 100)}% of the mesh panel width measured from the rear seam ` +
    `(i.e. forward-biased, closer to the brim seam than the rear seam). ` +
    `Vertically: ${bias}. ` +
    `The lower ${Math.round(v.overlap[0]*100)}–${Math.round(v.overlap[1]*100)}% of the logo height should overlap the stripe band. ` +
    `Scale: ~${Math.round(min*100)}–${Math.round(max*100)}% of the mesh panel width. ` +
    `Do not touch any seam edge. ` +
    `Raised 3D puff embroidery with clearly visible thread stitches casting a shadow on the mesh and stripes beneath.`
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

  // Split stripe instruction: colour change is explicit; position is preserved from reference.
  const stripeLine = s.stripeCount === 0 ? '' : (
    `Change the stripe colour to ${describeColor(s.stripeColor)}. ` +
    `Keep every other stripe property (count, thickness, spacing, curvature, position) EXACTLY as in Image 1 — do NOT move or redraw them.`
  );

  const rightLogoLine = s.hasRight
    ? buildRightLogoInstruction(3, s.rightLogoName)
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
      `Embroider it centred above the closure, scaled SMALL (~18–22% of the front panel logo width). ` +
      `Raised 3D puff embroidery with clearly visible thread stitches casting a shadow on the fabric beneath.`
    );
    imgIndex++;
  }

  if (s.hasLeft) {
    logoLines.push(buildLeftLogoInstruction(imgIndex, s.leftLogoName));
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

  const rightInstruction = s.hasRight
    ? buildRightLogoInstruction(3, s.rightLogoName)
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
      `Scale SMALL (~18–22% of the front panel logo width). ` +
      `Raised 3D puff embroidery with clearly visible thread stitches.`
    );
    imgIndex++;
  }

  if (s.hasLeft) {
    logoLines.push(buildLeftLogoInstruction(imgIndex, s.leftLogoName));
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

// ── Logo scaling ───────────────────────────────────────────────────────────
const scaledCache = new Map();

async function fileToBase64Scaled(file, maxPx = 280) {
  const buffer   = Buffer.from(await file.arrayBuffer());
  const hash     = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const cacheKey = `scaled-${maxPx}-${hash}`;
  if (scaledCache.has(cacheKey)) {
    return { data: scaledCache.get(cacheKey), mimeType: 'image/png', hash };
  }
  try {
    const resized = await sharp(buffer)
      .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    const b64 = resized.toString('base64');
    scaledCache.set(cacheKey, b64);
    return { data: b64, mimeType: 'image/png', hash };
  } catch {
    const b64 = buffer.toString('base64');
    return { data: b64, mimeType: file.type || 'image/png', hash };
  }
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
      hasLeft:       !!leftFile  && leftFile.size  > 0,
      hasRight:      !!rightFile && rightFile.size > 0,
      hasRear:       !!rearFile  && rearFile.size  > 0,
      leftLogoName:  leftFile?.name  || '',
      rightLogoName: rightFile?.name || '',
      variationSeed: Number(formData.get('variationSeed') || 0),
    };

    if (!frontFile || frontFile.size === 0) {
      return jsonError('Missing front design.', 400);
    }

    const autoStripeCount = mode === 'auto' ? settings.variationSeed % 4 : settings.stripeCount;
    const effectiveSettings = mode === 'auto'
      ? { ...settings, stripeCount: autoStripeCount }
      : settings;

    // ── Build prompt based on view angle and mode ─────────────────────────
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

    // ── Scale logos ───────────────────────────────────────────────────────
    const frontImg = await fileToBase64Scaled(frontFile, 420);
    const logoHashes = { front: frontImg.hash };

    // Front 3/4 right view → RIGHT side logo visible
    // Rear 3/4 left view  → LEFT side + rear logos visible
    let rightImg = null, leftImg = null, rearImg = null;
    if (viewAngle === 'front' && settings.hasRight) {
      rightImg = await fileToBase64Scaled(rightFile, 280);
      logoHashes.right = rightImg.hash;
    }
    if (viewAngle === 'rear' && settings.hasLeft) {
      leftImg = await fileToBase64Scaled(leftFile, 280);
      logoHashes.left = leftImg.hash;
    }
    if (viewAngle === 'rear' && settings.hasRear) {
      rearImg = await fileToBase64Scaled(rearFile, 280);
      logoHashes.rear = rearImg.hash;
    }

    // ── Result cache check ────────────────────────────────────────────────
    const cacheKey = buildCacheKey(mode, viewAngle, logoHashes, effectiveSettings);
    if (resultCache.has(cacheKey)) {
      console.log('Cache hit:', cacheKey.slice(0, 40));
      return Response.json(resultCache.get(cacheKey));
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
      // Front 3/4 right: ref cap (1), front logo (2), right logo (3 if any)
      const imageRefs = settings.hasRight
        ? 'Image 1 is the REFERENCE CAP to edit. Image 2 is the FRONT PANEL LOGO. Image 3 is the RIGHT SIDE DESIGN. '
        : 'Image 1 is the REFERENCE CAP to edit. Image 2 is the FRONT PANEL LOGO. ';
      parts.push({ text: imageRefs + prompt });
      parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
      if (rightImg) {
        parts.push({ inlineData: { mimeType: rightImg.mimeType, data: rightImg.data } });
      }
    } else {
      // Rear 3/4 left: ref cap (1), front logo as brand ref (2), rear logo (3), left logo (4)
      const logoLabels = ['Image 1 is the REFERENCE CAP to edit.'];
      let imgIdx = 2;
      logoLabels.push(`Image ${imgIdx} is the FRONT LOGO for brand colour reference ONLY — do NOT embroider it on this rear view.`);
      imgIdx++;
      if (settings.hasRear) {
        logoLabels.push(`Image ${imgIdx} is the REAR LOGO.`);
        imgIdx++;
      }
      if (settings.hasLeft) {
        logoLabels.push(`Image ${imgIdx} is the LEFT SIDE DESIGN.`);
        imgIdx++;
      }

      parts.push({ text: logoLabels.join(' ') + ' ' + prompt });
      parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
      if (rearImg) {
        parts.push({ inlineData: { mimeType: rearImg.mimeType, data: rearImg.data } });
      }
      if (leftImg) {
        parts.push({ inlineData: { mimeType: leftImg.mimeType, data: leftImg.data } });
      }
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
        hasText: !!p.text,
        hasInlineData: !!p.inlineData,
        thought: p.thought,
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
