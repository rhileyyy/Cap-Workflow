// ============================================================================
// /api/generate — Backend route handler
// ----------------------------------------------------------------------------
// Reference image allocation (Nano Banana Pro allows max 3):
//   Slot 1: Base cap photo (always — from /public/cap-reference.jpg)
//   Slot 2: Customer's front logo (always)
//   Slot 3: Side logo if uploaded, OR duplicate of front logo for emphasis
//
// ENVIRONMENT VARIABLES (set these in your Vercel project settings):
//   FREEPIK_API_KEY       — your Freepik API key
//   BLOB_READ_WRITE_TOKEN — auto-set when you connect Vercel Blob
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
    const frontFile = formData.get('design_front');
    const leftFile  = formData.get('design_leftSide');
    const rightFile = formData.get('design_rightSide');

    if (!prompt || !frontFile) {
      return jsonError('Missing prompt or front design.', 400);
    }

    // ── Build the base URL for the public cap-reference image ──────────
    // Next.js serves files in /public/ at the root URL automatically.
    const headersList = await headers();
    const host = headersList.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseCapUrl = `${protocol}://${host}/cap-reference.jpg`;

    // ── Build reference_images array (max 3 slots) ────────────────────
    const referenceImages = [];

    // SLOT 1: Base cap reference (always first — style anchor)
    referenceImages.push({
      image: baseCapUrl,
      text: 'BASE CAP REFERENCE — use this cap photo as the style, shape, angle, lighting, and construction template. Match the cap silhouette, brim curve, mesh texture, and camera angle exactly. REPLACE the logo on the front panel with the design from the next reference image.',
      mime_type: 'image/jpeg',
    });

    // SLOT 2: Customer's front logo (always second)
    const frontUrl = await uploadToBlob(frontFile, 'front');
    referenceImages.push({
      image: frontUrl,
      text: 'FRONT PANEL LOGO — copy this image pixel-by-pixel onto the cap front panel as a verbatim exact replica rendered as raised embroidery. This is the ONLY logo that should appear on the front panel. Do NOT invent or substitute any other design.',
      mime_type: frontFile.type || 'image/png',
    });

    // SLOT 3: Side logo if uploaded, otherwise duplicate front logo for emphasis
    const sideFile = leftFile?.size > 0 ? leftFile : (rightFile?.size > 0 ? rightFile : null);
    if (sideFile) {
      const sideLabel = leftFile?.size > 0 ? 'left' : 'right';
      const sideUrl = await uploadToBlob(sideFile, sideLabel);
      referenceImages.push({
        image: sideUrl,
        text: `SIDE PANEL LOGO — embroider this design as a smaller accent on the ${sideLabel} side mesh panel, positioned near the front of the panel. Reproduce exactly.`,
        mime_type: sideFile.type || 'image/png',
      });
    } else {
      // No side logo — use slot 3 to re-emphasise the front logo
      referenceImages.push({
        image: frontUrl,
        text: 'EMPHASIS — same logo as slot 2. The front panel MUST display this exact design. Do not substitute, redraw, or invent a different logo.',
        mime_type: frontFile.type || 'image/png',
      });
    }

    // ── Submit to Nano Banana Pro ─────────────────────────────────────
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
      console.error('Freepik submit error:', errText);
      return jsonError(`Preview service returned ${submitResp.status}. Please try again.`, 502);
    }

    const submitData = await submitResp.json();
    const taskId = submitData.data?.task_id;
    if (!taskId) {
      return jsonError('Preview service did not return a task ID. Please try again.', 502);
    }

    // ── Poll for completion ──────────────────────────────────────────
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
        if (!imageUrl) return jsonError('Task completed but no image was returned', 502);
        return Response.json({ imageUrl });
      }
      if (status === 'FAILED') {
        return jsonError('Preview creation failed. Please try again.', 502);
      }
    }

    return jsonError('Preview took too long. Please try again.', 504);
  } catch (err) {
    console.error('Generation error:', err);
    return jsonError(err.message || 'Something went wrong. Please try again.', 500);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

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
