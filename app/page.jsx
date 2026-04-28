'use client';

import { useState, useRef } from 'react';
import { Upload, Check, Loader2, RefreshCw, Sparkles, Users, Download } from 'lucide-react';

const API_ENDPOINT = '/api/generate';

const SIDES = [
  { key: 'front',     label: 'Front Panel', required: true,  placement: 'front panel, centered prominently' },
  { key: 'leftSide',  label: 'Left Side',   required: false, placement: 'left side mesh panel as a smaller embroidered accent, sitting on top of any stripes' },
  { key: 'rightSide', label: 'Right Side',  required: false, placement: 'right side mesh panel as a smaller embroidered accent, sitting on top of any stripes' },
];

const QUICK_COLORS = [
  '#1a1a1a', '#4a4a4a', '#8a8a8a', '#ffffff',
  '#1a2b4a', '#2d4a2b', '#5a3a1a', '#bfa57a',
  '#a8442a', '#a83232', '#c97a2a', '#e8dcc4',
];

const STRIPE_OPTIONS = [0, 1, 2, 3];

const CAP_PARTS = [
  { key: 'front',    label: 'Front' },
  { key: 'mesh',     label: 'Mesh' },
  { key: 'brim',     label: 'Brim' },
  { key: 'snapback', label: 'Snap' },
];

// ── Prompts ─────────────────────────────────────────────────────────────────
const PROMPT = {
  subject: 'Three-quarter front view of a high-crown structured trucker cap at a 30-degree angle from the front-right, eye-level, sitting upright on a flat surface.',
  construction: 'Construction: single continuous front face panel — one solid piece of structured fabric, NO visible centre seam, smooth uninterrupted front. Three rear panels are mesh with visible woven texture. Sharp vertical seam where front meets mesh. Pre-curved brim with downward arc — brim surface is COMPLETELY CLEAN, absolutely NO stitching, NO stitch lines, NO topstitching, NO contrast stitching, NO thread visible anywhere on the brim top or edge. Smooth uninterrupted fabric only. Squatchee button on top. Snapback closure at back.',
  logoLockdown: 'CRITICAL LOGO RULE: The provided reference image IS the logo. It must appear on the front panel as an EXACT pixel-perfect copy — identical shapes, colours, text characters, and proportions. Do NOT redraw, reinterpret, stylise, simplify, or substitute ANY part of the logo. Do NOT invent additional graphics, text, badges, or patches. Every logo on the cap is rendered as 3D puff embroidery — visibly raised above the cap surface with real physical depth and elevation. Individual thread stitches are visible in the embroidery. Each embroidered element casts a natural shadow onto the cap fabric beneath it.',
  avoid: 'Avoid: flat brim, low-profile, baseball or fitted cap, dad hat, mesh on front panel, panel bleeding, multiple caps, model, person, hands, mannequin, extra brims, busy or coloured background, props, harsh shadows, lens flare, cartoon, illustration, sketch, stitching on brim, topstitching on brim, stitch lines on brim, contrast stitching, flat printed logos, screen printed logos.',
  lighting: 'Lighting: soft directional studio light from upper-left, gentle shadows on crown right side and under brim. Soft-box quality, no glare, no coloured gels.',
  background: 'Background: pure white seamless studio backdrop, barely-perceptible cool gradient near the bottom. Soft natural contact shadow beneath the cap, diffuse not hard-edged. No props, no other objects.',
  style: 'Style: 85mm lens at f/4, shallow depth of field with cap fully sharp. Ultra detail, fabric and mesh texture visible, 3D embroidery depth and thread texture visible. Clean ecommerce product photography.',
};

const MODEL_TYPES = [
  { key: 'male',   label: 'Men',   prompt: 'Portrait of a rugged Australian country man in his 30s wearing a trucker cap. Weathered, sun-tanned face, relaxed confident expression. Simple work shirt. Standing outdoors in the Australian outback — red dirt, dry golden grass, sparse gum trees, clear blue sky. The cap logo faces the camera and is clearly readable. Natural golden-hour sunlight. Shot on 85mm lens, shallow depth of field, person and cap sharp, background softly blurred.' },
  { key: 'female', label: 'Women', prompt: 'Portrait of a young Australian country woman in her late 20s wearing a trucker cap. Natural sun-kissed look, warm genuine smile. Simple casual top. Standing outdoors in the Australian outback — red earth, golden grassland, scattered eucalyptus trees, wide open sky. The cap logo faces the camera and is clearly readable. Natural golden-hour sunlight. Shot on 85mm lens, shallow depth of field, person and cap sharp, background softly blurred.' },
  { key: 'child',  label: 'Kids',  prompt: 'Portrait of a cheerful Australian country kid around 10 years old wearing a trucker cap. Big natural grin, sun-tanned face. Simple t-shirt. Standing outdoors in the Australian outback — red dust, dry golden grass, gum trees, bright blue sky. The cap logo faces the camera and is clearly readable. Warm afternoon sunlight. Shot on 85mm lens, shallow depth of field, child and cap sharp, background softly blurred.' },
];

export default function CapMockupGenerator() {
  const [designs, setDesigns] = useState({ front: null, leftSide: null, rightSide: null });
  const [colors, setColors] = useState({ front: '#1a1a1a', mesh: '#1a1a1a', brim: '#1a1a1a', snapback: '#1a1a1a' });
  const [stripeCount, setStripeCount] = useState(0);
  const [stripeColor, setStripeColor] = useState('#ffffff');
  const [sandwichBrim, setSandwichBrim] = useState(false);
  const [sandwichColor, setSandwichColor] = useState('#c2410c');
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState(null);
  const [generatingModels, setGeneratingModels] = useState(false);
  const [modelProgress, setModelProgress] = useState('');
  const [modelShots, setModelShots] = useState(null);
  const fileInputRefs = useRef({});

  const handleFile = (sideKey, file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Please upload an image file.'); return; }
    const reader = new FileReader();
    reader.onload = (e) => setDesigns(prev => ({ ...prev, [sideKey]: { file, preview: e.target.result } }));
    reader.readAsDataURL(file);
  };
  const clearDesign = (sideKey) => setDesigns(prev => ({ ...prev, [sideKey]: null }));
  const canGenerate = !!designs.front && !generating;
  const setColor = (part, value) => setColors(prev => ({ ...prev, [part]: value }));
  const matchAllToFront = () => setColors({ front: colors.front, mesh: colors.front, brim: colors.front, snapback: colors.front });

  const buildColourLine = () => {
    let line = `Front panel: ${colors.front}. Mesh panels: ${colors.mesh}. Brim: ${colors.brim}. Snapback: ${colors.snapback}.`;
    if (sandwichBrim) line += ` Sandwich brim — contrasting ${sandwichColor} layer visible along the underside edge of the brim.`;
    return line;
  };

  const buildPrompt = () => {
    const stripeLine = stripeCount === 0
      ? 'No stripes — clean unbroken mesh on sides.'
      : `${stripeCount} horizontal sewn-in flat ribbon stripe${stripeCount > 1 ? 's' : ''} in ${stripeColor} on each side mesh panel, parallel to brim. Tightly grouped — 3-4mm gap between stripes, almost touching. Middle third of panel height, symmetrical. Flat ribbon tape through mesh.`;
    const sideMentions = [];
    if (designs.leftSide) sideMentions.push('smaller 3D embroidered logo on LEFT side mesh panel near the front-mesh seam');
    if (designs.rightSide) sideMentions.push('smaller 3D embroidered logo on RIGHT side mesh panel near the front-mesh seam');
    const sideLogoLine = sideMentions.length > 0
      ? `Also: ${sideMentions.join(', and ')}. Each side logo reproduced exactly from its reference, rendered as raised 3D puff embroidery with visible thread texture, sitting on top of any stripes.`
      : '';
    return [PROMPT.subject, PROMPT.construction, buildColourLine(), PROMPT.logoLockdown, sideLogoLine, stripeLine, PROMPT.lighting, PROMPT.background, PROMPT.style, PROMPT.avoid].filter(Boolean).join(' ');
  };

  const buildModelPrompt = (mt) => {
    let capDesc = `The trucker cap has a ${colors.front} front panel, ${colors.mesh} mesh sides, ${colors.brim} brim, and ${colors.snapback} snapback. Single-piece structured front, pre-curved brim with no stitching visible on brim.`;
    if (sandwichBrim) capDesc += ` Sandwich brim with ${sandwichColor} underside edge.`;
    const stripePart = stripeCount === 0 ? '' : ` ${stripeCount} thin horizontal ${stripeColor} stripe${stripeCount > 1 ? 's' : ''} on each side panel, tightly grouped.`;
    return `${mt.prompt} ${capDesc}${stripePart} CRITICAL: the cap front panel displays the provided logo as an EXACT pixel-perfect copy — same shapes, colours, text. Do NOT invent a different logo. The logo is rendered as 3D puff embroidery with visible raised depth and thread texture. The logo must be clearly visible and readable.`;
  };

  const handleGenerate = async () => {
    if (!designs.front) return;
    setGenerating(true); setResult(null); setModelShots(null);
    try {
      setProgress('Preparing your design…');
      const fd = new FormData();
      fd.append('prompt', buildPrompt());
      fd.append('mode', 'product');
      fd.append('design_front', designs.front.file);
      if (designs.leftSide) fd.append('design_leftSide', designs.leftSide.file);
      if (designs.rightSide) fd.append('design_rightSide', designs.rightSide.file);
      setProgress('Creating your preview…');
      const res = await fetch(API_ENDPOINT, { method: 'POST', body: fd });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Server returned ${res.status}`); }
      setResult(await res.json());
    } catch (err) { alert('Something went wrong: ' + err.message); }
    finally { setGenerating(false); setProgress(''); }
  };

  const handleModelShots = async () => {
    if (!designs.front) return;
    setGeneratingModels(true); setModelShots(null); setModelProgress('Creating lifestyle previews…');
    try {
      const results = await Promise.all(MODEL_TYPES.map(async (mt) => {
        const fd = new FormData();
        fd.append('prompt', buildModelPrompt(mt));
        fd.append('mode', 'model');
        fd.append('design_front', designs.front.file);
        const res = await fetch(API_ENDPOINT, { method: 'POST', body: fd });
        if (!res.ok) { const d = await res.json().catch(() => ({})); return { key: mt.key, label: mt.label, error: d.error || `Failed` }; }
        return { key: mt.key, label: mt.label, imageUrl: (await res.json()).imageUrl };
      }));
      setModelShots(results);
    } catch (err) { alert('Something went wrong: ' + err.message); }
    finally { setGeneratingModels(false); setModelProgress(''); }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: '#f5f1e8', fontFamily: 'Newsreader, serif', color: '#1a1a1a' }}>
      <div className="grain min-h-screen">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="px-6 py-6 md:py-8 max-w-[1440px] mx-auto">
          <div className="text-[10px] tracking-[0.3em] mb-2" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>
            CUSTOM CAP STUDIO
          </div>
          <h1 className="text-4xl md:text-5xl leading-[0.95]" style={{ fontFamily: 'Anton, sans-serif' }}>PREVIEW YOUR CAP</h1>
        </header>

        {/* ── Two-column layout ──────────────────────────────────────── */}
        <div className="max-w-[1440px] mx-auto px-6 pb-12 flex flex-col lg:flex-row gap-6">

          {/* ════ LEFT PANEL — scrollable inputs ═════════════════════ */}
          <div className="w-full lg:w-[440px] xl:w-[480px] flex-shrink-0 space-y-5">

            {/* ── Upload logos ────────────────────────────────────────── */}
            <div className="bg-white border p-4" style={{ borderColor: '#d6d0c0' }}>
              <div className="text-[10px] tracking-[0.2em] mb-3" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>LOGOS</div>
              <div className="space-y-2">
                {SIDES.map(side => {
                  const design = designs[side.key];
                  return (
                    <div key={side.key}
                      onClick={() => fileInputRefs.current[side.key]?.click()}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = '#fef6f0'; }}
                      onDragLeave={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = ''; }}
                      onDrop={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = ''; handleFile(side.key, e.dataTransfer.files?.[0]); }}
                      className="flex items-center gap-3 p-2.5 cursor-pointer rounded-sm transition-colors"
                      style={{ border: `1px ${design ? 'solid' : 'dashed'} ${design ? '#d6d0c0' : side.required ? '#1a1a1a' : '#c4bfb0'}` }}
                    >
                      <input ref={el => fileInputRefs.current[side.key] = el} type="file" accept="image/*" className="hidden"
                        onChange={(e) => handleFile(side.key, e.target.files?.[0])} />
                      {design ? (
                        <>
                          <div className="w-12 h-12 flex items-center justify-center flex-shrink-0 bg-neutral-50 border" style={{ borderColor: '#e8e1cf' }}>
                            <img src={design.preview} alt="" className="max-w-full max-h-full object-contain" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] tracking-[0.15em] flex items-center gap-1" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2d5a2b' }}>
                              {side.label.toUpperCase()} <Check size={10} strokeWidth={3} />
                            </div>
                            <div className="text-xs truncate mt-0.5" style={{ fontFamily: 'Anton, sans-serif' }}>{design.file.name}</div>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); clearDesign(side.key); }}
                            className="text-[10px] hover:underline flex-shrink-0" style={{ color: '#c2410c', fontFamily: 'JetBrains Mono, monospace' }}>✕</button>
                        </>
                      ) : (
                        <>
                          <div className="w-12 h-12 flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#f0ece2' }}>
                            <Upload size={18} strokeWidth={1.5} style={{ color: '#6b6452' }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] tracking-[0.15em]" style={{ fontFamily: 'JetBrains Mono, monospace', color: side.required ? '#c2410c' : '#6b6452' }}>
                              {side.label.toUpperCase()} · {side.required ? 'REQUIRED' : 'OPTIONAL'}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Cap colours ─────────────────────────────────────────── */}
            <div className="bg-white border p-4" style={{ borderColor: '#d6d0c0' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] tracking-[0.2em]" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>CAP COLOURS</div>
                <button onClick={matchAllToFront} className="text-[10px] tracking-wider hover:underline" style={{ color: '#c2410c', fontFamily: 'JetBrains Mono, monospace' }}>
                  MATCH ALL →
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {CAP_PARTS.map(part => (
                  <div key={part.key} className="text-center">
                    <input type="color" value={colors[part.key]} onChange={(e) => setColor(part.key, e.target.value)}
                      className="w-full h-12 cursor-pointer" />
                    <div className="text-[9px] tracking-[0.15em] mt-1.5" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>
                      {part.label.toUpperCase()}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3" style={{ borderTop: '1px solid #f0ece2' }}>
                {QUICK_COLORS.map(c => {
                  const sel = colors.front.toLowerCase() === c.toLowerCase();
                  return (
                    <button key={c} onClick={() => setColor('front', c)} className="w-7 h-7"
                      style={{ backgroundColor: c, border: sel ? '2px solid #c2410c' : '1px solid rgba(0,0,0,0.15)', boxShadow: sel ? '0 0 0 1.5px #f5f1e8 inset' : 'none' }}
                      title={c} />
                  );
                })}
              </div>
            </div>

            {/* ── Stripes ─────────────────────────────────────────────── */}
            <div className="bg-white border p-4" style={{ borderColor: '#d6d0c0' }}>
              <div className="text-[10px] tracking-[0.2em] mb-3" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>SIDE STRIPES</div>
              <div className="flex gap-2 mb-2">
                {STRIPE_OPTIONS.map(n => (
                  <button key={n} onClick={() => setStripeCount(n)}
                    className="flex-1 py-2.5 text-center text-sm transition-colors"
                    style={{
                      fontFamily: 'Anton, sans-serif',
                      letterSpacing: '0.03em',
                      backgroundColor: stripeCount === n ? '#1a1a1a' : 'transparent',
                      color: stripeCount === n ? '#f5f1e8' : '#1a1a1a',
                      border: `1px solid ${stripeCount === n ? '#1a1a1a' : '#d6d0c0'}`,
                    }}>
                    {n === 0 ? 'NONE' : n}
                  </button>
                ))}
              </div>
              {stripeCount > 0 && (
                <div className="flex items-center gap-2 pt-2" style={{ borderTop: '1px solid #f0ece2' }}>
                  <div className="text-[9px] tracking-[0.15em]" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>COLOUR</div>
                  <input type="color" value={stripeColor} onChange={(e) => setStripeColor(e.target.value)} className="w-8 h-8" />
                  <input type="text" value={stripeColor}
                    onChange={(e) => { let v = e.target.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setStripeColor(v); }}
                    className="bg-transparent text-xs w-16 outline-none" style={{ fontFamily: 'JetBrains Mono, monospace' }} maxLength={7} />
                </div>
              )}
            </div>

            {/* ── Sandwich brim ────────────────────────────────────────── */}
            <div className="bg-white border p-4" style={{ borderColor: '#d6d0c0' }}>
              <div className="flex items-center justify-between">
                <div className="text-[10px] tracking-[0.2em]" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>SANDWICH BRIM</div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <span className="text-[10px]" style={{ fontFamily: 'JetBrains Mono, monospace', color: sandwichBrim ? '#c2410c' : '#6b6452' }}>
                    {sandwichBrim ? 'ON' : 'OFF'}
                  </span>
                  <input type="checkbox" checked={sandwichBrim} onChange={(e) => setSandwichBrim(e.target.checked)} />
                </label>
              </div>
              {sandwichBrim && (
                <div className="flex items-center gap-2 mt-3 pt-2" style={{ borderTop: '1px solid #f0ece2' }}>
                  <div className="text-[9px] tracking-[0.15em]" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>UNDERSIDE</div>
                  <input type="color" value={sandwichColor} onChange={(e) => setSandwichColor(e.target.value)} className="w-8 h-8" />
                  <input type="text" value={sandwichColor}
                    onChange={(e) => { let v = e.target.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setSandwichColor(v); }}
                    className="bg-transparent text-xs w-16 outline-none" style={{ fontFamily: 'JetBrains Mono, monospace' }} maxLength={7} />
                </div>
              )}
            </div>

            {/* ── Sticky CTA button ───────────────────────────────────── */}
            <div className="sticky bottom-4 z-10 pt-2">
              <button onClick={handleGenerate} disabled={!canGenerate}
                className="w-full py-4 flex items-center justify-center gap-2 text-lg disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
                style={{
                  backgroundColor: '#c2410c',
                  color: '#ffffff',
                  fontFamily: 'Anton, sans-serif',
                  letterSpacing: '0.08em',
                  border: 'none',
                }}>
                {generating ? (<><Loader2 size={20} className="animate-spin" /> WORKING…</>) : (<><Sparkles size={20} /> CREATE PREVIEW</>)}
              </button>
            </div>
          </div>

          {/* ════ RIGHT PANEL — sticky preview ══════════════════════ */}
          <div className="flex-1 min-w-0">
            <div className="lg:sticky lg:top-6">

              {/* Empty state */}
              {!result && !generating && (
                <div className="border bg-white flex items-center justify-center" style={{ borderColor: '#d6d0c0', minHeight: '400px' }}>
                  <div className="text-center p-8">
                    <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-full" style={{ backgroundColor: '#f0ece2' }}>
                      <Sparkles size={24} style={{ color: '#a39d8d' }} />
                    </div>
                    <p className="text-sm" style={{ color: '#6b6452' }}>
                      Upload a logo and hit <b>Create Preview</b> to see your cap.
                    </p>
                  </div>
                </div>
              )}

              {/* Loading state */}
              {generating && (
                <div className="border bg-white flex items-center justify-center" style={{ borderColor: '#c2410c', minHeight: '400px', backgroundColor: '#fffbf7' }}>
                  <div className="text-center p-8">
                    <Loader2 size={32} className="animate-spin mx-auto mb-4" style={{ color: '#c2410c' }} />
                    <p className="text-sm" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#1a1a1a' }}>{progress}</p>
                    <p className="text-xs mt-2" style={{ color: '#6b6452' }}>Usually takes 15-30 seconds</p>
                  </div>
                </div>
              )}

              {/* Result */}
              {result && !generating && (
                <div className="space-y-4">
                  <div className="border bg-white" style={{ borderColor: '#1a1a1a' }}>
                    <img src={result.imageUrl} alt="Cap preview" className="w-full block" />
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <button onClick={handleGenerate} className="px-4 py-2 border flex items-center gap-1.5 text-sm"
                      style={{ borderColor: '#1a1a1a', fontFamily: 'Anton, sans-serif', letterSpacing: '0.03em' }}>
                      <RefreshCw size={14} /> TRY AGAIN
                    </button>
                    <a href={result.imageUrl} download target="_blank" rel="noopener noreferrer"
                      className="px-4 py-2 flex items-center gap-1.5 text-sm"
                      style={{ backgroundColor: '#1a1a1a', color: '#f5f1e8', fontFamily: 'Anton, sans-serif', letterSpacing: '0.03em', textDecoration: 'none' }}>
                      <Download size={14} /> DOWNLOAD
                    </a>
                  </div>

                  {/* Model shots */}
                  <div className="pt-4" style={{ borderTop: '1px solid #d6d0c0' }}>
                    {!modelShots && !generatingModels && (
                      <button onClick={handleModelShots}
                        className="w-full py-3 flex items-center justify-center gap-2 text-sm"
                        style={{ backgroundColor: '#1a1a1a', color: '#f5f1e8', fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em' }}>
                        <Users size={16} /> SEE IT ON MODELS
                      </button>
                    )}

                    {generatingModels && (
                      <div className="text-center py-6">
                        <Loader2 size={24} className="animate-spin mx-auto mb-3" style={{ color: '#c2410c' }} />
                        <p className="text-xs" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{modelProgress}</p>
                        <p className="text-xs mt-1" style={{ color: '#6b6452' }}>Creating 3 lifestyle previews (30-45 sec)</p>
                      </div>
                    )}

                    {modelShots && !generatingModels && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                          {modelShots.map(shot => (
                            <div key={shot.key} className="border bg-white" style={{ borderColor: '#d6d0c0' }}>
                              {shot.imageUrl ? (
                                <img src={shot.imageUrl} alt={shot.label} className="w-full block" />
                              ) : (
                                <div className="aspect-square flex items-center justify-center p-2" style={{ backgroundColor: '#fdf0f0' }}>
                                  <p className="text-[10px] text-center" style={{ color: '#a83232' }}>Failed</p>
                                </div>
                              )}
                              <div className="px-2 py-1 text-center" style={{ borderTop: '1px solid #f0ece2' }}>
                                <span className="text-[9px] tracking-[0.15em]" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>{shot.label.toUpperCase()}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <button onClick={handleModelShots} className="px-3 py-1.5 border flex items-center gap-1 text-xs"
                            style={{ borderColor: '#1a1a1a', fontFamily: 'Anton, sans-serif', letterSpacing: '0.03em' }}>
                            <RefreshCw size={12} /> RETRY
                          </button>
                          {modelShots.filter(s => s.imageUrl).map(shot => (
                            <a key={shot.key} href={shot.imageUrl} download target="_blank" rel="noopener noreferrer"
                              className="px-3 py-1.5 flex items-center gap-1 text-xs"
                              style={{ backgroundColor: '#1a1a1a', color: '#f5f1e8', fontFamily: 'JetBrains Mono, monospace', textDecoration: 'none' }}>
                              {shot.label.toUpperCase()}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
