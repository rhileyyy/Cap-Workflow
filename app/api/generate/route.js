// ============================================================================
// /api/generate — Backend route handler
// ----------------------------------------------------------------------------
// 1. Receives the customer's logo files + prompt from the frontend
// 2. Uploads each logo to Vercel Blob storage to get public URLs
//    (Nano Banana Pro requires URLs for reference images, not base64)
// 3. Calls Nano Banana Pro with prompt + up to 3 reference images
// 4. Polls until the task completes, then returns the rendered image URL
//
// ENVIRONMENT VARIABLES (set these in your Vercel project settings):
//   FREEPIK_API_KEY       — your Freepik API key
//   BLOB_READ_WRITE_TOKEN — auto-set when you connect Vercel Blob
// ============================================================================

import { put } from '@vercel/blob';

export const maxDuration = 60; // allow up to 60s for the AI to render

export async function POST(request) {
  try {
    if (!process.env.FREEPIK_API_KEY) {
      return jsonError('FREEPIK_API_KEY is not set in the project environment.', 500);
    }

    const formData = await request.formData();
    const prompt    = formData.get('prompt');
    const frontFile = formData.get('design_front');
    const leftFile  = formData.get('design_leftSide');
    const rightFile = formData.get('design_rightSide');

    if (!prompt || !frontFile) {
      return jsonError('Missing prompt or front design.', 400);
    }

    // 1. Upload logos to Vercel Blob → public URLs
    // Each side becomes one entry in reference_images with a text label
    // telling Nano Banana what role that image plays.
    const referenceImages = [];

    const frontUrl = await uploadToBlob(frontFile, 'front');
    referenceImages.push({
      image: frontUrl,
      text: 'Front panel logo — embroider this design exactly as shown, prominently centered on the front foam panel of the cap.',
      mime_type: frontFile.type || 'image/png',
    });

    if (leftFile && leftFile.size > 0) {
      const leftUrl = await uploadToBlob(leftFile, 'left');
      referenceImages.push({
        image: leftUrl,
        text: 'Left side panel logo — embroider this design as a smaller accent on the LEFT side mesh panel only.',
        mime_type: leftFile.type || 'image/png',
      });
    }
    if (rightFile && rightFile.size > 0) {
      const rightUrl = await uploadToBlob(rightFile, 'right');
      referenceImages.push({
        image: rightUrl,
        text: 'Right side panel logo — embroider this design as a smaller accent on the RIGHT side mesh panel only.',
        mime_type: rightFile.type || 'image/png',
      });
    }

    // 2. Submit to Nano Banana Pro
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
        resolution: '2K',
      }),
    });

    if (!submitResp.ok) {
      const errText = await submitResp.text();
      console.error('Freepik submit error:', errText);
      return jsonError(`Freepik returned ${submitResp.status}: ${errText.slice(0, 500)}`, 502);
    }

    const submitData = await submitResp.json();
    const taskId = submitData.data?.task_id;
    if (!taskId) {
      return jsonError('Freepik response had no task_id', 502);
    }

    // 3. Poll for completion (max ~55 seconds — leave headroom under maxDuration)
    for (let i = 0; i < 55; i++) {
      await sleep(1000);
      const statusResp = await fetch(
        `https://api.freepik.com/v1/ai/text-to-image/nano-banana-pro/${taskId}`,
        { headers: { 'x-freepik-api-key': process.env.FREEPIK_API_KEY } }
      );

      if (!statusResp.ok) continue; // transient error, just keep polling

      const statusData = await statusResp.json();
      const status = statusData.data?.status;

      if (status === 'COMPLETED') {
        const imageUrl = statusData.data?.generated?.[0];
        if (!imageUrl) return jsonError('Task completed but no image was returned', 502);
        return Response.json({ imageUrl });
      }
      if (status === 'FAILED') {
        return jsonError('Generation task failed: ' + JSON.stringify(statusData.data), 502);
      }
    }

    return jsonError('Generation timed out after 55 seconds. Please try again.', 504);
  } catch (err) {
    console.error('Generation error:', err);
    return jsonError(err.message || 'Generation failed', 500);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function uploadToBlob(file, label) {
  // Random suffix avoids name collisions; addRandomSuffix already does this
  // but we add the label too for easier debugging in the Blob dashboard.
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
