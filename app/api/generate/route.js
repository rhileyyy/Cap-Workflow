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

// buildAutoPrompt defined inline here to avoid stale module cache issues
function buildAutoPrompt(s) {
  const hasSide = s.hasSideLeft || s.hasSideRight;
  const sideLogos = [];
  if (s.hasSideLeft)  sideLogos.push('LEFT side mesh panel');
  if (s.hasSideRight) sideLogos.push('RIGHT side mesh panel');

  const imageRefs = hasSide
    ? 'Image 1 is the FRONT PANEL LOGO. Image 2 is also the FRONT PANEL LOGO (emphasis). Image 3 is the SIDE PANEL DESIGN. Image 4 is also the SIDE PANEL DESIGN (emphasis). '
    : 'Image 1 is the FRONT PANEL LOGO. Image 2 is also the FRONT PANEL LOGO (emphasis). ';

  const sideInstruction = sideLogos.length > 0
    ? `Images 3 and 4 are both the SIDE PANEL DESIGN (same design for emphasis). Reproduce it EXACTLY on the ${sideLogos.join(' and ')} in the BOTTOM THIRD of the mesh panel, on top of the stripes — every shape, letter, colour, and detail must match precisely, including any white or light-coloured elements which must be reproduced as-is and NOT filled in or simplified. Raised 3D embroidery with visible stitches.`
    : '';

  // Rotate through distinct design directions so Try Again always produces
  // a meaningfully different colour combination and construction choice.
  const directions = [
    'Choose a bold dark cap with high contrast elements.',
    'Choose a lighter, neutral-toned cap with subtle complementary accents.',
    'Choose a vibrant colour that echoes a dominant colour from the logo.',
    'Choose a classic two-tone combination — contrasting front and mesh colours.',
    'Choose an understated monochrome look with a single accent stripe.',
    'Choose a warm earthy tone palette that complements the logo.',
    'Choose a cool-toned palette — navy, slate, or grey family.',
    'Be bold — choose an unexpected but commercially attractive colour combination.',
  ];
  const direction = directions[s.variationSeed % directions.length];

  const parts = [
    imageRefs + 'Realistic professional 3/4 view product mock of a 5 panel trucker cap, subject rotated 45 degrees to the left. PURE WHITE background — solid bright white (#ffffff), not grey, not off-white. Soft natural shadow directly beneath the cap only. No models, no hands, no props.',
    'High crown structured front panel — solid square face, single piece of fabric, no visible centre seam. Mesh rear panels with clearly visible woven honeycomb texture. Clean sharp seam where solid front meets mesh sides. Pre-curved brim, smooth clean edge with absolutely no stitching, no topstitching, no stitch lines visible on the brim surface at all. Squatchee button on top crown. Snapback closure at rear.',
    `Analyse Image 1 carefully. Based on the colours, style, and brand aesthetic of Image 1, choose the ideal cap colours: front panel, mesh, brim, and snapback. ${direction} Always include sewn side stripes — place them in the BOTTOM THIRD of the mesh panels close to the brim edge, NOT in the middle. Choose stripe count (1, 2, or 3) and colour that best complements the design. Decide whether a sandwich brim would complement the look. Make choices a professional cap designer would make.`,
    'All embroidery is 3D puff raised above the cap surface with real physical elevation. Black outlined embroidery on all positions. Individual thread stitches clearly visible. Each embroidered element casts a shadow onto the cap fabric beneath it.',
    'Image 1 is the front logo. Embroider Image 1 on the crown EXACTLY as shown — same shapes, same text, same proportions, same colours. Do NOT redraw, reinvent, simplify or substitute any part of Image 1. Image 2 confirms this — both are the same front logo.',
    sideInstruction,
    'Exclude: models, persons, hands, mannequins, multiple caps, extra brims, grey background, coloured background, busy background, props, lens flare, flat printed logos, screen printed logos, stitching on brim surface, low-profile cap, baseball cap, fitted cap, dad hat.',
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
    const formData    = await request.formData();
    const mode        = formData.get('mode') || 'product';
    const modelKey    = formData.get('modelKey') || 'male';
    const frontFile   = formData.get('design_front');
    const leftFile    = formData.get('design_leftSide');
    const rightFile   = formData.get('design_rightSide');
    const capImageUrl = formData.get('cap_image_url') || null; // rendered cap for model shots

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
      variationSeed: Number(formData.get('variationSeed') || 0),
    };

    if (!frontFile || frontFile.size === 0) {
      return jsonError('Missing front design.', 400);
    }

    // Build prompt server-side
    const prompt = mode === 'model' ? buildModelPrompt(modelKey, settings)
                 : mode === 'auto'  ? buildAutoPrompt(settings)
                 :                    buildProductPrompt(settings);

    // Convert logo files to base64 (with in-memory cache for re-generates)
    const frontImg = await fileToBase64Cached(frontFile);

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
          // Fallback to logo-only if cap image fetch fails
          parts.push({ text: prompt });
          parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
          parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
        }
      } else {
        // No cap image provided — fall back to logo-based approach
        parts.push({ text: prompt });
        parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
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
      const refFilename = settings.stripeCount === 1 ? 'cap-1stripe.jpg'
                        : settings.stripeCount === 2 ? 'cap-2stripe.jpg'
                        : settings.stripeCount === 3 ? 'cap-3stripe.jpg'
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
      // Slot order: reference cap → prompt → front logo × 2 → side logo × 2
      // The reference cap is the base image being edited — it comes FIRST
      // so Gemini treats it as the canvas, not as an inspiration image.
      const hasSide = settings.hasSideLeft || settings.hasSideRight;
      const sideFile = settings.hasSideLeft ? leftFile
                     : settings.hasSideRight ? rightFile
                     : null;
      const sideImg = sideFile ? await fileToBase64Cached(sideFile) : null;

      // Slot naming for the prompt
      // ref cap = Image 1, front logo = Image 2 (+ 3 emphasis), side = Image 4 (+ 5 emphasis)
      const imageRefs = hasSide
        ? 'Image 1 is the REFERENCE CAP to edit. Image 2 and Image 3 are both the FRONT PANEL LOGO. Image 4 and Image 5 are both the SIDE PANEL DESIGN. '
        : 'Image 1 is the REFERENCE CAP to edit. Image 2 and Image 3 are both the FRONT PANEL LOGO. ';

      // Reference cap first (the canvas)
      if (refPart) parts.push(refPart);

      // Prompt
      parts.push({ text: imageRefs + prompt });

      // Front logo × 2
      parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });
      parts.push({ inlineData: { mimeType: frontImg.mimeType, data: frontImg.data } });

      // Side design × 2 if uploaded
      if (sideImg) {
        parts.push({ inlineData: { mimeType: sideImg.mimeType, data: sideImg.data } });
        parts.push({ inlineData: { mimeType: sideImg.mimeType, data: sideImg.data } });
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
          thinkingLevel: 'minimal',
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
