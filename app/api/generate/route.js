// ============================================================================
// /api/generate — Backend route handler
// Handles two modes:
//   mode=product → cap product shot using base cap reference
//   mode=model   → lifestyle shot of a person wearing the cap
// ============================================================================

import { put } from '@vercel/blob';
import { headers } from 'next/headers';

export const maxDuration = 60;

export async function POST(request) {
  try {
    if (!process.env.FREEPIK_API_KEY) {
      return jsonError('Preview service is not configured. Please contact support.', 500);
    }

    const formData = await request.formData();
    const prompt    = formData.get('prompt');
    const mode      = formData.get('mode') || 'product';
    const frontFile = formData.get('design_front');
    const leftFile  = formData.get('design_leftSide');
    const rightFile = formData.get('design_rightSide');

    if (!prompt || !frontFile) {
      return jsonError('Missing prompt or front design.', 400);
    }

    // Upload the front logo to Blob (needed for both modes)
    const frontUrl = await uploadToBlob(frontFile, 'front');

    let referenceImages = [];

    if (mode === 'model') {
      // ── MODEL MODE ────────────────────────────────────────────────
      referenceImages.push({
        image: frontUrl,
        text: 'CAP FRONT LOGO — this is the EXACT logo to display on the cap front panel. Copy it pixel-for-pixel as 3D puff embroidery with visible raised depth, thread texture, and shadow. Do NOT redraw, reinterpret, simplify, or substitute any part of this design.',
        mime_type: frontFile.type || 'image/png',
      });
      referenceImages.push({
        image: frontUrl,
        text: 'EMPHASIS — identical logo repeated. The cap front panel MUST show this exact design as raised 3D embroidery. Every shape, colour, and letter must match. Do NOT invent a different logo.',
        mime_type: frontFile.type || 'image/png',
      });

    } else {
      // ── PRODUCT MODE ──────────────────────────────────────────────
      // Slot 1: base cap reference (style/shape anchor)
      // Slot 2: front logo
      // Slot 3: side logo or front logo emphasis
      const headersList = await headers();
      const host = headersList.get('host') || 'localhost:3000';
      const protocol = host.includes('localhost') ? 'http' : 'https';
      const baseCapUrl = `${protocol}://${host}/cap-reference.jpg`;

      referenceImages.push({
        image: baseCapUrl,
        text: 'BASE CAP REFERENCE — use this cap photo as the style, shape, angle, lighting, and construction template. Match the cap silhouette, brim curve, mesh texture, and camera angle exactly. PLACE the logo on the front panel with the design from the next reference image.',
        mime_type: 'image/jpeg',
      });

      referenceImages.push({
        image: frontUrl,
        text: 'FRONT PANEL LOGO — copy this image pixel-for-pixel onto the cap front panel as 3D puff embroidery with visible raised depth, individual thread stitches, and shadow cast onto the cap fabric. This is the ONLY logo on the front. Do NOT redraw, reinterpret, simplify, or substitute any part.',
        mime_type: frontFile.type || 'image/png',
      });

      const sideFile = leftFile?.size > 0 ? leftFile : (rightFile?.size > 0 ? rightFile : null);
      if (sideFile) {
        const sideLabel = leftFile?.size > 0 ? 'left' : 'right';
        const sideUrl = await uploadToBlob(sideFile, sideLabel);
        referenceImages.push({
          image: sideUrl,
          text: `SIDE PANEL LOGO — reproduce this design exactly as smaller 3D puff embroidery on the ${sideLabel} side mesh panel. Raised depth with visible thread texture.`,
          mime_type: sideFile.type || 'image/png',
        });
      } else {
        referenceImages.push({
          image: frontUrl,
          text: 'EMPHASIS — identical logo repeated. The front panel MUST display this exact design as raised 3D puff embroidery. Every shape, colour, and letter must match pixel-for-pixel. Do NOT invent, redraw, or substitute.',
          mime_type: frontFile.type || 'image/png',
        });
      }
    }

    // ── Submit to image engine ───────────────────────────────────────
    const submitResp = await fetch('https://api.freepik.com/v1/ai/text-to-image/nano-banana-pro', {
      method: 'POST',
      headers: {
        'x-freepik-api-key': process.env.FREEPIK_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt,
        reference_images: referenceImages,
        aspect_ratio: '1:1',
        resolution: '1K',
      }),
    });

    if (!submitResp.ok) {
      const errText = await submitResp.text();
      console.error('Submit error:', errText);
      return jsonError(`Preview service returned ${submitResp.status}. Please try again.`, 502);
    }

    const submitData = await submitResp.json();
    const taskId = submitData.data?.task_id;
    if (!taskId) {
      return jsonError('Preview service did not return a task ID. Please try again.', 502);
    }

    // ── Poll for completion ─────────────────────────────────────────
    for (let i = 0; i < 55; i++) {
      await sleep(1000);
      const statusResp = await fetch(
        `https://api.freepik.com/v1/ai/text-to-image/nano-banana-pro/${taskId}`,
        { headers: { 'x-freepik-api-key': process.env.FREEPIK_API_KEY } }
      );

      if (!statusResp.ok) continue;

      const statusData = await statusResp.json();
      const status = statusData.data?.status;

      if (status === 'COMPLETED') {
        const imageUrl = statusData.data?.generated?.[0];
        if (!imageUrl) return jsonError('Preview completed but no image was returned.', 502);
        return Response.json({ imageUrl });
      }
      if (status === 'FAILED') {
        return jsonError('Preview creation failed. Please try again.', 502);
      }
    }

    return jsonError('Preview took too long. Please try again.', 504);
  } catch (err) {
    console.error('Error:', err);
    return jsonError(err.message || 'Something went wrong. Please try again.', 500);
  }
}

async function uploadToBlob(file, label) {
  const blob = await put(`logos/${label}-${file.name}`, file, {
    access: 'public',
    addRandomSuffix: true,
  });
  return blob.url;
}

function jsonError(message, status) {
  return Response.json({ error: message }, { status });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
