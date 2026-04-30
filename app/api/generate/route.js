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
    width: 0.40,
    min: 0.38,
    max: 0.46,
  },

LEFT: {
  anchor: 'mesh',
  position: 0.58, // pushed forward near brim
  scale: [0.22, 0.30],

  vertical: {
    overlap: [0.50, 0.65],
    baseOffset: -0.08
  }
},

  RIGHT: {
    anchor: 'front',
    position: 0.66,

    scale: [0.32, 0.42],

    vertical: {
      overlap: [0.35, 0.45],
      baseOffset: -0.03
    }
  },

  REAR: {
    scale: [0.18, 0.22], // slightly reduced as discussed
  }
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
    case 'script':
      return [min + 0.04, max + 0.04]; // thin logos need boost

    case 'compact':
      return [min - 0.02, max - 0.02]; // prevent heavy look

    case 'badge':
      return [min - 0.02, max - 0.02];

    default:
      return [min, max];
  }
}

// ── Vertical Offset Adjustment ────────────────────────────────────

function getVerticalOffset(type) {
  switch (type) {
    case 'script':
      return -0.02; // slightly higher

    case 'compact':
      return -0.08; // sits lower

    case 'badge':
      return -0.06;

    default:
      return -0.05;
  }
}

// ============================================================================
// PROMPT TEMPLATES
// ============================================================================

const PROMPT_FRONT = {
  subject: 'Edit Image 1, which is a photograph of a blank grey trucker cap shown from a front 3/4 right angle. Keep the cap shape, construction, angle, lighting, mesh texture, brim shape, and stripe placement EXACTLY as they are in Image 1. Do NOT reimagine or redraw the cap. Only make the colour and embroidery changes described below.',
  construction: 'Preserve from Image 1 exactly: the high crown shape, single-piece structured front panel, mesh rear panels, brim curve, squatchee button, snapback closure, and the stripe count and placement. Do not add or remove stripes. Do not change the brim shape. No topstitching on the brim.',
  embroidery: `All logos are rendered as 3D high detail embroidery raised above the cap surface. Black outlined embroidery on all positions. Individual thread stitches clearly visible. Each embroidered element casts a shadow onto the fabric beneath it. Adjust scale for optical balance so thin/script logos appear slightly larger and compact logos slightly smaller.`,
  logoLockdown: 'Image 2 is the front logo. Embroider it centered on the front panel exactly as provided. Scale to exactly 42% of panel width (min 38%, max 46%) with even margins and clear spacing from seams.',
  avoid: 'Do not change the cap shape or construction. Do NOT add parts. Do NOT repeat logo embroiders.Preserve the EXACT stripe count, thickness, spacing, curvature, and position from Image 1. Stripes must remain separate and fully visible. Stripes exist only on side panels and must NOT appear on the brim. Side embroidery is allowed to overlap and sit on top of the stripes. Do not add topstitching to the brim. Do not change the mesh. Do not add a model or person. Do not change the background colour.',
};

const PROMPT_REAR = {
  subject: 'Edit Image 1, which is a photograph of a blank grey trucker cap shown from a rear 3/4 left angle (looking at the back of the cap from the left side). Keep the EXACT same camera angle, perspective, and composition as Image 1 — do NOT rotate the cap or change the viewing angle. Keep the cap shape, construction, lighting, mesh texture, brim shape, snapback closure, and stripe placement EXACTLY as they are in Image 1. Do NOT reimagine or redraw the cap. Only make the colour and embroidery changes described below.',
  construction: 'Preserve from Image 1 exactly: the mesh panels, snapback closure, brim curve from behind, squatchee button, and any stripe positions. Do not add or remove stripes. Do not change the brim shape. No topstitching on the brim. Do NOT rotate the cap to show the front panel.',
  embroidery: 'All logos are rendered as 3D high detail embroidery raised above the cap surface. Black outlined embroidery on all positions. Individual thread stitches clearly visible. Each embroidered element casts a shadow onto the fabric beneath it. Adjust scale for optical balance so thin/script logos appear slightly larger and compact logos slightly smaller.',
  avoid: 'Do not change the cap shape or construction. Do NOT add parts. Do NOT repeat logo embroiders. Do not change the camera angle or rotate the cap. Stripes exist only on side panels and must NOT appear on the brim. Side embroidery is allowed to overlap and sit on top of the stripes. Do not add topstitching to the brim. Do not change the mesh. Do not add a model or person. Do not change the background colour. Do NOT place any embroidery on the right side of the cap — the right side is not visible from this rear 3/4 left angle.',
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
  if (brightness < 30) return `black (${hex})`;
  if (brightness > 180 && saturation < 0.1) return `light grey (${hex})`;
  if (brightness > 120 && saturation < 0.1) return `grey (${hex})`;
  if (brightness > 60 && saturation < 0.1) return `dark grey (${hex})`;
  if (brightness < 60 && saturation < 0.15) return `near black (${hex})`;
  if (saturation < 0.15) return `grey (${hex})`;
  const hue = Math.round(Math.atan2(Math.sqrt(3)*(g-b), 2*r-g-b)*180/Math.PI);
  const h360 = (hue+360)%360;
  if (h360 < 15 || h360 >= 345) return brightness < 100 ? `dark red (${hex})` : `red (${hex})`;
  if (h360 < 45) return brightness < 100 ? `dark orange (${hex})` : `orange (${hex})`;
  if (h360 < 70) return brightness < 120 ? `dark yellow (${hex})` : `yellow (${hex})`;
  if (h360 < 150) return brightness < 100 ? `dark green (${hex})` : `green (${hex})`;
  if (h360 < 195) return brightness < 100 ? `dark teal (${hex})` : `teal (${hex})`;
  if (h360 < 255) return brightness < 100 ? `navy blue (${hex})` : `blue (${hex})`;
  if (h360 < 290) return brightness < 100 ? `dark purple (${hex})` : `purple (${hex})`;
  if (h360 < 345) return brightness < 100 ? `dark pink (${hex})` : `pink (${hex})`;
  return hex;
}

function buildFrontProductPrompt(s) {
  const P = PROMPT_FRONT;
  const front = describeColor(s.colors.front);
  const mesh  = describeColor(s.colors.mesh);
  const brim  = describeColor(s.colors.brim);

  const colourLine = `Change the cap colours: make the front panel ${front}, the mesh ${mesh}, and the brim ${brim}.`
    + (s.sandwichBrim ? ` Add a sandwich brim — a contrasting ${describeColor(s.sandwichColor)} layer visible along the underside edge of the brim.` : '');

  const stripeLine = s.stripeCount === 0 ? ''
    : `Change the stripe colour to ${describeColor(s.stripeColor)}. Keep the stripes exactly AS IS in Image 1 — do NOT move them.`;

  const rightLogoLine = s.hasRight
    ? (() => {
        const type = getLogoType(s.rightLogoName);
        const [min, max] = getOpticalScale(PLACEMENTS.RIGHT.scale, type);

        const v = PLACEMENTS.RIGHT.vertical;

        return `Image 3 is the RIGHT SIDE DESIGN. Place it on the right mesh panel in the rear half, anchored near the front seam, center ~${Math.round(PLACEMENTS.RIGHT.position * 100)}% from the front seam (back-biased).

The lower portion of the logo must overlap the stripe band, with approximately ${Math.round(v.overlap[0]*100)}–${Math.round(v.overlap[1]*100)}% of the logo height intersecting the stripes. Vertical placement is relative to the stripe band, not the panel center, with a slight downward bias for visual balance.

Scale ~${Math.round(min*100)}–${Math.round(max*100)}% of panel width. Do not touch seams. Raised embroidery over mesh and stripes.`;
      })()
    : '';

  return [
    P.subject,
    P.construction,
    colourLine,
    stripeLine,
    P.embroidery,
    P.logoLockdown,
    rightLogoLine,
    P.avoid
  ].filter(Boolean).join(' ');
}

// ── REAR VIEW — Product prompt (Choose Colours) ──────────────────────────
// Rear 3/4 left angle — shows rear panel + LEFT side
function buildRearProductPrompt(s) {
  const P = PROMPT_REAR;
  const front = describeColor(s.colors.front);
  const mesh  = describeColor(s.colors.mesh);
  const brim  = describeColor(s.colors.brim);
  const colourLine = `Change the cap colours: make the front panel ${front}, the mesh ${mesh}, and the brim ${brim}.`
    + (s.sandwichBrim ? ` Add a sandwich brim — a contrasting ${describeColor(s.sandwichColor)} layer visible along the underside edge of the brim.` : '');
  const stripeLine = s.stripeCount === 0 ? ''
    : `Change the stripe colour to ${describeColor(s.stripeColor)}. Keep the stripes exactly where they are in Image 1 — do not move them.`;

  const logoLines = [];
  let imgIndex = 2;

  if (s.hasRear) {
    logoLines.push(`Image ${imgIndex} is the REAR LOGO. Embroider it on the centre back of the cap above the snapback closure — same shapes, same text, same proportions, same colours. The 3D embroidery should be SMALL — a small accent badge, approximately 1/4 to 1/5 the size of a front panel logo. Raised 3D high detail embroidery with visible stitches. Do NOT scale it to fill the back panel.`);
    imgIndex++;
  }
if (s.hasLeft) {
  const type = getLogoType(s.leftLogoName);
  const [min, max] = getOpticalScale(PLACEMENTS.LEFT.scale, type);

  const v = PLACEMENTS.LEFT.vertical;
  const vOffset = getVerticalOffset(type);

  logoLines.push(
    `Image ${imgIndex} is the LEFT SIDE DESIGN. Place it on the left mesh panel in the rear-lower quadrant, positioned forward toward the front seam and closer to the brim, center ~${Math.round(PLACEMENTS.LEFT.position * 100)}% from the rear seam, positioned close to the front edge of the mesh panel near the brim, positioned close to the front edge of the mesh panel near the brim.

The lower portion of the logo must overlap the stripe band, with approximately ${Math.round(v.overlap[0]*100)}–${Math.round(v.overlap[1]*100)}% of the logo height intersecting the stripes. Vertical placement is determined relative to the stripe band, not the panel center, with a slight downward bias for visual balance.

Scale ~${Math.round(min*100)}–${Math.round(max*100)}% of panel width. Do not touch seams. Raised embroidery over mesh and stripes.`
  );

  imgIndex++;
}

  logoLines.push('IMPORTANT: Only place embroidery on the parts of the cap that are visible in Image 1. Do NOT invent a different camera angle. The output must match Image 1\'s exact viewing angle.');

  return [P.subject, P.construction, colourLine, stripeLine, P.embroidery, ...logoLines, P.avoid].filter(Boolean).join(' ');
}

// ── FRONT VIEW — Auto prompt (Surprise Me) ────────────────────────────────
// Front 3/4 right angle — shows front panel + RIGHT side
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
    ? `Image 3 is the RIGHT SIDE DESIGN. Reproduce it EXACTLY on the right side mesh panel — every shape, letter, colour, and detail must match precisely. The 3D high detail embroidery is sewn OVER TOP OF any stripes — the logo sits in the foreground, stripes in the background, partially covered by the embroidery. Raised 3D embroidery with visible stitches. The side design must be embroidered SMALL — approximately 1/3 to 1/2 the size of the front panel logo. Do NOT scale it to fill the mesh panel.`
    : '';

  return [
    'Edit Image 1, which is a photograph of a blank grey trucker cap from a front 3/4 right angle. Keep the cap shape, construction, angle, lighting, mesh texture, brim shape, and stripe placement EXACTLY as they are in Image 1. Only make the colour and embroidery changes described below.',
    'Preserve from Image 1 exactly: the crown shape, front panel, mesh panels, brim curve, squatchee button, snapback closure, and any stripe positions. Do not move, add, or remove stripes. No topstitching on the brim.',
    `Analyse the logo in Image 2. Based on its colours, style, and brand aesthetic, choose the ideal cap colours: front panel, mesh, and brim. ${direction} ${stripeNote} Decide whether a sandwich brim would complement the look. Make choices a professional cap designer would make.`,
    'All logos rendered as 3D high detail embroidery raised above the cap surface. Black outlined embroidery on all positions. Individual thread stitches clearly visible.',
    'Image 2 is the front logo. Embroider it on the centre of the front panel EXACTLY as shown — same shapes, same text, same proportions, same colours. The embroidery should occupy approximately 40-50% of the front panel width, leaving clear breathing room on all sides. Do NOT redraw, simplify, or substitute any part.',
    rightInstruction,
    'Do not change the cap shape or construction. Do NOT move or add stripes to any part of the cap. Do not add topstitching to the brim. Do not add a model or person. Do not change the background.',
  ].filter(Boolean).join(' ');
}

// ── REAR VIEW — Auto prompt (Surprise Me) ─────────────────────────────────
// Rear 3/4 left angle — shows rear panel + LEFT side
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
    logoLines.push(`Image ${imgIndex} is the REAR LOGO. Embroider it on the centre back of the cap above the snapback closure. The embroidery should be SMALL — a small accent badge. Raised 3D high detail embroidery with visible stitches. Do NOT scale it to fill the back panel.`);
    imgIndex++;
  }
  if (s.hasLeft) {
  const type = getLogoType(s.leftLogoName);
  const [min, max] = getOpticalScale(PLACEMENTS.LEFT.scale, type);

  const v = PLACEMENTS.LEFT.vertical;
  const vOffset = getVerticalOffset(type);

  logoLines.push(
    `Image ${imgIndex} is the LEFT SIDE DESIGN. Place it on the left mesh panel in the rear-lower quadrant, positioned forward toward the front seam and closer to the brim, center ~${Math.round(PLACEMENTS.LEFT.position * 100)}% from the rear seam, positioned close to the front edge of the mesh panel near the brim.

The lower portion of the logo must overlap the stripe band, with approximately ${Math.round(v.overlap[0]*100)}–${Math.round(v.overlap[1]*100)}% of the logo height intersecting the stripes. Vertical placement is determined relative to the stripe band, not the panel center, with a slight downward bias for visual balance.

Scale ~${Math.round(min*100)}–${Math.round(max*100)}% of panel width. Do not touch seams. Raised embroidery over mesh and stripes.`
  );

  imgIndex++;
}
  return [
    'Edit Image 1, which is a photograph of a blank grey trucker cap from a rear 3/4 left angle (looking at the back from the left side). Keep the EXACT same camera angle, perspective, and composition as Image 1 — do NOT rotate the cap or change the viewing angle. Keep the cap shape, construction, lighting, mesh texture, brim shape, snapback closure, and stripe placement EXACTLY as they are in Image 1. Only make the colour and embroidery changes described below.',
    'Preserve from Image 1 exactly: the mesh panels, snapback closure, brim curve, squatchee button, and any stripe positions. Do not move, add, or remove stripes. No topstitching on the brim. Do NOT rotate the cap to show the front.',
    `Analyse the logo in Image 2. Based on its colours, style, and brand aesthetic, choose the ideal cap colours: front panel, mesh, and brim. ${direction} ${stripeNote} Make choices a professional cap designer would make.`,
    'All logos rendered as 3D high detail embroidery raised above the cap surface. Black outlined embroidery on all positions. Individual thread stitches clearly visible.',
    ...logoLines,
    'Do not change the cap shape or construction. Do not change the camera angle or rotate the cap. Do not move or add stripes. Do not add stripes to the brim. Do not add topstitching to the brim. Do not add a model or person. Do not change the background. Do NOT place any embroidery on the right side of the cap — the right side is not visible from this rear 3/4 left angle.',
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
