// ============================================================================
// lib/prompts.js — SERVER SIDE ONLY
// All prompt language lives here. Edit these strings to tune AI output.
// The frontend never sees this file — it sends structured data only.
// Total assembled prompt must stay under 3000 characters in all cases.
// ============================================================================

const PROMPT = {

  // ── Editing instruction — NOT generation ─────────────────────────────────
  // Image 1 is the reference cap photo. We are EDITING it, not generating
  // a new image. This framing keeps the cap shape and construction consistent.
  subject: 'Edit Image 1, which is a photograph of a blank grey trucker cap. Keep the cap shape, construction, angle, lighting, mesh texture, brim shape, and stripe placement EXACTLY as they are in Image 1. Do NOT reimagine or redraw the cap. Only make the colour and embroidery changes described below.',

  // ── Construction — what NOT to change ────────────────────────────────────
  construction: 'Preserve from Image 1 exactly: the high crown shape, single-piece structured front panel, mesh rear panels, brim curve, squatchee button, snapback closure, and the stripe count and placement. Do not add or remove stripes. Do not change the brim shape. No topstitching on the brim.',

  // ── Embroidery ────────────────────────────────────────────────────────────
  embroidery: 'All logos are rendered as 3D puff embroidery raised above the cap surface. Black outlined embroidery on all positions. Individual thread stitches clearly visible. Each embroidered element casts a shadow onto the fabric beneath it.',

  // ── Logo lockdown ─────────────────────────────────────────────────────────
  logoLockdown: 'Image 2 is the front logo. Embroider it on the centre of the front panel EXACTLY as shown — same shapes, same text, same proportions, same colours. The embroidery should occupy approximately 55–65% of the front panel width, leaving clear breathing room around all edges. Do NOT redraw, simplify, or substitute any part of it.',

  // ── Avoid ─────────────────────────────────────────────────────────────────
  avoid: 'Do not change the cap shape or construction. Do not move or add stripes. Do not add stripes to the brim. Do not add topstitching to the brim. Do not change the mesh. Do not add a model or person. Do not change the background colour.',

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

// ── Auto design prompt builder ──────────────────────────────────────────────
// Used when the customer hasn't specified colours — the AI analyses the logo
// and chooses the best possible cap design for it.
export function buildAutoPrompt(s) {
  const hasSide = s.hasSide;
  const sideLogos = [];
  if (s.hasSide) sideLogos.push('side mesh panel');

  const imageRefs = hasSide
    ? 'Image 1 is the REFERENCE CAP to edit. Image 2 is the FRONT PANEL LOGO. Image 3 is the SIDE PANEL DESIGN. '
    : 'Image 1 is the REFERENCE CAP to edit. Image 2 is the FRONT PANEL LOGO. ';

  const sideInstruction = sideLogos.length > 0
    ? `Image 2 is the side logo — embroider it on the ${sideLogos.join(' and ')} on the lower mesh, reproduced exactly with black outline 3D puff embroidery.`
    : '';

  const autoColourInstruction = `Analyse Image 1 carefully. Based on the logo's colours, style, and brand aesthetic, choose the ideal cap colours for a professional commercial result: front panel colour, mesh colour, and brim colour. Also decide whether side stripes would enhance the design — if yes, choose the stripe count (1-3) and stripe colour. Decide whether a sandwich brim would complement the look — if yes, choose the underside colour. Make choices a professional cap designer would make. Prioritise bold, clean, commercially attractive results.`;

  const prompt = [
    imageRefs + 'Realistic professional 3/4 view product mock of a 5 panel trucker cap, subject rotated 45 degrees to the left. PURE WHITE background — solid bright white (#ffffff), not grey, not off-white. Soft natural shadow directly beneath the cap only. No models, no hands, no props.',
    PROMPT.construction,
    autoColourInstruction,
    PROMPT.embroidery,
    'Image 1 is the front logo. Embroider Image 1 on the crown EXACTLY as shown — same shapes, same text, same proportions, same colours. Do NOT redraw, reinvent, simplify or substitute any part of Image 1.',
    sideInstruction,
    PROMPT.avoid,
  ].filter(Boolean).join(' ');

  if (prompt.length > 2900) {
    console.warn(`Auto prompt length ${prompt.length} approaching 3000 char limit`);
  }

  return prompt;
}


export function buildProductPrompt(s) {
  const front    = describeColor(s.colors.front);
  const mesh     = describeColor(s.colors.mesh);
  const brim     = describeColor(s.colors.brim);
  // Editing language: change these colours on the existing cap photo
  const colourLine = `Change the cap colours: make the front panel ${front}, the mesh ${mesh}, and the brim ${brim}.`
    + (s.sandwichBrim
      ? ` Add a sandwich brim — a contrasting ${describeColor(s.sandwichColor)} layer visible along the underside edge of the brim.`
      : '');

  // Stripe colour change — the stripe COUNT and POSITION come from the reference cap photo
  const stripeLine = s.stripeCount === 0
    ? ''
    : `Change the stripe colour to ${describeColor(s.stripeColor)}. Keep the stripes exactly where they are in Image 1 — do not move them.`;

  const sideLogos = [];
  if (s.hasSide) sideLogos.push('side mesh panel');
  const sideLogoLine = sideLogos.length > 0
    ? s.stripeCount > 0
      ? `Image 3 is the SIDE PANEL DESIGN. Reproduce it EXACTLY on the ${sideLogos.join(' and ')} — every shape, letter, colour, and detail must match the reference precisely, including any white or light-coloured elements which must NOT be filled in or simplified. The side design sits ON TOP OF the stripes, foreground over background. Raised 3D embroidery with visible stitches. The side design must be embroidered SMALL — it is a small accent badge, approximately 1/4 to 1/3 the size of the front panel logo. Do NOT scale it to fill the side mesh panel.`
      : `Image 3 is the SIDE PANEL DESIGN. Reproduce it EXACTLY on the ${sideLogos.join(' and ')} in the lower mesh area — every shape, letter, colour, and detail must match precisely, including any white or light-coloured elements which must NOT be filled in or simplified. Raised 3D embroidery with visible stitches. The side design must be embroidered SMALL — it is a small accent badge, approximately 1/4 to 1/3 the size of the front panel logo. Do NOT scale it to fill the side mesh panel.`
    : '';

  const assembled = [
    PROMPT.subject,
    PROMPT.construction,
    colourLine,
    stripeLine,
    PROMPT.embroidery,
    PROMPT.logoLockdown,
    sideLogoLine,
    PROMPT.avoid,
  ].filter(Boolean).join(' ');

  if (assembled.length > 2900) {
    console.warn(`Prompt length ${assembled.length} approaching 3000 char limit`);
  }

  return assembled;
}

// ── Model lifestyle shot prompt builder ─────────────────────────────────────
export function buildModelPrompt(modelKey, s) {
  const base = MODEL_PROMPTS[modelKey] || MODEL_PROMPTS.male;
  // Image 1 is the already-rendered cap product shot.
  // Image 2 is the front logo for accuracy reference.
  // The model just puts the cap from Image 1 on the person — no cap rebuilding needed.
  const capInstruction = 'The person in this photo is wearing the exact cap shown in Image 1. Place the cap from Image 1 faithfully on their head — same colours, same logo, same construction, same stripes. Do NOT redesign or change any element of the cap.';
  return `${base} ${capInstruction}`;
}
