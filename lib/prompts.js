// ============================================================================
// lib/prompts.js
// Server-side only. All prompt constants and builder functions live here.
// The frontend never sees this — it sends structured data and the backend
// assembles the prompt. Edit this file to tune the AI output.
// ============================================================================

const PROMPT = {
  subject: 'Three-quarter front view of a high-crown structured trucker cap at a 30-degree angle from the front-right, eye-level, sitting upright on a flat surface.',

  construction: 'Construction: single continuous front face panel — one solid piece of structured fabric, NO visible centre seam, smooth uninterrupted front. Three rear panels are mesh with visible woven texture. Sharp vertical seam where front meets mesh. Pre-curved brim with downward arc — brim surface is COMPLETELY CLEAN, absolutely NO stitching, NO stitch lines, NO topstitching, NO contrast stitching, NO thread visible anywhere on the brim top or edge. Smooth uninterrupted fabric only. Squatchee button on top. Snapback closure at back.',

  logoLockdown: 'CRITICAL LOGO RULE: The provided reference image IS the logo. It must appear on the front panel as an EXACT pixel-perfect copy — identical shapes, colours, text characters, and proportions. Do NOT redraw, reinterpret, stylise, simplify, or substitute ANY part of the logo. Do NOT invent additional graphics, text, badges, or patches. Every logo on the cap is rendered as 3D puff embroidery — visibly raised above the cap surface with real physical depth and elevation. Individual thread stitches are visible. Each element casts a natural shadow onto the cap fabric beneath it.',

  avoid: 'Avoid: flat brim, low-profile, baseball or fitted cap, dad hat, mesh on front panel, panel bleeding, multiple caps, model, person, hands, mannequin, extra brims, busy or coloured background, props, harsh shadows, lens flare, cartoon, illustration, sketch, stitching on brim, topstitching on brim, stitch lines on brim, contrast stitching, flat printed logos, screen printed logos.',

  lighting: 'Lighting: soft directional studio light from upper-left, gentle shadows on crown right side and under brim. Soft-box quality, no glare, no coloured gels.',

  background: 'Background: pure white seamless studio backdrop, barely-perceptible cool gradient near the bottom. Soft natural contact shadow beneath the cap, diffuse not hard-edged. No props, no other objects.',

  style: 'Style: 85mm lens at f/4, shallow depth of field with cap fully sharp. Ultra detail, fabric and mesh texture visible, 3D embroidery depth and thread texture visible. Clean ecommerce product photography.',
};

const MODEL_PROMPTS = {
  male:   'Portrait of a rugged Australian country man in his 30s wearing a trucker cap. Weathered, sun-tanned face, relaxed confident expression. Simple work shirt. Standing outdoors in the Australian outback — red dirt, dry golden grass, sparse gum trees, clear blue sky. The cap logo faces the camera and is clearly readable. Natural golden-hour sunlight. Shot on 85mm lens, shallow depth of field, person and cap sharp, background softly blurred.',
  female: 'Portrait of a young Australian country woman in her late 20s wearing a trucker cap. Natural sun-kissed look, warm genuine smile. Simple casual top. Standing outdoors in the Australian outback — red earth, golden grassland, scattered eucalyptus trees, wide open sky. The cap logo faces the camera and is clearly readable. Natural golden-hour sunlight. Shot on 85mm lens, shallow depth of field, person and cap sharp, background softly blurred.',
  child:  'Portrait of a cheerful Australian country kid around 10 years old wearing a trucker cap. Big natural grin, sun-tanned face. Simple t-shirt. Standing outdoors in the Australian outback — red dust, dry golden grass, gum trees, bright blue sky. The cap logo faces the camera and is clearly readable. Warm afternoon sunlight. Shot on 85mm lens, shallow depth of field, child and cap sharp, background softly blurred.',
};

/**
 * Build the product shot prompt from structured settings.
 * @param {object} s — settings from the frontend
 */
export function buildProductPrompt(s) {
  const colourLine = `Front panel: ${s.colors.front}. Mesh panels: ${s.colors.mesh}. Brim: ${s.colors.brim}. Snapback: ${s.colors.snapback}.`
    + (s.sandwichBrim ? ` Sandwich brim — contrasting ${s.sandwichColor} layer along the brim underside.` : '');

  const stripeLine = s.stripeCount === 0
    ? 'No stripes — clean unbroken mesh on sides.'
    : `${s.stripeCount} horizontal sewn-in flat ribbon stripe${s.stripeCount > 1 ? 's' : ''} in ${s.stripeColor} on each side mesh panel, parallel to brim. Tightly grouped — 3-4mm gap, almost touching. Middle third of panel height, symmetrical.`;

  const sideParts = [];
  if (s.hasSideLeft)  sideParts.push('smaller 3D embroidered logo on LEFT side mesh panel near the front-mesh seam');
  if (s.hasSideRight) sideParts.push('smaller 3D embroidered logo on RIGHT side mesh panel near the front-mesh seam');
  const sideLogoLine = sideParts.length > 0
    ? `Also: ${sideParts.join(', and ')}. Each side logo reproduced exactly from its reference as raised 3D puff embroidery with visible thread texture, sitting on top of any stripes.`
    : '';

  return [
    PROMPT.subject, PROMPT.construction, colourLine, PROMPT.logoLockdown,
    sideLogoLine, stripeLine, PROMPT.lighting, PROMPT.background, PROMPT.style, PROMPT.avoid,
  ].filter(Boolean).join(' ');
}

/**
 * Build a model lifestyle shot prompt from structured settings.
 * @param {string} modelKey — 'male' | 'female' | 'child'
 * @param {object} s — settings from the frontend
 */
export function buildModelPrompt(modelKey, s) {
  const base = MODEL_PROMPTS[modelKey] || MODEL_PROMPTS.male;
  let capDesc = `The trucker cap has a ${s.colors.front} front panel, ${s.colors.mesh} mesh sides, ${s.colors.brim} brim, and ${s.colors.snapback} snapback. Single-piece structured front, pre-curved brim with no stitching visible on brim.`;
  if (s.sandwichBrim) capDesc += ` Sandwich brim with ${s.sandwichColor} underside.`;
  const stripePart = s.stripeCount === 0
    ? ''
    : ` ${s.stripeCount} thin horizontal ${s.stripeColor} stripe${s.stripeCount > 1 ? 's' : ''} on each side panel, tightly grouped.`;
  const logoRule = 'CRITICAL: the cap front panel displays the provided logo as an EXACT pixel-perfect copy — same shapes, colours, text. Do NOT invent a different logo. Rendered as 3D puff embroidery with visible raised depth and thread texture, clearly readable.';
  return `${base} ${capDesc}${stripePart} ${logoRule}`;
}
