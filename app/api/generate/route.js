// ============================================================================
// app/api/generate/route.js
// ============================================================================

import { put, head } from '@vercel/blob';
import { headers } from 'next/headers';
import { createHash } from 'crypto';
import { buildProductPrompt, buildModelPrompt } from '../../../lib/prompts.js';

export const maxDuration = 60;

// ── In-memory rate limiter ─────────────────────────────────────────────────
// Simple sliding window. Persists across requests to the same server instance.
// Not perfect across cold starts, but adequate for this traffic level.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX       = 10;              // max generations per IP per window
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

// ── Blob upload cache ──────────────────────────────────────────────────────
// Maps file hash → Blob URL, so the same logo isn't re-uploaded on every
// regeneration attempt during a session (or across warm instances).
const blobCache = new Map();

async function uploadFileToBlob(file) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const hash   = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const ext    = file.type === 'image/png' ? '.png' : file.type === 'image/jpeg' ? '.jpg' : '.png';
  const cacheKey = `${hash}${ext}`;

  if (blobCache.has(cacheKey)) {
    return blobCache.get(cacheKey);
  }

  // Use a deterministic pathname so identical files don't pile up in blob storage.
  const blob = await put(`logos/cache/${cacheKey}`, buffer, {
    access: 'public',
    addRandomSuffix: false,
    contentType: file.type || 'image/png',
  });
  blobCache.set(cacheKey, blob.url);
  return blob.url;
}

// ── Main handler ──────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    if (!process.env.FREEPIK_API_KEY) {
      return jsonError('Preview service is not configured. Please contact support.', 500);
    }

    // Rate limit by IP
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

    // Parse request
    const formData   = await request.formData();
    const mode       = formData.get('mode') || 'product';
    const modelKey   = formData.get('modelKey') || 'male';
    const frontFile  = formData.get('design_front');
    const leftFile   = formData.get('design_leftSide');
    const rightFile  = formData.get('design_rightSide');

    // Structured settings — prompt is built server-side from these
    const settings = {
      colors: {
        front:    formData.get('color_front')    || '#1a1a1a',
        mesh:     formData.get('color_mesh')     || '#1a1a1a',
        brim:     formData.get('color_brim')     || '#1a1a1a',
        snapback: formData.get('color_snapback') || '#1a1a1a',
      },
      stripeCount:  Number(formData.get('stripeCount') || 0),
      stripeColor:  formData.get('stripeColor')  || '#ffffff',
      sandwichBrim: formData.get('sandwichBrim') === 'true',
      sandwichColor: formData.get('sandwichColor') || '#c2410c',
      hasSideLeft:  !!leftFile  && leftFile.size  > 0,
      hasSideRight: !!rightFile && rightFile.size > 0,
    };

    if (!frontFile || frontFile.size === 0) {
      return jsonError('Missing front design.', 400);
    }

    // Build the prompt server-side (never sent to or from client)
    const prompt = mode === 'model'
      ? buildModelPrompt(modelKey, settings)
      : buildProductPrompt(settings);

    // Upload logos to Blob (with caching)
    const frontUrl = await uploadFileToBlob(frontFile);
    const referenceImages = [];

    if (mode === 'model') {
      referenceImages.push({
        image: frontUrl,
        text: 'CAP FRONT LOGO — copy pixel-for-pixel as 3D puff embroidery with visible raised depth and thread stitches. Do NOT redraw, reinterpret, simplify, or substitute.',
        mime_type: frontFile.type || 'image/png',
      });
      referenceImages.push({
        image: frontUrl,
        text: 'EMPHASIS — identical logo. The cap front panel MUST show this exact design as raised 3D embroidery. Every shape, colour, and letter must match.',
        mime_type: frontFile.type || 'image/png',
      });
    } else {
      // Product mode: base cap as slot 1, customer logo as slot 2, side/emphasis as slot 3
      const host     = headersList.get('host') || 'localhost:3000';
      const protocol = host.includes('localhost') ? 'http' : 'https';
      referenceImages.push({
        image: `${protocol}://${host}/cap-reference.jpg`,
        text: 'BASE CAP REFERENCE — use this as the style, shape, angle, lighting, and construction template. REPLACE the logo on the front panel with the design from the next reference.',
        mime_type: 'image/jpeg',
      });
      referenceImages.push({
        image: frontUrl,
        text: 'FRONT PANEL LOGO — copy pixel-for-pixel as 3D puff embroidery with visible raised depth and thread stitches. This is the ONLY logo on the front panel. Do NOT redraw, reinterpret, simplify, or substitute.',
        mime_type: frontFile.type || 'image/png',
      });

      const sideFile  = settings.hasSideLeft ? leftFile : settings.hasSideRight ? rightFile : null;
      const sideLabel = settings.hasSideLeft ? 'left' : 'right';
      if (sideFile) {
        const sideUrl = await uploadFileToBlob(sideFile);
        referenceImages.push({
          image: sideUrl,
          text: `SIDE PANEL LOGO — reproduce as smaller 3D puff embroidery on the ${sideLabel} side mesh panel. Exact copy, raised depth, visible thread.`,
          mime_type: sideFile.type || 'image/png',
        });
      } else {
        referenceImages.push({
          image: frontUrl,
          text: 'EMPHASIS — identical logo. Front panel MUST display this exact design as raised 3D puff embroidery. Every shape, colour, letter must match pixel-for-pixel.',
          mime_type: frontFile.type || 'image/png',
        });
      }
    }

    // Submit to Nano Banana Pro
    const submitResp = await fetch('https://api.freepik.com/v1/ai/text-to-image/nano-banana-pro', {
      method: 'POST',
      headers: {
        'x-freepik-api-key': process.env.FREEPIK_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        reference_images: referenceImages,
        aspect_ratio: '1:1',
        resolution: '1K',
      }),
    });

    if (!submitResp.ok) {
      const errText = await submitResp.text();
      console.error('Freepik submit error:', errText);
      return jsonError('Preview service returned an error. Please try again.', 502);
    }

    const submitData = await submitResp.json();
    const taskId = submitData.data?.task_id;
    if (!taskId) return jsonError('Preview service did not respond correctly. Please try again.', 502);

    // Poll for completion
    let freepikImageUrl = null;
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
        freepikImageUrl = statusData.data?.generated?.[0];
        break;
      }
      if (status === 'FAILED') return jsonError('Preview creation failed. Please try again.', 502);
    }

    if (!freepikImageUrl) return jsonError('Preview took too long. Please try again.', 504);

    // ── Store the generation permanently in Vercel Blob ────────────────────
    // This gives us a permanent URL (Freepik URLs may expire) and a share ID.
    const shareId = crypto.randomUUID();
    let permanentImageUrl = freepikImageUrl; // fallback if blob storage fails

    try {
      // Fetch the rendered image from Freepik and re-upload to our Blob storage
      const imageResponse = await fetch(freepikImageUrl);
      if (imageResponse.ok) {
        const imageBuffer = await imageResponse.arrayBuffer();
        const imageBlobResult = await put(`generations/${shareId}/image.jpg`, imageBuffer, {
          access: 'public',
          contentType: 'image/jpeg',
          addRandomSuffix: false,
        });
        permanentImageUrl = imageBlobResult.url;

        // Store metadata for the share page
        const metadata = {
          shareId,
          imageUrl: permanentImageUrl,
          createdAt: new Date().toISOString(),
          mode,
          settings: {
            colors: settings.colors,
            stripeCount: settings.stripeCount,
            sandwichBrim: settings.sandwichBrim,
          },
        };
        await put(`generations/${shareId}/meta.json`, JSON.stringify(metadata), {
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false,
        });
      }
    } catch (storageErr) {
      // Non-fatal: if storage fails, we still return the Freepik URL
      console.error('Storage error (non-fatal):', storageErr);
    }

    return Response.json({ imageUrl: permanentImageUrl, shareId });
  } catch (err) {
    console.error('Generation error:', err);
    return jsonError(err.message || 'Something went wrong. Please try again.', 500);
  }
}

function jsonError(message, status) {
  return Response.json({ error: message }, { status });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
