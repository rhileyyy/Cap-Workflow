// ============================================================================
// app/api/generate/route.js
// Uses Google's Gemini API (gemini-3.1-flash-image-preview) directly.
// Synchronous — image returns in the same response, no polling.
//
// Two view angles supported:
//   - 'front' → front 3/4 left view  (brim right, mesh left) — shows cap's RIGHT side panel
//   - 'rear'  → rear 3/4 right view  (brim left, snapback right) — shows cap's LEFT side panel
//
// ENVIRONMENT VARIABLES (set in Vercel dashboard):
//   GOOGLE_API_KEY        — from https://aistudio.google.com/apikey
//   BLOB_READ_WRITE_TOKEN — auto-set when you connect Vercel Blob
//
// CHANGES FROM PREVIOUS VERSION:
//   A. analyseLogoTone() — Sharp pixel stats detect light/outline logos and
//      inject specific prompt language so Gemini preserves white/light fills.
//      Uses flood-fill background removal so white backgrounds (JPG, flat PNG,
//      WebP without transparency) don't corrupt the tone reading. Works correctly
//      even when the logo contains white elements (e.g. Cummins white text inside
//      a black bar) because flood-fill stops at colour boundaries — it only removes
//      pixels reachable from the corners, never interior enclosed regions.
//   B. Side logo tilt — prompt now specifies deterministic panel angle per view.
//   C. Reference cap fetch is cached in-memory (refCapCache) — never re-fetched.
//   D. Logo scaling + ref cap fetch run in parallel via Promise.all.
//   E. Metadata blob write is fire-and-forget (no await) — saves ~1–2s on response.
//   F. Removed unused vOffset variables in rear prompt builders.
// ============================================================================

import { GoogleGenAI } from '@google/genai';
import { put } from '@vercel/blob';
import { headers } from 'next/headers';
import { createHash } from 'crypto';
import sharp from 'sharp';

// ── Placement + Optical Scaling System ────────────────────────────────────────

const PLACEMENTS = {
  FRONT: {
    width: 0.40,
    min: 0.38,
    max: 0.46,
  },
  // RIGHT panel — visible in front 3/4 left view (cap0stripe etc.)
  // The panel is seen from the front, relatively close to camera.
  RIGHT: {
    anchor: 'front',
    position: 0.62,
    scale: [0.17, 0.21],  // ~15% smaller than original to prevent oversizing
    vertical: {
      overlap: [0.35, 0.45],
      baseOffset: -0.03,
    },
  },
  // LEFT panel — visible in rear 3/4 right view (cap-rear-* etc.)
  // The panel is seen from the rear, same physical scale as RIGHT.
  LEFT: {
    anchor: 'mesh',
    position: 0.58,
    scale: [0.17, 0.21],  // matched to RIGHT for visual consistency
    vertical: {
      overlap: [0.35, 0.45],
      baseOffset: -0.03,
    },
  },
  REAR: {
    scale: [0.18, 0.22],
  },
};

// ── Logo Type Detection (filename-based) ──────────────────────────────────────

function getLogoType(name = '') {
  const n = name.toLowerCase();
  if (n.includes('script') || n.includes('boogie') || n.includes('hand')) return 'script';
  if (n.includes('badge') || n.includes('round') || n.includes('crest')) return 'badge';
  if (n.length <= 3) return 'compact';
  return 'standard';
}

// ── Optical Scaling (visual weight balancing) ─────────────────────────────────

function getOpticalScale([min, max], type) {
  switch (type) {
    case 'script':  return [min + 0.04, max + 0.04]; // thin logos need boost
    case 'compact': return [min - 0.02, max - 0.02]; // prevent heavy look
    case 'badge':   return [min - 0.02, max - 0.02];
    default:        return [min, max];
  }
}

// ── Vertical Offset Adjustment ────────────────────────────────────────────────

function getVerticalOffset(type) {
  switch (type) {
    case 'script':  return -0.02;
    case 'compact': return -0.08;
    case 'badge':   return -0.06;
    default:        return -0.05;
  }
}

// ── [A] Background removal via flood-fill ─────────────────────────────────────
// Removes background pixels from a raw RGBA pixel buffer before tone analysis.
//
// WHY FLOOD-FILL INSTEAD OF COLOUR MATCHING:
//   Simple colour matching (skip all pixels that are "near white") fails when the
//   logo itself contains white or light elements — e.g. the Cummins logo has white
//   text ("CUMMINS") inside a black bar. Skipping all white pixels would incorrectly
//   discard that text as background.
//
//   Flood-fill is shape-aware and connectivity-based: it starts from the four
//   corners and expands outward, consuming only pixels that (a) are adjacent to
//   already-classified background, AND (b) match the background colour within
//   `tolerance`. It stops the moment it hits a colour boundary — so it correctly
//   removes the white space around the Cummins cross without ever reaching the
//   white text inside the black bar, because that region is enclosed and not
//   reachable from any corner.
//
//   Additionally, any pixel with alpha < 30 is treated as background regardless
//   of colour, so logos that already carry transparency (PNG, WebP) work correctly
//   without needing the flood-fill path.
//
// Returns: Uint8Array where 1 = background pixel (should be excluded from analysis).

function buildBackgroundMask(data, width, height, tolerance = 30) {
  // Sample all four corners (single pixel each) to derive the background seed colour.
  // Using single pixels is fine — if the image has meaningful content right at the
  // corner it's an extremely unusual logo and the tolerance check will still protect.
  const sample = (x, y) => {
    const i = (y * width + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  };
  const corners = [
    sample(0, 0),
    sample(width - 1, 0),
    sample(0, height - 1),
    sample(width - 1, height - 1),
  ];

  // Average the corner colours to get a robust background seed.
  const bgR = corners.reduce((s, c) => s + c.r, 0) / 4;
  const bgG = corners.reduce((s, c) => s + c.g, 0) / 4;
  const bgB = corners.reduce((s, c) => s + c.b, 0) / 4;

  // Colour distance from background seed (Manhattan in RGB — fast, sufficient here).
  const dist = (r, g, b) => Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);

  const pixels = width * height;
  const isBg = new Uint8Array(pixels); // 0 = foreground (default), 1 = background

  // Seed the BFS queue with the four corner pixel indices.
  const queue = new Int32Array(pixels); // pre-allocated, avoids repeated array growth
  let head = 0, tail = 0;

  const seed = (idx) => { if (!isBg[idx]) { isBg[idx] = 1; queue[tail++] = idx; } };
  seed(0);
  seed(width - 1);
  seed(width * (height - 1));
  seed(width * height - 1);

  // BFS — expand background outward one pixel at a time.
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % width;
    const y = (idx - x) / width;

    // Check all 4 cardinal neighbours.
    const neighbours = [
      x > 0        ? idx - 1      : -1,
      x < width - 1 ? idx + 1     : -1,
      y > 0        ? idx - width  : -1,
      y < height - 1 ? idx + width : -1,
    ];

    for (const n of neighbours) {
      if (n < 0 || isBg[n]) continue;
      const r = data[n * 4];
      const g = data[n * 4 + 1];
      const b = data[n * 4 + 2];
      const a = data[n * 4 + 3];
      // Fully transparent → background regardless of colour values
      if (a < 30 || dist(r, g, b) <= tolerance) {
        isBg[n] = 1;
        queue[tail++] = n;
      }
    }
  }

  return isBg;
}

// ── [A] Logo Tone Analysis ─────────────────────────────────────────────────────
// Uses buildBackgroundMask() to strip background pixels before measuring tone,
// making it robust against white/flat backgrounds on any file format (JPG, PNG,
// WebP, with or without alpha channel).
//
// Returns: { isLight, hasAlpha, meanBrightness, nearWhiteRatio, note }
//
// isLight = true  → logo has significant white/light content → inject preservation
//                   instructions into the Gemini prompt.
// isLight = false → logo is predominantly dark/coloured → no special instructions.

const logoToneCache = new Map();

async function analyseLogoTone(buffer, hash) {
  const cacheKey = `tone-${hash}`;
  if (logoToneCache.has(cacheKey)) return logoToneCache.get(cacheKey);

  try {
    const meta = await sharp(buffer).metadata();
    const hasAlpha = meta.channels === 4 || !!meta.hasAlpha;

    // Decode to raw RGBA — ensureAlpha so we always have 4 channels.
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Remove background pixels using flood-fill.
    const isBg = buildBackgroundMask(data, info.width, info.height, 30);

    const pixels = info.width * info.height;
    let sumBrightness = 0;
    let fgCount = 0;
    let nearWhiteCount = 0;

    for (let i = 0; i < pixels; i++) {
      if (isBg[i]) continue; // skip background
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      sumBrightness += brightness;
      fgCount++;
      if (brightness > 200) nearWhiteCount++;
    }

    if (fgCount === 0) {
      const result = { isLight: false, hasAlpha, meanBrightness: 0, nearWhiteRatio: 0, note: 'empty' };
      logoToneCache.set(cacheKey, result);
      return result;
    }

    const meanBrightness  = sumBrightness / fgCount;
    const nearWhiteRatio  = nearWhiteCount / fgCount;

    // Classify as light if either threshold is exceeded.
    const isLight = meanBrightness > 180 || nearWhiteRatio > 0.6;

    const note = `fg=${fgCount}px mean=${Math.round(meanBrightness)} nearWhite=${Math.round(nearWhiteRatio * 100)}% alpha=${hasAlpha}`;
    const result = { isLight, hasAlpha, meanBrightness, nearWhiteRatio, note };
    logoToneCache.set(cacheKey, result);
    console.log('Logo tone:', note, '→', isLight ? 'LIGHT' : 'DARK');
    return result;

  } catch (err) {
    console.warn('Logo tone analysis failed, defaulting to dark:', err.message);
    const result = { isLight: false, hasAlpha: false, meanBrightness: 0, nearWhiteRatio: 0, note: 'error' };
    logoToneCache.set(cacheKey, result);
    return result;
  }
}

// ── [A] Logo Tone → Prompt Language ──────────────────────────────────────────
// Returns extra prompt sentences injected after the logo placement instruction.
// For light logos, tells Gemini to preserve white/light fills exactly and NOT
// substitute darker thread because "it looks better on the cap".

function logoToneInstruction(tone, position = 'front') {
  if (!tone || !tone.isLight) return '';

  if (position === 'front') {
    return (
      'IMPORTANT — this logo contains white or light-coloured elements (e.g. white text, light fill, outline shapes). ' +
      'Reproduce ALL white and light-coloured areas in the embroidery exactly as they appear in the source image — ' +
      'use white or light-coloured thread for those areas. Do NOT substitute darker thread. ' +
      'The light areas are intentional design elements, not background. ' +
      'If the logo has a dark background block with white text inside it, reproduce that dark block with white stitching on top.'
    );
  }

  // Side or rear position
  return (
    'IMPORTANT — this side logo contains white or light-coloured elements. ' +
    'Preserve all white/light thread areas exactly. Do NOT fill them in with dark thread.'
  );
}

// ── [B] Side Panel Angle Instructions ────────────────────────────────────────
// Front 3/4 left view (cap0stripe etc.) shows the RIGHT panel receding left.
//   → Embroidery tilts ~8° counter-clockwise (top-left corner higher).
// Rear 3/4 right view (cap-rear-* etc.) shows the LEFT panel receding right.
//   → Embroidery tilts ~8° clockwise (top-right corner higher).

const SIDE_ANGLE = {
  right: 'The embroidery must follow the natural angle of the right mesh panel as it recedes from camera — tilt the design approximately 8° counter-clockwise so the top-left corner sits slightly higher than the top-right corner, matching the panel curvature visible in Image 1. Do NOT render the logo flat/vertical.',
  left:  'The embroidery must follow the natural angle of the left mesh panel as it recedes from camera — tilt the design approximately 8° clockwise so the top-right corner sits slightly higher than the top-left corner, matching the panel curvature visible in Image 1. Do NOT render the logo flat/vertical.',
};

// ============================================================================
// PROMPT TEMPLATES
// ============================================================================

const PROMPT_FRONT = {
  subject: 'You are editing a photograph of a blank grey trucker cap (Image 1). The output must look like Image 1 with colours and embroidery applied — NOT a newly generated cap. Keep every physical detail of Image 1 exactly: shape, angle, lighting, panel construction, mesh texture, brim curve, squatchee button, and snapback closure.',
  construction: 'Stripes: Image 1 has decorative sewn stripes running horizontally across the lower side panels. Preserve ALL stripes exactly — same count, same thickness, same spacing, same curvature, same position. Change ALL stripe colours uniformly to the requested colour — every single stripe must change, none left grey or original. Stripes appear ONLY on the side panels, never on the brim. Embroidery sits ON TOP of stripes. Do not add, remove, move, or merge any stripe.',
  embroidery: 'All logos are raised 3D embroidery with clearly visible individual thread stitches and a subtle shadow on the fabric beneath.',
  logoLockdown: 'Image 2 is the FRONT PANEL LOGO. Place it centered on the structured front panel only. Reproduce every shape, colour, and detail exactly as provided — same proportions, same colours, same text. Scale to fill approximately 40–45% of the front panel width with clear margin from all seams. Do NOT place this logo anywhere else on the cap.',
  avoid: 'Do NOT generate a new cap — edit Image 1 only. Do NOT add panels, seams, or structural elements that are not in Image 1. Do NOT place embroidery on the brim. Do NOT repeat logos on multiple panels. Do NOT add a person or model. Do NOT change the background.',
};

const PROMPT_REAR = {
  subject: 'You are editing a photograph of a blank grey trucker cap (Image 1) from the rear 3/4 angle. The output must look like Image 1 with colours and embroidery applied — NOT a newly generated cap. Keep every physical detail of Image 1 exactly: the rear 3/4 angle, shape, lighting, mesh panels, brim curve, squatchee button, and snapback closure.',
  construction: 'Stripes: Image 1 has decorative sewn stripes running horizontally across the lower side panels. Preserve ALL stripes exactly — same count, same thickness, same spacing, same position. Change ALL stripe colours uniformly to the requested colour — every single stripe must change, none left grey or original. Stripes appear ONLY on the side panels, never on the brim. Embroidery sits ON TOP of stripes. Do not add, remove, move, or merge any stripe.',
  embroidery: 'All logos are raised 3D embroidery with clearly visible individual thread stitches and a subtle shadow on the fabric beneath.',
  avoid: 'Do NOT generate a new cap — edit Image 1 only. Do NOT rotate the cap or change the viewing angle. Do NOT add panels or structural elements not in Image 1. Do NOT place embroidery on the brim. Do NOT repeat logos. Do NOT add a person or model. Do NOT change the background.',
};

// ── Colour description helper ──────────────────────────────────────────────────

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

// ── Prompt builders ────────────────────────────────────────────────────────────
// All four builders now accept a `tones` object: { front, right, left, rear }
// where each value is the result of analyseLogoTone() or null.

function buildFrontProductPrompt(s, tones = {}) {
  const P = PROMPT_FRONT;
  const front = describeColor(s.colors.front);
  const mesh  = describeColor(s.colors.mesh);
  const brim  = describeColor(s.colors.brim);

  const colourLine = `Change the cap colours: make the front panel ${front}, the mesh ${mesh}, and the brim ${brim}.`
    + (s.sandwichBrim ? ` Add a sandwich brim — a contrasting ${describeColor(s.sandwichColor)} layer visible along the underside edge of the brim.` : '');

  const stripeLine = s.stripeCount === 0 ? ''
    : `Change ALL stripes to ${describeColor(s.stripeColor)} — every stripe on the cap must become this colour uniformly. Do not leave any stripe grey or unchanged.`;

  // [A] Inject tone instruction for front logo
  const frontToneNote = logoToneInstruction(tones.front, 'front');

  // Front view shows the RIGHT side panel (mesh visible on the left side of the image)
  const rightLogoLine = s.hasRight
    ? (() => {
        const type = getLogoType(s.rightLogoName);
        const [min, max] = getOpticalScale(PLACEMENTS.RIGHT.scale, type);
        const toneLine = logoToneInstruction(tones.right, 'side');
        return (
          `Image 3 is the RIGHT SIDE LOGO. Embroider it as a small badge on the mesh panel visible on the LEFT side of Image 1 (this is the cap's right side panel). ` +
          `Place it in the lower half of the mesh panel, sitting on top of the stripes if stripes are present. ` +
          `Scale: approximately ${Math.round(min*100)}–${Math.round(max*100)}% of the front panel width — it must be clearly smaller than the front logo. ` +
          `Reproduce every colour, shape, and detail from Image 3 exactly — do NOT recolour or simplify. ` +
          SIDE_ANGLE.right +
          (toneLine ? ' ' + toneLine : '')
        );
      })()
    : '';

  return [
    P.subject,
    P.construction,
    colourLine,
    stripeLine,
    P.embroidery,
    P.logoLockdown,
    frontToneNote,
    rightLogoLine,
    P.avoid,
  ].filter(Boolean).join(' ');
}

function buildRearProductPrompt(s, tones = {}) {
  const P = PROMPT_REAR;
  const front = describeColor(s.colors.front);
  const mesh  = describeColor(s.colors.mesh);
  const brim  = describeColor(s.colors.brim);

  const colourLine = `Change the cap colours: make the front panel ${front}, the mesh ${mesh}, and the brim ${brim}.`
    + (s.sandwichBrim ? ` Add a sandwich brim — a contrasting ${describeColor(s.sandwichColor)} layer visible along the underside edge of the brim.` : '');

  const stripeLine = s.stripeCount === 0 ? ''
    : `Change ALL stripes to ${describeColor(s.stripeColor)} — every stripe on the cap must become this colour uniformly. Do not leave any stripe grey or unchanged.`;

  const logoLines = [];
  let imgIndex = 2;

  if (s.hasRear) {
    const toneLine = logoToneInstruction(tones.rear, 'side');
    logoLines.push(
      `Image ${imgIndex} is the REAR PANEL LOGO. Embroider it centered on the rear mesh panel above the snapback closure. ` +
      `Scale SMALL — approximately 20% of the front panel width. Reproduce every colour, shape, and detail exactly. Raised embroidery with visible stitching.` +
      (toneLine ? ' ' + toneLine : '')
    );
    imgIndex++;
  }

  // Rear view shows the LEFT side panel (mesh visible on the RIGHT side of the image)
  if (s.hasLeft) {
    const type = getLogoType(s.leftLogoName);
    const [min, max] = getOpticalScale(PLACEMENTS.LEFT.scale, type);
    const toneLine = logoToneInstruction(tones.left, 'side');
    logoLines.push(
      `Image ${imgIndex} is the LEFT SIDE LOGO. Embroider it as a small badge on the mesh panel visible on the RIGHT side of Image 1 (this is the cap's left side panel). ` +
      `Place it in the lower half of the mesh panel, sitting on top of the stripes if stripes are present. ` +
      `Scale: approximately ${Math.round(min*100)}–${Math.round(max*100)}% of the front panel width — it must be clearly smaller than a front logo would be. ` +
      `Reproduce every colour, shape, and detail from Image ${imgIndex} exactly — do NOT recolour or simplify. ` +
      SIDE_ANGLE.left +
      (toneLine ? ' ' + toneLine : '')
    );
    imgIndex++;
  }

  return [P.subject, P.construction, colourLine, stripeLine, P.embroidery, ...logoLines, P.avoid]
    .filter(Boolean).join(' ');
}

function buildFrontAutoPrompt(s, tones = {}) {
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
    ? `The reference cap already has ${s.stripeCount} stripe${s.stripeCount > 1 ? 's' : ''}. Keep them exactly where they are and choose a complementary stripe colour — ALL stripes must change to the same chosen colour.`
    : 'The reference cap has no stripes — keep it that way.';

  // [A] Front logo tone note
  const frontToneNote = logoToneInstruction(tones.front, 'front');

  // Front view shows the RIGHT side panel (mesh visible on the left side of the image)
  const rightInstruction = s.hasRight
    ? (() => {
        const type = getLogoType(s.rightLogoName);
        const [min, max] = getOpticalScale(PLACEMENTS.RIGHT.scale, type);
        const toneLine = logoToneInstruction(tones.right, 'side');
        return (
          `Image 3 is the RIGHT SIDE LOGO. Embroider it as a small badge on the mesh panel visible on the LEFT side of Image 1 (this is the cap's right side panel). ` +
          `Place it in the lower half of the mesh panel, sitting on top of the stripes if stripes are present. ` +
          `Scale: approximately ${Math.round(min*100)}–${Math.round(max*100)}% of the front panel width — clearly smaller than the front logo. ` +
          `Reproduce every colour, shape, and detail from Image 3 exactly — do NOT recolour or simplify. ` +
          SIDE_ANGLE.right +
          (toneLine ? ' ' + toneLine : '')
        );
      })()
    : '';

  return [
    'You are editing the photograph of a blank grey trucker cap in Image 1 — do NOT generate a new cap. The output must look like Image 1 with colours and embroidery applied.',
    'Preserve every physical detail of Image 1: cap shape, angle, lighting, panel construction, mesh texture, brim curve, squatchee button, snapback closure, and all stripes.',
    `Analyse the logo in Image 2. Choose ideal cap colours (front panel, mesh, brim) based on its aesthetic. ${direction} ${stripeNote} Decide whether a sandwich brim would complement the look.`,
    'Image 2 is the FRONT PANEL LOGO. Embroider it centered on the structured front panel — same proportions, colours, and details as provided. Scale to approximately 40–45% of panel width. Do NOT place this logo anywhere else.',
    frontToneNote,
    rightInstruction,
    P.embroidery,
    P.avoid,
  ].filter(Boolean).join(' ');
}

function buildRearAutoPrompt(s, tones = {}) {
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
    ? `The reference cap already has ${s.stripeCount} stripe${s.stripeCount > 1 ? 's' : ''}. Keep them exactly where they are and choose a complementary stripe colour — ALL stripes must change to the same chosen colour.`
    : 'The reference cap has no stripes — keep it that way.';

  const logoLines = [];
  let imgIndex = 2;

  if (s.hasRear) {
    const toneLine = logoToneInstruction(tones.rear, 'side');
    logoLines.push(
      `Image ${imgIndex} is the REAR PANEL LOGO. Embroider it centered on the rear mesh panel above the snapback closure. ` +
      `Scale SMALL — approximately 20% of what the front panel logo would be. Reproduce every colour, shape, and detail exactly. Raised embroidery with visible stitching.` +
      (toneLine ? ' ' + toneLine : '')
    );
    imgIndex++;
  }

  // Rear view shows the LEFT side panel (mesh visible on the RIGHT side of the image)
  if (s.hasLeft) {
    const type = getLogoType(s.leftLogoName);
    const [min, max] = getOpticalScale(PLACEMENTS.LEFT.scale, type);
    const toneLine = logoToneInstruction(tones.left, 'side');
    logoLines.push(
      `Image ${imgIndex} is the LEFT SIDE LOGO. Embroider it as a small badge on the mesh panel visible on the RIGHT side of Image 1 (this is the cap's left side panel). ` +
      `Place it in the lower half of the mesh panel, sitting on top of the stripes if stripes are present. ` +
      `Scale: approximately ${Math.round(min*100)}–${Math.round(max*100)}% of what the front panel logo would be — clearly a small accent badge. ` +
      `Reproduce every colour, shape, and detail from Image ${imgIndex} exactly — do NOT recolour or simplify. ` +
      SIDE_ANGLE.left +
      (toneLine ? ' ' + toneLine : '')
    );
    imgIndex++;
  }

  return [
    'You are editing the photograph of a blank grey trucker cap in Image 1 — do NOT generate a new cap. The output must look like Image 1 with colours and embroidery applied.',
    'Preserve every physical detail of Image 1: cap shape, rear 3/4 angle, lighting, panel construction, mesh texture, brim curve, squatchee button, snapback closure, and all stripes. Do NOT rotate the cap.',
    `Analyse the brand style from the uploaded logos. Choose ideal cap colours (front panel, mesh, brim). ${direction} ${stripeNote} Make choices a professional cap designer would make.`,
    P.embroidery,
    ...logoLines,
    P.avoid,
  ].filter(Boolean).join(' ');
}

// ============================================================================
// RUNTIME
// ============================================================================

export const maxDuration = 60;

// ── In-memory rate limiter ─────────────────────────────────────────────────────

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

// ── [C] Reference cap cache — never re-fetched after first load ────────────────
// Key: the filename string (e.g. 'cap-0stripe.jpg').
// Value: the base64 JPEG string ready for inlineData.
const refCapCache = new Map();

async function fetchRefCap(filename, host) {
  if (refCapCache.has(filename)) return refCapCache.get(filename);

  const protocol = host.includes('localhost') ? 'http' : 'https';
  const url = `${protocol}://${host}/${filename}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn('Reference cap fetch failed:', filename, resp.status);
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    const b64 = buf.toString('base64');
    refCapCache.set(filename, b64);
    return b64;
  } catch (err) {
    console.warn('Reference cap fetch error:', filename, err.message);
    return null;
  }
}

// ── Logo scaling + hash ────────────────────────────────────────────────────────
// Returns { data, mimeType, hash, buffer } — buffer is kept so we can run
// tone analysis on the same bytes without a second arrayBuffer() call.

const scaledCache = new Map();

async function fileToBase64Scaled(file, maxPx = 280) {
  // Read the buffer once
  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const hash = createHash('sha256').update(rawBuffer).digest('hex').slice(0, 16);
  const cacheKey = `scaled-${maxPx}-${hash}`;

  if (scaledCache.has(cacheKey)) {
    // Return cached scaled data + the raw buffer for tone analysis
    return { data: scaledCache.get(cacheKey), mimeType: 'image/png', hash, buffer: rawBuffer };
  }

  try {
    const resized = await sharp(rawBuffer)
      .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    const b64 = resized.toString('base64');
    scaledCache.set(cacheKey, b64);
    return { data: b64, mimeType: 'image/png', hash, buffer: rawBuffer };
  } catch {
    const b64 = rawBuffer.toString('base64');
    return { data: b64, mimeType: file.type || 'image/png', hash, buffer: rawBuffer };
  }
}

// ── Result cache ───────────────────────────────────────────────────────────────

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

// ── Main handler ───────────────────────────────────────────────────────────────

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
    const rightFile = formData.get('design_right'); // right panel — front view
    const leftFile  = formData.get('design_left');  // left panel  — rear view
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
      hasRight:      !!rightFile && rightFile.size > 0,
      hasLeft:       !!leftFile  && leftFile.size  > 0,
      hasRear:       !!rearFile  && rearFile.size  > 0,
      variationSeed: Number(formData.get('variationSeed') || 0),
      rightLogoName: rightFile?.name || '',
      leftLogoName:  leftFile?.name  || '',
    };

    if (!frontFile || frontFile.size === 0) {
      return jsonError('Missing front design.', 400);
    }

    const autoStripeCount = mode === 'auto' ? settings.variationSeed % 4 : settings.stripeCount;
    const effectiveSettings = mode === 'auto'
      ? { ...settings, stripeCount: autoStripeCount }
      : settings;

    // ── [C][D] Parallelise: logo scaling + reference cap fetch ─────────────────
    // These were three sequential awaits before. Now they run concurrently.
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

    const host = headersList.get('host') || 'localhost:3000';

    // Build list of parallel tasks — only scale logos relevant to this view
    const scaleTasks = [
      fileToBase64Scaled(frontFile, 420),
      viewAngle === 'front' && settings.hasRight ? fileToBase64Scaled(rightFile, 280) : Promise.resolve(null),
      viewAngle === 'rear'  && settings.hasLeft  ? fileToBase64Scaled(leftFile,  280) : Promise.resolve(null),
      viewAngle === 'rear'  && settings.hasRear  ? fileToBase64Scaled(rearFile,  280) : Promise.resolve(null),
      fetchRefCap(refFilename, host),
    ];

    const [frontImg, rightImg, leftImg, rearImg, refCapB64] = await Promise.all(scaleTasks);

    // ── [A] Run tone analysis in parallel on all logos that were scaled ────────
    const toneAnalysisTasks = {
      front: analyseLogoTone(frontImg.buffer, frontImg.hash),
      right: rightImg ? analyseLogoTone(rightImg.buffer, rightImg.hash) : Promise.resolve(null),
      left:  leftImg  ? analyseLogoTone(leftImg.buffer,  leftImg.hash)  : Promise.resolve(null),
      rear:  rearImg  ? analyseLogoTone(rearImg.buffer,  rearImg.hash)  : Promise.resolve(null),
    };
    const tones = {
      front: await toneAnalysisTasks.front,
      right: await toneAnalysisTasks.right,
      left:  await toneAnalysisTasks.left,
      rear:  await toneAnalysisTasks.rear,
    };

    // ── Build logo hash map for cache key ──────────────────────────────────────
    const logoHashes = { front: frontImg.hash };
    if (rightImg) logoHashes.right = rightImg.hash;
    if (leftImg)  logoHashes.left  = leftImg.hash;
    if (rearImg)  logoHashes.rear  = rearImg.hash;

    // ── Result cache check ─────────────────────────────────────────────────────
    const cacheKey = buildCacheKey(mode, viewAngle, logoHashes, effectiveSettings);
    if (resultCache.has(cacheKey)) {
      console.log('Cache hit:', cacheKey.slice(0, 40));
      return Response.json(resultCache.get(cacheKey));
    }

    // ── Build prompt (now receives tones) ──────────────────────────────────────
    let prompt;
    if (viewAngle === 'rear') {
      prompt = mode === 'auto'
        ? buildRearAutoPrompt(effectiveSettings, tones)
        : buildRearProductPrompt(effectiveSettings, tones);
    } else {
      prompt = mode === 'auto'
        ? buildFrontAutoPrompt(effectiveSettings, tones)
        : buildFrontProductPrompt(effectiveSettings, tones);
    }

    // ── Assemble Gemini parts ──────────────────────────────────────────────────
    const parts = [];

    // Image 1: reference cap — REQUIRED. If missing, fail rather than letting
    // Gemini generate a cap from scratch which produces wrong results.
    if (!refCapB64) {
      return jsonError('Reference cap image could not be loaded. Please try again.', 500);
    }
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: refCapB64 } });

    if (viewAngle === 'front') {
      // Front view: ref cap (1), front logo (2), right side logo (3 if any)
      const imageRefs = settings.hasRight
        ? 'Image 1 is the REFERENCE CAP to edit. Image 2 is the FRONT PANEL LOGO. Image 3 is the RIGHT SIDE LOGO. '
        : 'Image 1 is the REFERENCE CAP to edit. Image 2 is the FRONT PANEL LOGO. ';
      parts.push({ text: imageRefs + prompt });
      parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
      if (rightImg) parts.push({ inlineData: { mimeType: rightImg.mimeType, data: rightImg.data } });
    } else {
      // Rear view: ref cap (1), rear logo (2 if any), left side logo (next if any)
      // NOTE: The front logo is NOT sent for rear view — it was causing Gemini to
      // place it on the side panel. Colours come from the product prompt directly.
      const logoLabels = ['Image 1 is the REFERENCE CAP to edit.'];
      let imgIdx = 2;
      if (settings.hasRear) { logoLabels.push(`Image ${imgIdx} is the REAR PANEL LOGO.`); imgIdx++; }
      if (settings.hasLeft) { logoLabels.push(`Image ${imgIdx} is the LEFT SIDE LOGO.`); imgIdx++; }
      parts.push({ text: logoLabels.join(' ') + ' ' + prompt });
      // Do NOT push frontImg for rear view
      if (rearImg)  parts.push({ inlineData: { mimeType: rearImg.mimeType,  data: rearImg.data  } });
      if (leftImg)  parts.push({ inlineData: { mimeType: leftImg.mimeType,  data: leftImg.data  } });
    }

    // ── Call Gemini ────────────────────────────────────────────────────────────
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

    // ── Extract image from response ────────────────────────────────────────────
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
      console.error('No image in response. Parts:', JSON.stringify(
        responseParts?.map(p => ({ hasText: !!p.text, hasInlineData: !!p.inlineData, thought: p.thought }))
      ));
      return jsonError('Preview creation failed — no image returned. Please try again.', 502);
    }

    // ── Store in Vercel Blob ───────────────────────────────────────────────────
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

      // [E] Fire-and-forget metadata write — not needed before we return
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
      put(
        `generations/${shareId}/meta.json`,
        JSON.stringify(metadata),
        { access: 'public', contentType: 'application/json', addRandomSuffix: false }
      ).catch(err => console.warn('Metadata write failed (non-fatal):', err.message));

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
