// ============================================================================
// lib/prompts.js — SERVER SIDE ONLY
// All prompt language lives here. Edit these strings to tune AI output.
// The frontend never sees this file — it sends structured data only.
// Total assembled prompt must stay under 3000 characters in all cases.
// ============================================================================

const PROMPT = {

  // ── What the image is ────────────────────────────────────────────────────
  subject: 'Realistic professional 3/4 view product mock of a 5 panel trucker cap, subject rotated 45 degrees to the left. PURE WHITE background — solid bright white (#ffffff), not grey, not off-white. Soft natural shadow directly beneath the cap only. No models, no hands, no props.',

  // ── Cap construction ─────────────────────────────────────────────────────
  construction: 'High crown structured front panel — solid square face, single piece of fabric, no visible centre seam. Mesh rear panels with clearly visible woven honeycomb texture. Clean sharp seam where solid front meets mesh sides. Pre-curved brim, smooth clean edge with absolutely no stitching, no topstitching, no stitch lines visible on the brim surface at all. Squatchee button on top crown. Snapback closure at rear.',

  // ── Embroidery style ─────────────────────────────────────────────────────
  embroidery: 'All embroidery is 3D puff raised above the cap surface with real physical elevation. Black outlined embroidery on all positions. Individual thread stitches clearly visible. Each embroidered element casts a shadow onto the cap fabric beneath it. I want to see threads and stitches, all the details.',

  // ── Logo lockdown — references Image 1 explicitly ────────────────────────
  logoLockdown: 'Image 1 is the front logo. Embroider Image 1 on the crown EXACTLY as shown — same shapes, same text, same proportions, same colours. Do NOT redraw, reinvent, simplify or substitute any part of Image 1. Do NOT add extra graphics or text that are not in Image 1.',

  // ── Things to avoid ──────────────────────────────────────────────────────
  avoid: 'Exclude: models, persons, hands, mannequins, multiple caps, extra brims, grey background, coloured background, busy background, props, lens flare, flat printed logos, screen printed logos, stitching on brim surface, low-profile cap, baseball cap, fitted cap, dad hat.',

};

const MODEL_PROMPTS = {
  male:   'Realistic lifestyle photo of a rugged Australian country man in his 30s wearing a trucker cap. Weathered sun-tanned face, relaxed confident expression, simple work shirt. Australian outback setting — red dirt, dry golden grass, sparse gum trees, wide open sky. Cap logo faces camera, clearly readable. Natural golden-hour sunlight. 85mm lens, shallow depth of field, person and cap sharp, background softly blurred.',
  female: 'Realistic lifestyle photo of a young Australian country woman in her late 20s wearing a trucker cap. Natural sun-kissed look, warm genuine smile, simple casual top. Australian outback setting — red earth, golden grassland, scattered eucalyptus trees, wide open sky. Cap logo faces camera, clearly readable. Natural golden-hour sunlight. 85mm lens, shallow depth of field, person and cap sharp, background softly blurred.',
  child:  'Realistic lifestyle photo of a cheerful Australian country kid around 10 years old wearing a trucker cap. Big natural grin, sun-tanned face, simple t-shirt. Australian outback setting — red dust, dry golden grass, gum trees, bright blue sky. Cap logo faces camera, clearly readable. Warm afternoon sunlight. 85mm lens, shallow depth of field, child and cap sharp, background softly blurred.',
};

// ── Colour description helper ───────────────────────────────────────────────
// Converts a hex value to a readable colour name for the prompt.
// The AI responds better to "navy blue" than "#1a2b4a".
function describeColor(hex) {
  if (!hex || hex.length < 4) return hex;
  const h = hex.replace('#', '').toLowerCase();

  // Parse RGB
  let r, g, b;
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }

  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;

  // Near-white and near-black
  if (brightness > 230) return 'white';
  if (brightness < 30)  return 'black';
  if (brightness > 180 && saturation < 0.1) return 'light grey';
  if (brightness > 120 && saturation < 0.1) return 'grey';
  if (brightness > 60  && saturation < 0.1) return 'dark grey';
  if (brightness < 60  && saturation < 0.15) return 'near black';

  // Hue-based names
  if (saturation < 0.15) return `grey (${hex})`;
  const hue = Math.round(Math.atan2(
    Math.sqrt(3) * (g - b),
    2 * r - g - b
  ) * 180 / Math.PI);
  const h360 = (hue + 360) % 360;

  if (h360 < 15  || h360 >= 345) return brightness < 100 ? 'dark red'    : 'red';
  if (h360 < 45)                  return brightness < 100 ? 'dark orange' : 'orange';
  if (h360 < 70)                  return brightness < 120 ? 'dark yellow' : 'yellow';
  if (h360 < 150)                 return brightness < 100 ? 'dark green'  : 'green';
  if (h360 < 195)                 return brightness < 100 ? 'dark teal'   : 'teal';
  if (h360 < 255)                 return brightness < 100 ? 'navy blue'   : 'blue';
  if (h360 < 290)                 return brightness < 100 ? 'dark purple' : 'purple';
  if (h360 < 345)                 return brightness < 100 ? 'dark pink'   : 'pink';
  return hex;
}

// ── Product shot prompt builder ─────────────────────────────────────────────
export function buildProductPrompt(s) {
  const front    = describeColor(s.colors.front);
  const mesh     = describeColor(s.colors.mesh);
  const brim     = describeColor(s.colors.brim);
  const snapback = describeColor(s.colors.snapback);

  const colourLine = `Cap colours: ${front} crown, ${mesh} mesh, ${brim} brim, ${snapback} snapback.`
    + (s.sandwichBrim
      ? ` Sandwich brim with ${describeColor(s.sandwichColor)} contrasting layer visible along the underside edge of the brim.`
      : '');

  const stripeLine = s.stripeCount === 0
    ? 'No stripes on the side panels.'
    : `${s.stripeCount} sewn ${describeColor(s.stripeColor)} stripe${s.stripeCount > 1 ? 's' : ''} on the lower mesh side panels, running horizontally parallel to the brim, tightly grouped with only 3-4mm between stripes.`;

  const sideLogos = [];
  if (s.hasSideLeft)  sideLogos.push('LEFT side mesh panel');
  if (s.hasSideRight) sideLogos.push('RIGHT side mesh panel');
  const sideLogoLine = sideLogos.length > 0
    ? s.stripeCount > 0
      ? `Image 2 is the side logo. Embroider Image 2 placed directly over the stripes on the lower mesh of the ${sideLogos.join(' and ')}. The logo sits on top of the stripes, not beside them. Black outline embroidery, reproduced exactly from Image 2.`
      : `Image 2 is the side logo. Embroider Image 2 on the lower mesh of the ${sideLogos.join(' and ')}, centred on the side panel. Black outline embroidery, reproduced exactly from Image 2.`
    : '';

  const assembled = [
    PROMPT.subject,
    PROMPT.construction,
    colourLine,
    stripeLine,       // stripes described BEFORE side logo so AI knows they exist
    PROMPT.embroidery,
    PROMPT.logoLockdown,
    sideLogoLine,     // logo placement references stripe position
    PROMPT.avoid,
  ].filter(Boolean).join(' ');

  // Safety check — log if approaching limit
  if (assembled.length > 2900) {
    console.warn(`Prompt length ${assembled.length} approaching 3000 char limit`);
  }

  return assembled;
}

// ── Model lifestyle shot prompt builder ─────────────────────────────────────
export function buildModelPrompt(modelKey, s) {
  const base = MODEL_PROMPTS[modelKey] || MODEL_PROMPTS.male;
  const front = describeColor(s.colors.front);
  const mesh  = describeColor(s.colors.mesh);
  const brim  = describeColor(s.colors.brim);

  let capDesc = `The trucker cap has a ${front} crown, ${mesh} mesh sides, and ${brim} brim.`;
  if (s.sandwichBrim) {
    capDesc += ` Sandwich brim with ${describeColor(s.sandwichColor)} underside.`;
  }

  const stripePart = s.stripeCount === 0
    ? ''
    : ` ${s.stripeCount} sewn ${describeColor(s.stripeColor)} stripe${s.stripeCount > 1 ? 's' : ''} on the lower mesh side panels.`;

  const logoRule = 'The front logo is embroidered exactly from the reference image — same shapes, text, proportions. Do NOT redraw or substitute it. Black outline embroidery, 3D raised with visible thread detail.';

  return `${base} ${capDesc}${stripePart} ${logoRule}`;
}
