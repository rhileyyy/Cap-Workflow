import { put } from '@vercel/blob';
import { headers } from 'next/headers';

export const maxDuration = 60;

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

    const headersList = await headers();
    const host = headersList.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseCapUrl = `${protocol}://${host}/cap-reference.jpg`;

    const referenceImages = [];

    referenceImages.push({
      image: baseCapUrl,
      text: 'BASE CAP REFERENCE — use this cap photo as the style, shape, angle, lighting, and construction template. Match the cap silhouette, brim curve, mesh texture, and camera angle exactly. REPLACE the logo on the front panel with the design from the next reference image.',
      mime_type: 'image/jpeg',
    });

    const frontUrl = await uploadToBlob(frontFile, 'front');
    referenceImages.push({
      image: frontUrl,
      text: 'FRONT PANEL LOGO — copy this image pixel-by-pixel onto the cap front panel as a verbatim exact replica rendered as raised embroidery. This is the ONLY logo that should appear on the front panel. Do NOT invent or substitute any other design.',
      mime_type: frontFile.type || 'image/png',
    });

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
      referenceImages.push({
        image: frontUrl,
        text: 'EMPHASIS — same logo as slot 2. The front panel MUST display this exact design. Do not substitute, redraw, or invent a different logo.',
        mime_type: frontFile.type || 'image/png',
      });
    }

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
      return jsonError(`Freepik returned ${submitResp.status}: ${errText.slice(0, 500)}`, 502);
    }

    const submitData = await submitResp.json();
    const taskId = submitData.data?.task_id;
    if (!taskId) {
      return jsonError('Freepik response had no task_id', 502);
    }

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
        return jsonError('Generation task failed: ' + JSON.stringify(statusData.data), 502);
      }
    }

    return jsonError('Generation timed out after 55 seconds. Please try again.', 504);
  } catch (err) {
    console.error('Generation error:', err);
    return jsonError(err.message || 'Generation failed', 500);
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
