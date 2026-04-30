// ============================================================================
// lib/prompts.js — SERVER SIDE ONLY (reference copy)
// NOTE: route.js inlines all prompt builders to avoid Next.js cache issues.
// If you edit prompts here, copy the changes into route.js too.
// ============================================================================

const PROMPT_FRONT = {
  subject: 'Edit Image 1, which is a photograph of a blank grey trucker cap shown from a front 3/4 right angle. Keep the cap shape, construction, angle, lighting, mesh texture, brim shape, and stripe placement EXACTLY as they are in Image 1. Do NOT reimagine or redraw the cap. Only make the colour and embroidery changes described below.',
  construction: 'Preserve from Image 1 exactly: the high crown shape, single-piece structured front panel, mesh rear panels, brim curve, squatchee button, snapback closure, and the stripe count and placement. Stripes are decorative surface elements, not seams. Keep them fixed. Embroidery sits ON TOP of stripes. Preserve the EXACT stripe count, thickness, spacing, curvature, and position from Image 1 — all stripes must remain separate and fully visible. Stripes exist ONLY on the side panels exactly as shown in Image 1. Do NOT add, extend, or continue any stripes onto the brim under any circumstance. Do not merge, remove, fade, or reinterpret any stripe. Do not change the brim shape. No topstitching on the brim.',
  embroidery: 'All logos are raised 3D embroidery with visible stitching.',
  logoLockdown: 'Image 2 is the front logo. Embroider it centered on the front panel exactly as provided (no changes). Scale to exactly 42% of panel width (max 46%, min 38%) with even margins and clear spacing from seams.',
  avoid: 'Do not alter cap structure, geometry, materials, stripes, or camera angle. No extra elements or people.',
};


const PROMPT_REAR = {
  subject: 'Edit Image 1, which is a photograph of a blank grey trucker cap shown from a rear 3/4 left angle (looking at the back of the cap from the left side). Keep the EXACT same camera angle, perspective, and composition as Image 1 — do NOT rotate the cap or change the viewing angle. Keep the cap shape, construction, lighting, mesh texture, brim shape, snapback closure, and stripe placement EXACTLY as they are in Image 1. Do NOT reimagine or redraw the cap. Only make the colour and embroidery changes described below.',
  construction: 'Preserve from Image 1 exactly: the high crown shape, single-piece structured front panel, mesh rear panels, brim curve, squatchee button, snapback closure, and the stripe count and placement. Stripes are decorative surface elements, not seams. Keep them fixed. Embroidery sits ON TOP of stripes. Stripes exist ONLY on the side panels exactly as shown in Image 1. Do NOT add, extend, or continue any stripes onto the brim under any circumstance. Do not merge, remove, fade, or reinterpret any stripe. Do not change the brim shape. No topstitching on the brim.',
  embroidery: 'All logos are raised 3D embroidery with visible stitching.',
  avoid: 'Do not alter cap structure, geometry, materials, stripes, or camera angle. No extra elements or people.',
};

// ── Colour description helper ───────────────────────────────────────────────
function describeColor(hex) {
  if (!hex || hex.length < 4) return hex;
  const h = hex.replace('#', '').toLowerCase();
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
  if (brightness > 230) return 'white';
  if (brightness < 30)  return 'black';
  if (brightness > 180 && saturation < 0.1) return 'light grey';
  if (brightness > 120 && saturation < 0.1) return 'grey';
  if (brightness > 60  && saturation < 0.1) return 'dark grey';
  if (brightness < 60  && saturation < 0.15) return 'near black';
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

export { PROMPT_FRONT, PROMPT_REAR, describeColor };
