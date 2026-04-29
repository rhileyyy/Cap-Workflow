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
import sharp from 'sharp';
import { buildProductPrompt, buildModelPrompt } from '../../../lib/prompts.js';

// buildAutoPrompt defined inline here to avoid stale module cache issues
function buildAutoPrompt(s) {
  const hasSide = s.hasSide;
  const sideLogos = [];
  if (s.hasSide) sideLogos.push('side mesh panel');

  const imageRefs = hasSide
    ? 'Image 1 is the REFERENCE CAP to edit. Image 2 is the FRONT PANEL LOGO. Image 3 is the SIDE PANEL DESIGN. '
    : 'Image 1 is the REFERENCE CAP to edit. Image 2 is the FRONT PANEL LOGO. ';

  const sideInstruction = sideLogos.length > 0
    ? `Image 3 is the SIDE PANEL DESIGN. Reproduce it EXACTLY on the ${sideLogos.join(' and ')} in the lower mesh area, on top of any stripes — every shape, letter, colour, and detail must match precisely, including any white or light-coloured elements which must NOT be filled in or simplified. Raised 3D embroidery with visible stitches. The side design must be embroidered SMALL — it is a small accent badge, approximately 1/5 to 1/4 the size of the front panel logo. Do NOT scale it to fill the side mesh panel.`
    : '';

  // Colour-direction cycling — varies each Try Again
  const directions = [
    'Choose a bold dark cap with high contrast elements.',
    'Choose a lighter neutral-toned cap with subtle complementary accents.',
    'Choose a vibrant colour that echoes a dominant colour from the logo.',
    'Choose a classic two-tone — contrasting front and mesh colours.',
    'Choose an understated monochrome with a single accent colour on the stripes.',
    'Choose a warm earthy palette that complements the logo.',
    'Choose a cool-toned palette — navy, slate, or grey family.',
    'Be bold — choose an unexpected but commercially attractive colour combination.',
  ];
  const direction = directions[s.variationSeed % directions.length];

  // Stripe count is already physically in the reference cap photo (Image 1).
  // The AI keeps them and only changes their colour.
  const stripeNote = s.stripeCount > 0
    ? `The reference cap already has ${s.stripeCount} stripe${s.stripeCount > 1 ? 's' : ''} — keep them exactly where they are and choose a complementary stripe colour.`
    : 'The reference cap has no stripes — keep it that way.';

  const parts = [
    imageRefs + 'Edit Image 1, which is a photograph of a blank grey trucker cap. Keep the cap shape, construction, angle, lighting, mesh texture, brim shape, and stripe placement EXACTLY as they are in Image 1. Only make the colour and embroidery changes described below.',
    'Preserve from Image 1 exactly: the crown shape, front panel, mesh panels, brim curve, squatchee button, snapback closure, and any stripe positions. Do not move, add, or remove stripes. No topstitching on the brim.',
    `Analyse the logo in Images 2 and 3. Based on its colours, style, and brand aesthetic, choose the ideal cap colours: front panel, mesh, and brim. ${direction} ${stripeNote} Decide whether a sandwich brim would complement the look. Make choices a professional cap designer would make.`,
    'All logos rendered as 3D puff embroidery raised above the cap surface. Black outlined embroidery on all positions. Individual thread stitches clearly visible.',
    'Images 2 and 3 are the front logo. Embroider it on the centre of the front panel EXACTLY as shown — same shapes, same text, same proportions, same colours. The embroidery should occupy approximately 55–65% of the front panel width, leaving clear breathing room on all sides. Do NOT redraw, simplify, or substitute any part.',
    sideInstruction,
    'Do not change the cap shape or construction. Do not move or add stripes. Do not add stripes to the brim. Do not add topstitching to the brim. Do not add a model or person. Do not change the background.',
  ].filter(Boolean).join(' ');

  return parts;
}

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
    return { data: base64Cache.get(hash), mimeType: file.type || 'image/png', hash };
  }
  const b64 = buffer.toString('base64');
  base64Cache.set(hash, b64);
  return { data: b64, mimeType: file.type || 'image/png', hash };
}

// ── Result cache ───────────────────────────────────────────────────────────
// Caches rendered image URL+shareId by a hash of all inputs.
// Same logo + same colours + same config = instant free result.
// Resets on cold starts (in-memory only) — that's fine for this use case.
const resultCache = new Map();

function buildCacheKey(mode, frontHash, sideHash, effectiveSettings) {
  if (mode === 'auto') {
    return `auto:${frontHash}:${sideHash}:${effectiveSettings.variationSeed}`;
  }
  const { colors, stripeCount, stripeColor, sandwichBrim, sandwichColor } = effectiveSettings;
  return [`product`, frontHash, sideHash, colors.front, colors.mesh, colors.brim,
          stripeCount, stripeColor, sandwichBrim, sandwichColor].join(':');
}

// ── Logo scaling ───────────────────────────────────────────────────────────
// Resize logos before sending to Gemini. The model reads relative image
// dimensions as a placement signal — smaller input = smaller embroidery output.
//
//   Front logo: 420px  → places as ~55-65% of front panel width
//   Side logo:  280px  → places as a small accent badge
//
// Both are proportionally smaller than the 1024px reference cap so the
// model naturally scales the embroidery to match.
const scaledCache = new Map();

async function fileToBase64Scaled(file, maxPx = 280) {
  const buffer   = Buffer.from(await file.arrayBuffer());
  const hash     = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const cacheKey = `scaled-${maxPx}-${hash}`;
  if (scaledCache.has(cacheKey)) {
    return { data: scaledCache.get(cacheKey), mimeType: 'image/png', hash };
  }
  try {
    const resized = await sharp(buffer)
      .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    const b64 = resized.toString('base64');
    scaledCache.set(cacheKey, b64);
    return { data: b64, mimeType: 'image/png', hash };
  } catch {
    const b64 = buffer.toString('base64');
    return { data: b64, mimeType: file.type || 'image/png', hash };
  }
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
    const formData    = await request.formData();
    const mode        = formData.get('mode') || 'product';
    const modelKey    = formData.get('modelKey') || 'male';
    const frontFile   = formData.get('design_front');
    const sideFile    = formData.get('design_side');
    const capImageUrl = formData.get('cap_image_url') || null;

    // Structured settings — prompt assembled server-side from these
    const settings = {
      colors: {
        front: formData.get('color_front') || '#1a1a1a',
        mesh:  formData.get('color_mesh')  || '#1a1a1a',
        brim:  formData.get('color_brim')  || '#1a1a1a',
      },
      stripeCount:   Number(formData.get('stripeCount') || 0),
      stripeColor:   formData.get('stripeColor')   || '#ffffff',
      sandwichBrim:  formData.get('sandwichBrim')  === 'true',
      sandwichColor: formData.get('sandwichColor') || '#c2410c',
      hasSide:       !!sideFile && sideFile.size > 0,
      variationSeed: Number(formData.get('variationSeed') || 0),
    };

    if (!frontFile || frontFile.size === 0) {
      return jsonError('Missing front design.', 400);
    }

    // Build prompt server-side
    // In auto mode, use variationSeed to determine stripe count (cycles 0→1→2→3→0...)
    // so the reference cap matches what the AI is asked to work with.
    const autoStripeCount = mode === 'auto' ? settings.variationSeed % 4 : settings.stripeCount;
    const effectiveSettings = mode === 'auto'
      ? { ...settings, stripeCount: autoStripeCount }
      : settings;

    const prompt = mode === 'model' ? buildModelPrompt(modelKey, effectiveSettings)
                 : mode === 'auto'  ? buildAutoPrompt(effectiveSettings)
                 :                    buildProductPrompt(effectiveSettings);

    // Scale both logos before sending — smaller input = smaller embroidery output
    // Front: 420px = ~55-65% of front panel. Side: 280px = small accent badge.
    const frontImg    = await fileToBase64Scaled(frontFile, 420);
    const sideImgForKey = settings.hasSide ? await fileToBase64Scaled(sideFile, 280) : null;

    // ── Result cache check ────────────────────────────────────────────────────
    // Skip generation entirely if we've already rendered this exact configuration.
    const cacheKey = buildCacheKey(mode, frontImg.hash, sideImgForKey?.hash || 'none', effectiveSettings);
    if (resultCache.has(cacheKey)) {
      console.log('Cache hit:', cacheKey.slice(0, 40));
      return Response.json(resultCache.get(cacheKey));
    }

    // ── Build the Gemini contents array ────────────────────────────────────
    // Format: [text_part, image_part, image_part, ...]
    // The Google GenAI SDK for JS takes an array of parts in `contents`.
    const parts = [];

    if (mode === 'model') {
      // Model shots: use the already-rendered cap as the primary reference.
      // The model just needs to put this exact cap on a person — no need to
      // rebuild the cap from a text description.
      if (capImageUrl) {
        try {
          const capResp = await fetch(capImageUrl);
          if (capResp.ok) {
            const capBuffer = Buffer.from(await capResp.arrayBuffer());
            const capBase64 = capBuffer.toString('base64');
            const capMime   = capResp.headers.get('content-type') || 'image/jpeg';
            // Slot 1: the rendered cap (primary reference — this is what the person wears)
            parts.push({ text: prompt });
            parts.push({ inlineData: { mimeType: capMime, data: capBase64 } });
            // Slot 2: front logo (for logo accuracy on the worn cap)
            parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
          } else {
            throw new Error('Could not fetch rendered cap');
          }
        } catch {
          // Fallback: logo-only
          parts.push({ text: prompt });
          parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
        }
      } else {
        // No cap image provided — fall back to logo-based approach
        parts.push({ text: prompt });
        parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
      }
    } else {
      // Product and Auto shots — logo as image 1, side logo or emphasis as image 2      // ── Product shot assembly ─────────────────────────────────────────
      // Gemini reads parts sequentially. Putting the prompt FIRST with
      // explicit "image 1 / image 2" references, then the images in that
      // same order, gives the model clear anchors.
      // The base cap reference was causing two problems:
      //   1. Its grey background was bleeding through as the output background
      //   2. It was occupying slot 1 and pushing the logo to slot 2, making
      //      the model treat it as secondary
      // Solution: drop the base cap reference from the parts array.
      // The prompt language already describes the cap construction fully.

      // ── Pick the correct reference cap based on stripe count ─────────────
      // These are real photographs of blank caps with the correct stripe
      // placement — Gemini edits them rather than generating from scratch.
      const refFilename = effectiveSettings.stripeCount === 1 ? 'cap-1stripe.jpg'
                        : effectiveSettings.stripeCount === 2 ? 'cap-2stripe.jpg'
                        : effectiveSettings.stripeCount === 3 ? 'cap-3stripe.jpg'
                        : 'cap-0stripe.jpg';

      const host     = headersList.get('host') || 'localhost:3000';
      const protocol = host.includes('localhost') ? 'http' : 'https';
      const refUrl   = `${protocol}://${host}/${refFilename}`;

      let refPart = null;
      try {
        const refResp = await fetch(refUrl);
        if (refResp.ok) {
          const refBuffer = Buffer.from(await refResp.arrayBuffer());
          refPart = { inlineData: { mimeType: 'image/jpeg', data: refBuffer.toString('base64') } };
        }
      } catch {
        console.warn('Could not fetch reference cap:', refFilename);
      }

      // ── Assemble parts ────────────────────────────────────────────────────
      // Side logo already pre-scaled to ~280px (computed above for cache key)
      const sideImg = sideImgForKey;

      // Image numbering: ref cap = 1, front logo = 2, side design = 3 (if uploaded)
      const imageRefs = settings.hasSide
        ? 'Image 1 is the REFERENCE CAP to edit. Image 2 is the FRONT PANEL LOGO. Image 3 is the SIDE PANEL DESIGN. '
        : 'Image 1 is the REFERENCE CAP to edit. Image 2 is the FRONT PANEL LOGO. ';

      if (refPart) parts.push(refPart);
      parts.push({ text: imageRefs + prompt });
      parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } }); // Image 2

      if (sideImg) {
        parts.push({ inlineData: { mimeType: sideImg.mimeType, data: sideImg.data } }); // Image 3
      }
    }

    // ── Call Nano Banana 2 ─────────────────────────────────────────────────
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: '1:1',
          imageSize: '1k',
        },
        // Note: thinkingConfig removed — conflicts with imageConfig in SDK 1.x
        // The model still uses thinking internally at its default level
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

    const result = { imageUrl: permanentImageUrl, shareId };
    // Cache the result so identical requests return instantly
    resultCache.set(cacheKey, result);
    return Response.json(result);
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
