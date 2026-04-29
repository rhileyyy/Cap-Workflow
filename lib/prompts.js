// ============================================================================
// lib/prompts.js — SERVER SIDE ONLY (reference copy)
// NOTE: route.js inlines all prompt builders to avoid Next.js cache issues.
// If you edit prompts here, copy the changes into route.js too.
// ============================================================================

const PROMPT_FRONT = {
  subject: 'Edit Image 1, which is a photograph of a blank grey trucker cap shown from a front 3/4 left angle. Keep the cap shape, construction, angle, lighting, mesh texture, brim shape, and stripe placement EXACTLY as they are in Image 1. Do NOT reimagine or redraw the cap. Only make the colour and embroidery changes described below.',
  construction: 'Preserve from Image 1 exactly: the high crown shape, single-piece structured front panel, mesh rear panels, brim curve, squatchee button, snapback closure, and the stripe count and placement. Do not add or remove stripes. Do not change the brim shape. No topstitching on the brim.',
  embroidery: 'All logos are rendered as 3D high detail embroidery raised above the cap surface. Black outlined embroidery on all positions. Individual thread stitches clearly visible. Each embroidered element casts a shadow onto the fabric beneath it.',
  logoLockdown: 'Image 2 is the front logo. Embroider it on the centre of the front panel EXACTLY as shown — same shapes, same text, same proportions, same colours. The embroidery should occupy approximately 55–65% of the front panel width, leaving clear breathing room around all edges. Do NOT redraw, simplify, or substitute any part of it.',
  avoid: 'Do not change the cap shape or construction. Do not move or add stripes. Do not add stripes to the brim. Do not add topstitching to the brim. Do not change the mesh. Do not add a model or person. Do not change the background colour.',
};

const PROMPT_REAR = {
  subject: 'Edit Image 1, which is a photograph of a blank grey trucker cap shown from a rear 3/4 right angle (looking at the back of the cap). Keep the cap shape, construction, angle, lighting, mesh texture, brim shape, snapback closure, and stripe placement EXACTLY as they are in Image 1. Do NOT reimagine or redraw the cap. Only make the colour and embroidery changes described below.',
  construction: 'Preserve from Image 1 exactly: the mesh panels, snapback closure, brim curve from behind, squatchee button, and any stripe positions. Do not add or remove stripes. Do not change the brim shape. No topstitching on the brim.',
  embroidery: 'All logos are rendered as 3D high detail embroidery raised above the cap surface. Black outlined embroidery on all positions. Individual thread stitches clearly visible. Each embroidered element casts a shadow onto the fabric beneath it.',
  avoid: 'Do not change the cap shape or construction. Do not move or add stripes. Do not add stripes to the brim. Do not add topstitching to the brim. Do not change the mesh. Do not add a model or person. Do not change the background colour.',
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
