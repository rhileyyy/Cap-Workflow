'use client';

import { useState, useRef } from 'react';
import { Upload, Check, Loader2, RefreshCw, Sparkles, Users } from 'lucide-react';

const API_ENDPOINT = '/api/generate';

const SIDES = [
  { key: 'front',     label: 'Front Panel', required: true,  placement: 'front panel, centered prominently' },
  { key: 'leftSide',  label: 'Left Side',   required: false, placement: 'left side mesh panel as a smaller highly detailed 3D embroidered accent, sitting on top of any stripes' },
  { key: 'rightSide', label: 'Right Side',  required: false, placement: 'right side mesh panel as a smaller highly detailed 3D embroidered accent, sitting on top of any stripes' },
];

const QUICK_COLORS = [
  '#1a1a1a', '#4a4a4a', '#8a8a8a', '#ffffff',
  '#1a2b4a', '#2d4a2b', '#5a3a1a', '#bfa57a',
  '#a8442a', '#a83232', '#c97a2a', '#e8dcc4',
];

const STRIPE_OPTIONS = [0, 1, 2, 3];

// ── Cap part definitions for colour pickers ─────────────────────────────────
const CAP_PARTS = [
  { key: 'front',    label: 'Front Panel' },
  { key: 'mesh',     label: 'Mesh Panels' },
  { key: 'brim',     label: 'Brim' },
  { key: 'snapback', label: 'Snapback' },
];

// ============================================================================
// PRODUCT SHOT PROMPT
// ============================================================================
const PROMPT = {
  subject: 'Three-quarter front view of a high-crown structured trucker cap, photographed at a 30-degree angle from the front-right, eye-level, sitting upright on a flat surface.',

  construction: 'Construction: a single continuous front face panel — one solid piece of structured fabric, NO visible vertical centre seam, smooth uninterrupted front from brim to crown. The three rear panels are clearly mesh with visible woven texture. Sharp clean vertical seam where the structured front meets the mesh sides. Pre-curved brim with downward arc and a clean smooth edge — NO visible decorative topstitching on the brim surface. Small fabric squatchee button on top centre. Visible snapback closure at the back.',

  logoLockdown: 'CRITICAL: the provided front design is the ONLY decoration on the front panel. Reproduce it EXACTLY — same shapes, colours, proportions, text characters. Do NOT invent, modify, redraw, stylise, or add to the logo. Do NOT add extra graphics, logos, text, badges, or patches anywhere. Do NOT duplicate the logo. Render as highly detailed raised dimensional embroidery with visible thread texture and soft shadow on the fabric. Centre the logo on the front panel.',

  avoid: 'Avoid: flat brim, low-profile, baseball or fitted cap, dad hat, mesh on front panel, panel bleeding, multiple caps, model, person, hands, mannequin, extra brims, busy or coloured background, props, harsh shadows, lens flare, cartoon, illustration, sketch.',

  lighting: 'Lighting: soft directional studio light from upper-left, gentle shadows on the right of the crown, subtle shadow under the brim. Soft-box quality, no glare, no rim lighting, no coloured gels.',

  background: 'Background: pure white seamless studio backdrop, barely-perceptible cool gradient near the bottom. Soft natural contact shadow directly beneath the cap, diffuse not hard-edged. No props, no other objects.',

  style: 'Style: 85mm lens at f/4, shallow depth of field with the cap fully sharp. Ultra detail, fabric texture and mesh weave clearly visible, embroidery thread depth visible. Ecommerce product photography, clean catalogue look.',
};

// ============================================================================
// MODEL SHOT PROMPTS
// ============================================================================
const MODEL_TYPES = [
  {
    key: 'male',
    label: 'Men',
    prompt: 'Portrait of a rugged Australian country man in his 30s wearing a trucker cap. Weathered, sun-tanned face, relaxed confident expression. Simple work shirt. Standing outdoors in the Australian outback — red dirt, dry golden grass, sparse gum trees, clear blue sky. The cap logo faces the camera and is clearly readable. Natural golden-hour sunlight. Shot on 85mm lens, shallow depth of field, person and cap sharp, background softly blurred. Authentic rural Australian feel.',
  },
  {
    key: 'female',
    label: 'Women',
    prompt: 'Portrait of a young Australian country woman in her late 20s wearing a trucker cap. Natural sun-kissed look, warm genuine smile. Simple casual top. Standing outdoors in the Australian outback — red earth, golden grassland, scattered eucalyptus trees, wide open sky. The cap logo faces the camera and is clearly readable. Natural golden-hour sunlight. Shot on 85mm lens, shallow depth of field, person and cap sharp, background softly blurred. Authentic rural Australian feel.',
  },
  {
    key: 'child',
    label: 'Kids',
    prompt: 'Portrait of a cheerful Australian country kid around 10 years old wearing a trucker cap. Big natural grin, sun-tanned face. Simple casual t-shirt. Standing outdoors in the Australian outback — red dust, dry golden grass, a few gum trees, bright blue sky. The cap logo faces the camera and is clearly readable. Natural warm afternoon sunlight. Shot on 85mm lens, shallow depth of field, child and cap sharp, background softly blurred. Authentic rural Australian feel.',
  },
];

export default function CapMockupGenerator() {
  const [designs, setDesigns] = useState({ front: null, leftSide: null, rightSide: null });
  // Separate colours for each cap part
  const [colors, setColors] = useState({
    front: '#1a1a1a',
    mesh: '#1a1a1a',
    brim: '#1a1a1a',
    snapback: '#1a1a1a',
  });
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
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (PNG with transparent background works best).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => setDesigns(prev => ({ ...prev, [sideKey]: { file, preview: e.target.result } }));
    reader.readAsDataURL(file);
  };

  const clearDesign = (sideKey) => setDesigns(prev => ({ ...prev, [sideKey]: null }));
  const canGenerate = !!designs.front && !generating;

  const setColor = (part, value) => {
    setColors(prev => ({ ...prev, [part]: value }));
  };

  const matchAllToFront = () => {
    setColors({ front: colors.front, mesh: colors.front, brim: colors.front, snapback: colors.front });
  };

  // ── Colour description for prompts ────────────────────────────────────
  const buildColourLine = () => {
    let line = `Front panel colour: ${colors.front}. Mesh side and back panels: ${colors.mesh}. Brim colour: ${colors.brim}. Snapback closure colour: ${colors.snapback}.`;
    if (sandwichBrim) {
      line += ` The brim has a sandwich brim — a contrasting colour layer of ${sandwichColor} visible along the underside edge of the brim, creating a two-tone brim effect.`;
    }
    return line;
  };

  // ── Product shot prompt ───────────────────────────────────────────────
  const buildPrompt = () => {
    const stripeLine = stripeCount === 0
      ? 'No stripes — clean unbroken mesh on the side panels.'
      : `${stripeCount} horizontal sewn-in flat ribbon stripe${stripeCount > 1 ? 's' : ''} in colour ${stripeColor} on each side mesh panel, running parallel to the brim. Stripes tightly grouped — only 3-4mm gap between adjacent stripes, almost touching. Middle third of panel height, symmetrical on both sides. Flat ribbon tape through mesh.`;
    const sideMentions = [];
    if (designs.leftSide)  sideMentions.push('smaller highly detailed 3D embroidered logo on the LEFT side mesh panel near the front-mesh seam');
    if (designs.rightSide) sideMentions.push('smaller highly detailed 3D embroidered logo on the RIGHT side mesh panel near the front-mesh seam');
    const sideLogoLine = sideMentions.length > 0
      ? `Also: ${sideMentions.join(', and ')}. Each side logo reproduced exactly, 3D embroidered, sitting on top of any stripes.`
      : 'No side panel logos.';

    return [
      PROMPT.subject, PROMPT.construction, buildColourLine(), PROMPT.logoLockdown,
      sideLogoLine, stripeLine, PROMPT.lighting, PROMPT.background, PROMPT.style, PROMPT.avoid,
    ].join(' ');
  };

  // ── Model shot prompt ─────────────────────────────────────────────────
  const buildModelPrompt = (modelType) => {
    let capDesc = `The trucker cap has a ${colors.front} front panel, ${colors.mesh} mesh sides, ${colors.brim} brim, and ${colors.snapback} snapback closure. Single-piece structured front, pre-curved brim with no topstitching.`;
    if (sandwichBrim) {
      capDesc += ` The brim has a ${sandwichColor} sandwich brim layer visible along its underside edge.`;
    }
    const stripePart = stripeCount === 0
      ? ''
      : ` The cap has ${stripeCount} thin horizontal ${stripeColor} stripe${stripeCount > 1 ? 's' : ''} on each side panel, tightly grouped.`;
    const logoInstruction = 'CRITICAL: the cap front panel displays the provided logo design EXACTLY as given — same shapes, colours, text. Do NOT invent a different logo. The logo must be clearly visible and readable.';
    return `${modelType.prompt} ${capDesc}${stripePart} ${logoInstruction}`;
  };

  // ── Product shot handler ──────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!designs.front) { alert('Please upload at least a front-panel logo.'); return; }
    setGenerating(true);
    setResult(null);
    setModelShots(null);

    try {
      setProgress('Preparing your design…');
      const formData = new FormData();
      formData.append('prompt', buildPrompt());
      formData.append('mode', 'product');
      formData.append('design_front', designs.front.file);
      if (designs.leftSide)  formData.append('design_leftSide',  designs.leftSide.file);
      if (designs.rightSide) formData.append('design_rightSide', designs.rightSide.file);

      setProgress('Creating your preview…');
      const res = await fetch(API_ENDPOINT, { method: 'POST', body: formData });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server returned ${res.status}`);
      }
      setResult(await res.json());
    } catch (err) {
      alert('Something went wrong: ' + err.message);
    } finally {
      setGenerating(false);
      setProgress('');
    }
  };

  // ── Model shots handler ───────────────────────────────────────────────
  const handleModelShots = async () => {
    if (!designs.front) return;
    setGeneratingModels(true);
    setModelShots(null);
    setModelProgress('Creating lifestyle previews…');

    try {
      const results = await Promise.all(MODEL_TYPES.map(async (mt) => {
        const formData = new FormData();
        formData.append('prompt', buildModelPrompt(mt));
        formData.append('mode', 'model');
        formData.append('design_front', designs.front.file);
        const res = await fetch(API_ENDPOINT, { method: 'POST', body: formData });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          return { key: mt.key, label: mt.label, error: errData.error || `Failed (${res.status})` };
        }
        return { key: mt.key, label: mt.label, imageUrl: (await res.json()).imageUrl };
      }));
      setModelShots(results);
    } catch (err) {
      alert('Something went wrong with lifestyle previews: ' + err.message);
    } finally {
      setGeneratingModels(false);
      setModelProgress('');
    }
  };

  // ── Sub-components ────────────────────────────────────────────────────
  const SectionHeader = ({ num, title, subtitle }) => (
    <div className="flex items-baseline gap-4 mb-6 pb-4 border-b" style={{ borderColor: '#1a1a1a' }}>
      <span className="text-xs tracking-[0.2em]" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#c2410c' }}>
        {String(num).padStart(2, '0')}
      </span>
      <div className="flex-1">
        <h2 className="text-3xl leading-none" style={{ fontFamily: 'Anton, sans-serif', letterSpacing: '0.02em' }}>{title}</h2>
        {subtitle && <p className="text-sm mt-2" style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic', color: '#6b6452' }}>{subtitle}</p>}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: '#f5f1e8', fontFamily: 'Newsreader, serif', color: '#1a1a1a' }}>
      <div className="grain min-h-screen">
        <div className="max-w-5xl mx-auto px-6 py-10">

          <header className="mb-12 pb-8 border-b" style={{ borderColor: '#1a1a1a' }}>
            <div className="flex items-end justify-between gap-6 flex-wrap">
              <div>
                <div className="text-xs tracking-[0.25em] mb-3" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>
                  CUSTOM CAP STUDIO / PREVIEW TOOL
                </div>
                <h1 className="text-6xl md:text-7xl leading-[0.95]" style={{ fontFamily: 'Anton, sans-serif', letterSpacing: '0.01em' }}>PREVIEW YOUR CAP</h1>
                <p className="mt-4 text-lg max-w-xl leading-relaxed" style={{ fontStyle: 'italic', color: '#3d3829' }}>
                  Upload your logos, choose your colours and stripe count, and see how your custom trucker cap would look.
                </p>
              </div>
            </div>
          </header>

          {/* 01 — Upload logos */}
          <section className="mb-12">
            <SectionHeader num={1} title="Upload your logos" subtitle="Front is required. Left and right side logos are optional." />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {SIDES.map(side => {
                const design = designs[side.key];
                return (
                  <div key={side.key}
                    onClick={() => fileInputRefs.current[side.key]?.click()}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = 'rgba(194,65,12,0.05)'; }}
                    onDragLeave={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = design ? '#ffffff' : 'transparent'; }}
                    onDrop={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = design ? '#ffffff' : 'transparent'; handleFile(side.key, e.dataTransfer.files?.[0]); }}
                    className="upload-tile cursor-pointer p-4 flex items-center gap-4 min-h-[7.5rem]"
                    style={{
                      border: design ? `1px solid #1a1a1a` : `2px dashed ${side.required ? '#1a1a1a' : '#a39d8d'}`,
                      backgroundColor: design ? '#ffffff' : 'transparent',
                    }}
                  >
                    <input ref={el => fileInputRefs.current[side.key] = el} type="file" accept="image/*" className="hidden"
                      onChange={(e) => handleFile(side.key, e.target.files?.[0])} />
                    {design ? (
                      <>
                        <div className="w-20 h-20 flex items-center justify-center bg-white flex-shrink-0" style={{ border: '1px solid #d6d0c0' }}>
                          <img src={design.preview} alt={side.label} className="max-w-full max-h-full object-contain" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] tracking-[0.2em] mb-1 flex items-center gap-1" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2d5a2b' }}>
                            {side.label.toUpperCase()} <Check size={11} strokeWidth={3} />
                          </div>
                          <div className="text-sm truncate" style={{ fontFamily: 'Anton, sans-serif', letterSpacing: '0.02em' }}>{design.file.name}</div>
                          <button onClick={(e) => { e.stopPropagation(); clearDesign(side.key); }}
                            className="mt-1 text-[11px] underline-offset-2 hover:underline"
                            style={{ color: '#c2410c', fontFamily: 'JetBrains Mono, monospace' }}>
                            REMOVE
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-20 h-20 flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#e8e1cf' }}>
                          <Upload size={26} strokeWidth={1.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] tracking-[0.2em] mb-1" style={{ fontFamily: 'JetBrains Mono, monospace', color: side.required ? '#c2410c' : '#6b6452' }}>
                            {side.label.toUpperCase()} · {side.required ? 'REQUIRED' : 'OPTIONAL'}
                          </div>
                          <div className="text-sm" style={{ color: '#3d3829' }}>Drop a PNG or click to browse</div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 02 — Colours & stripes */}
          <section className="mb-12">
            <SectionHeader num={2} title="Customise your cap" subtitle="Pick colours for each part of the cap and choose your stripe count." />

            <div className="space-y-8">
              {/* ── Cap colour cards ─────────────────────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="text-xs tracking-[0.18em]" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>CAP COLOURS</div>
                  <button onClick={matchAllToFront} className="text-xs tracking-wider underline-offset-4 hover:underline" style={{ color: '#c2410c', fontFamily: 'JetBrains Mono, monospace' }}>
                    MATCH ALL TO FRONT →
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {CAP_PARTS.map(part => (
                    <div key={part.key} className="border p-4 bg-white" style={{ borderColor: '#1a1a1a' }}>
                      <div className="text-[10px] tracking-[0.2em] mb-3" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>
                        {part.label.toUpperCase()}
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={colors[part.key]}
                          onChange={(e) => setColor(part.key, e.target.value)}
                          className="w-14 h-14 flex-shrink-0"
                          aria-label={`${part.label} colour picker`}
                        />
                        <input
                          type="text"
                          value={colors[part.key]}
                          onChange={(e) => {
                            let v = e.target.value.trim();
                            if (!v.startsWith('#')) v = '#' + v;
                            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setColor(part.key, v);
                          }}
                          className="bg-transparent text-xs w-full min-w-0 outline-none border-b border-transparent focus:border-orange-700 pb-1"
                          maxLength={7}
                          aria-label={`${part.label} hex value`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Quick picks ───────────────────────────────────────────── */}
              <div>
                <div className="text-xs tracking-[0.18em] mb-3" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>QUICK PICKS · FRONT PANEL</div>
                <div className="flex flex-wrap gap-2">
                  {QUICK_COLORS.map(c => {
                    const selected = colors.front.toLowerCase() === c.toLowerCase();
                    return (
                      <button key={c} onClick={() => setColor('front', c)}
                        className="w-9 h-9"
                        style={{
                          backgroundColor: c,
                          border: selected ? '2px solid #c2410c' : '1px solid #1a1a1a',
                          boxShadow: selected ? '0 0 0 2px #f5f1e8 inset' : 'none',
                        }}
                        title={c}
                        aria-label={`Use front panel colour ${c}`} />
                    );
                  })}
                </div>
              </div>

              <hr className="divider" />

              {/* ── Stripes ───────────────────────────────────────────────── */}
              <div>
                <div className="text-xs tracking-[0.18em] mb-3" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>SEWN SIDE STRIPES</div>
                <div className="flex flex-wrap gap-3 items-stretch">
                  <div className="relative inline-block w-full md:w-60">
                    <select value={stripeCount} onChange={(e) => setStripeCount(Number(e.target.value))}
                      className="w-full h-full px-4 py-3 pr-10 border bg-white text-base cursor-pointer"
                      style={{ borderColor: '#1a1a1a', fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em' }}>
                      {STRIPE_OPTIONS.map(n => (
                        <option key={n} value={n}>
                          {n === 0 ? 'NO STRIPES' : `${n} STRIPE${n > 1 ? 'S' : ''}`}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <svg width="12" height="7" viewBox="0 0 14 8" fill="none">
                        <path d="M1 1L7 7L13 1" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </div>
                  </div>
                  {stripeCount > 0 && (
                    <div className="border bg-white px-3 py-2 flex items-center gap-3" style={{ borderColor: '#1a1a1a' }}>
                      <div className="text-[10px] tracking-[0.2em]" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>STRIPE COLOUR</div>
                      <input type="color" value={stripeColor} onChange={(e) => setStripeColor(e.target.value)}
                        className="w-10 h-10 flex-shrink-0" aria-label="Stripe colour picker" />
                      <input type="text" value={stripeColor}
                        onChange={(e) => { let v = e.target.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setStripeColor(v); }}
                        className="bg-transparent text-xs w-20 outline-none border-b border-transparent focus:border-orange-700 pb-1"
                        maxLength={7} aria-label="Stripe hex value" />
                    </div>
                  )}
                </div>
              </div>

              <hr className="divider" />

              {/* ── Sandwich brim ─────────────────────────────────────────── */}
              <div>
                <div className="text-xs tracking-[0.18em] mb-3" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>SANDWICH BRIM</div>
                <div className="flex flex-wrap gap-3 items-stretch">
                  <label className="flex items-center gap-3 border bg-white px-4 py-3 cursor-pointer select-none"
                    style={{ borderColor: sandwichBrim ? '#c2410c' : '#1a1a1a', backgroundColor: sandwichBrim ? '#fff5ee' : '#ffffff' }}>
                    <input type="checkbox" checked={sandwichBrim} onChange={(e) => setSandwichBrim(e.target.checked)} />
                    <span className="text-sm" style={{ fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em' }}>
                      {sandwichBrim ? 'SANDWICH BRIM ON' : 'ENABLE SANDWICH BRIM'}
                    </span>
                  </label>
                  {sandwichBrim && (
                    <div className="border bg-white px-3 py-2 flex items-center gap-3" style={{ borderColor: '#1a1a1a' }}>
                      <div className="text-[10px] tracking-[0.2em]" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>UNDERSIDE COLOUR</div>
                      <input type="color" value={sandwichColor} onChange={(e) => setSandwichColor(e.target.value)}
                        className="w-10 h-10 flex-shrink-0" aria-label="Sandwich underside colour picker" />
                      <input type="text" value={sandwichColor}
                        onChange={(e) => { let v = e.target.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setSandwichColor(v); }}
                        className="bg-transparent text-xs w-20 outline-none border-b border-transparent focus:border-orange-700 pb-1"
                        maxLength={7} aria-label="Sandwich hex value" />
                    </div>
                  )}
                </div>
                {sandwichBrim && (
                  <p className="text-xs mt-3" style={{ color: '#6b6452', fontStyle: 'italic' }}>
                    A contrasting colour strip visible along the underside edge of the brim.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* 03 — Preview */}
          <section className="mb-12">
            <div className="flex items-center justify-between mb-6 pb-4 border-b flex-wrap gap-3" style={{ borderColor: '#1a1a1a' }}>
              <div className="flex items-baseline gap-4">
                <span className="text-xs tracking-[0.2em]" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#c2410c' }}>03</span>
                <h2 className="text-3xl leading-none" style={{ fontFamily: 'Anton, sans-serif', letterSpacing: '0.02em' }}>PREVIEW</h2>
              </div>
              <button onClick={handleGenerate} disabled={!canGenerate}
                className="px-6 py-3 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#1a1a1a', color: '#f5f1e8', fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em' }}>
                {generating ? (<><Loader2 size={18} className="animate-spin" /> WORKING…</>) : (<><Sparkles size={18} /> CREATE PREVIEW</>)}
              </button>
            </div>

            {generating && (
              <div className="p-6 border" style={{ borderColor: '#c2410c', backgroundColor: '#fff5ee' }}>
                <div className="flex items-center gap-3">
                  <Loader2 size={18} className="animate-spin" style={{ color: '#c2410c' }} />
                  <span className="text-sm" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{progress}</span>
                </div>
                <p className="text-xs mt-3" style={{ color: '#6b6452' }}>
                  Your preview is being created. This usually takes 15-30 seconds.
                </p>
              </div>
            )}

            {result && !generating && (
              <div>
                <div className="border bg-white" style={{ borderColor: '#1a1a1a' }}>
                  <img src={result.imageUrl} alt="Cap preview" className="w-full block" />
                </div>
                <div className="mt-6 flex gap-3 items-center flex-wrap">
                  <button onClick={handleGenerate} className="px-5 py-2 border flex items-center gap-2"
                    style={{ borderColor: '#1a1a1a', fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em' }}>
                    <RefreshCw size={16} /> TRY AGAIN
                  </button>
                  <a href={result.imageUrl} download target="_blank" rel="noopener noreferrer"
                     className="px-5 py-2 flex items-center gap-2"
                     style={{ backgroundColor: '#c2410c', color: '#f5f1e8', fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em', textDecoration: 'none' }}>
                    DOWNLOAD
                  </a>
                  <span className="text-sm" style={{ color: '#6b6452', fontStyle: 'italic' }}>
                    Not happy with the result? Hit try again for a fresh version.
                  </span>
                </div>

                {/* See it on models */}
                <div className="mt-10 pt-8 border-t" style={{ borderColor: '#1a1a1a' }}>
                  <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
                    <div>
                      <h3 className="text-2xl" style={{ fontFamily: 'Anton, sans-serif', letterSpacing: '0.02em' }}>SEE IT IN ACTION</h3>
                      <p className="text-sm mt-1" style={{ fontStyle: 'italic', color: '#6b6452' }}>
                        Preview your cap on real people in the Australian outback.
                      </p>
                    </div>
                    {!modelShots && !generatingModels && (
                      <button onClick={handleModelShots}
                        className="px-6 py-3 flex items-center gap-2"
                        style={{ backgroundColor: '#c2410c', color: '#f5f1e8', fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em' }}>
                        <Users size={18} /> SEE IT ON MODELS
                      </button>
                    )}
                  </div>

                  {generatingModels && (
                    <div className="p-6 border" style={{ borderColor: '#c2410c', backgroundColor: '#fff5ee' }}>
                      <div className="flex items-center gap-3">
                        <Loader2 size={18} className="animate-spin" style={{ color: '#c2410c' }} />
                        <span className="text-sm" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{modelProgress}</span>
                      </div>
                      <p className="text-xs mt-3" style={{ color: '#6b6452' }}>
                        Creating 3 lifestyle previews at once. This usually takes 30-45 seconds.
                      </p>
                    </div>
                  )}

                  {modelShots && !generatingModels && (
                    <div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {modelShots.map((shot) => (
                          <div key={shot.key} className="border bg-white" style={{ borderColor: '#1a1a1a' }}>
                            {shot.imageUrl ? (
                              <img src={shot.imageUrl} alt={`${shot.label} preview`} className="w-full block" />
                            ) : (
                              <div className="aspect-square flex items-center justify-center p-4" style={{ backgroundColor: '#fdf0f0' }}>
                                <p className="text-sm text-center" style={{ color: '#a83232' }}>{shot.error || 'Failed to create this preview'}</p>
                              </div>
                            )}
                            <div className="px-3 py-2 border-t" style={{ borderColor: '#d6d0c0' }}>
                              <span className="text-xs tracking-[0.15em]" style={{ fontFamily: 'Anton, sans-serif', letterSpacing: '0.1em' }}>{shot.label.toUpperCase()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 flex gap-3 items-center flex-wrap">
                        <button onClick={handleModelShots} className="px-5 py-2 border flex items-center gap-2"
                          style={{ borderColor: '#1a1a1a', fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em' }}>
                          <RefreshCw size={16} /> TRY AGAIN
                        </button>
                        {modelShots.filter(s => s.imageUrl).map(shot => (
                          <a key={shot.key} href={shot.imageUrl} download target="_blank" rel="noopener noreferrer"
                            className="px-4 py-2 text-sm flex items-center gap-1"
                            style={{ backgroundColor: '#c2410c', color: '#f5f1e8', fontFamily: 'Anton, sans-serif', letterSpacing: '0.03em', textDecoration: 'none' }}>
                            {shot.label.toUpperCase()}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          <footer className="mt-16 pt-6 border-t" style={{ borderColor: '#d6d0c0' }}>
            <div className="flex justify-end items-center text-xs tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#a39d8d' }}>
              <span>PREVIEW ID: TC-{Date.now().toString().slice(-6)}</span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
