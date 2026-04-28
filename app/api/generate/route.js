// ============================================================================
// app/api/generate/route.js
// Uses Google's Gemini API (Nano Banana 2 — gemini-3.1-flash-image-preview)
// directly. Synchronous — image returns in the same response, no polling.
//
// ENVIRONMENT VARIABLES (set in Vercel dashboard):
//   GOOGLE_API_KEY        — from https://aistudio.google.com/apikey
//   BLOB_READ_WRITE_TOKEN — auto-set when you connect Vercel Blob
// ============================================================================

import { GoogleGenAI } from '@google/genai';
import { put } from '@vercel/blob';
import { headers } from 'next/headers';
import { createHash } from 'crypto';
import { buildProductPrompt, buildModelPrompt } from '../../../lib/prompts.js';

export const maxDuration = 60;

// ── In-memory rate limiter ─────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX       = 10;              // requests per IP per window
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

// ── Logo blob cache ────────────────────────────────────────────────────────
// Maps file hash → base64 string. Avoids re-reading identical files.
const base64Cache = new Map();

async function fileToBase64Cached(file) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const hash   = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  if (base64Cache.has(hash)) {
    return { data: base64Cache.get(hash), mimeType: file.type || 'image/png' };
  }
  const b64 = buffer.toString('base64');
  base64Cache.set(hash, b64);
  return { data: b64, mimeType: file.type || 'image/png' };
}

// ── Main handler ──────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    if (!process.env.GOOGLE_API_KEY) {
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
    const formData  = await request.formData();
    const mode      = formData.get('mode') || 'product';
    const modelKey  = formData.get('modelKey') || 'male';
    const frontFile = formData.get('design_front');
    const leftFile  = formData.get('design_leftSide');
    const rightFile = formData.get('design_rightSide');

    // Structured settings — prompt assembled server-side from these
    const settings = {
      colors: {
        front:    formData.get('color_front')    || '#1a1a1a',
        mesh:     formData.get('color_mesh')     || '#1a1a1a',
        brim:     formData.get('color_brim')     || '#1a1a1a',
        snapback: formData.get('color_snapback') || '#1a1a1a',
      },
      stripeCount:   Number(formData.get('stripeCount') || 0),
      stripeColor:   formData.get('stripeColor')   || '#ffffff',
      sandwichBrim:  formData.get('sandwichBrim')  === 'true',
      sandwichColor: formData.get('sandwichColor') || '#c2410c',
      hasSideLeft:   !!leftFile  && leftFile.size  > 0,
      hasSideRight:  !!rightFile && rightFile.size > 0,
    };

    if (!frontFile || frontFile.size === 0) {
      return jsonError('Missing front design.', 400);
    }

    // Build prompt server-side
    const prompt = mode === 'model'
      ? buildModelPrompt(modelKey, settings)
      : buildProductPrompt(settings);

    // Convert logo files to base64 (with in-memory cache for re-generates)
    const frontImg = await fileToBase64Cached(frontFile);

    // ── Build the Gemini contents array ────────────────────────────────────
    // Format: [text_part, image_part, image_part, ...]
    // The Google GenAI SDK for JS takes an array of parts in `contents`.
    const parts = [];

    if (mode === 'model') {
      // Model shots: prompt first, then logo twice for emphasis
      parts.push({ text: prompt });
      parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
      parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
    } else {
      // Product shots: base cap reference + prompt + customer logo(s)
      const host     = headersList.get('host') || 'localhost:3000';
      const protocol = host.includes('localhost') ? 'http' : 'https';
      const capRefUrl = `${protocol}://${host}/cap-reference.jpg`;

      // Fetch the base cap reference image and convert to base64
      // We fetch it as a URL since it lives in /public — no file system access needed
      let capRefPart = null;
      try {
        const capRefResp = await fetch(capRefUrl);
        if (capRefResp.ok) {
          const capRefBuffer = Buffer.from(await capRefResp.arrayBuffer());
          capRefPart = {
            inlineData: {
              mimeType: 'image/jpeg',
              data: capRefBuffer.toString('base64'),
            },
          };
        }
      } catch {
        // Non-fatal — continue without base cap reference if it fails
        console.warn('Could not fetch cap reference image, continuing without it.');
      }

      // Assemble parts: reference cap → prompt → front logo → side logo or emphasis
      if (capRefPart) parts.push(capRefPart);
      parts.push({ text: prompt });
      parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });

      // Slot 3: side logo if uploaded, otherwise duplicate front for emphasis
      const sideFile  = settings.hasSideLeft ? leftFile : settings.hasSideRight ? rightFile : null;
      if (sideFile) {
        const sideImg = await fileToBase64Cached(sideFile);
        parts.push({ inlineData: { mimeType: sideImg.mimeType, data: sideImg.data } });
      } else {
        // Duplicate front logo as emphasis
        parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
      }
    }

    // ── Call Nano Banana 2 ─────────────────────────────────────────────────
    // Synchronous — image comes back in this single request, no polling needed.
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
        imageConfig: {
          aspectRatio: '1:1',
          imageSize: '1K',
        },
        thinkingConfig: {
          // 'minimal' = lowest latency while still using reasoning
          // Change to 'high' for higher quality at the cost of more wait time
          thinkingLevel: 'high',
        },
      },
    });

    // ── Extract image from response ────────────────────────────────────────
    // The response contains parts — find the one with inline image data.
    // Skip thought parts (used internally by the model's reasoning process).
    let imageBase64 = null;
    let imageMime   = 'image/png';

    const responseParts = response.candidates?.[0]?.content?.parts || [];
    for (const part of responseParts) {
      if (part.thought) continue; // skip thinking process parts
      if (part.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        imageMime   = part.inlineData.mimeType || 'image/png';
        break;
      }
    }

    if (!imageBase64) {
      console.error('No image in response. Parts:', JSON.stringify(responseParts?.map(p => ({
        hasText: !!p.text,
        hasInlineData: !!p.inlineData,
        thought: p.thought,
      }))));
      return jsonError('Preview creation failed — no image returned. Please try again.', 502);
    }

    // ── Store permanently in Vercel Blob ───────────────────────────────────
    // Give the customer a permanent URL. Background this so it doesn't
    // add to the perceived wait time.
    const shareId     = crypto.randomUUID();
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const ext         = imageMime.includes('jpeg') ? 'jpg' : 'png';
    let permanentImageUrl = null;

    try {
      const blobResult = await put(
        `generations/${shareId}/image.${ext}`,
        imageBuffer,
        { access: 'public', contentType: imageMime, addRandomSuffix: false }
      );
      permanentImageUrl = blobResult.url;

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
      await put(
        `generations/${shareId}/meta.json`,
        JSON.stringify(metadata),
        { access: 'public', contentType: 'application/json', addRandomSuffix: false }
      );
    } catch (storageErr) {
      console.error('Blob storage error (non-fatal):', storageErr);
      // If blob storage fails, return the image as a data URL as fallback
      permanentImageUrl = `data:${imageMime};base64,${imageBase64}`;
    }

    return Response.json({ imageUrl: permanentImageUrl, shareId });
  } catch (err) {
    console.error('Generation error:', err);
    // Surface useful error messages for common API issues
    const msg = err.message || '';
    if (msg.includes('API_KEY') || msg.includes('authentication'))
      return jsonError('Preview service configuration error. Please contact support.', 500);
    if (msg.includes('SAFETY') || msg.includes('blocked'))
      return jsonError('The image was blocked by safety filters. Please try a different logo or colour combination.', 422);
    if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED'))
      return jsonError('Preview service is temporarily busy. Please try again in a moment.', 429);
    return jsonError('Something went wrong. Please try again.', 500);
  }
}

function jsonError(message, status) {
  return Response.json({ error: message }, { status });
}
