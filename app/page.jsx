'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Upload, Check, Loader2, RefreshCw, Sparkles, AlertTriangle } from 'lucide-react';

// ============================================================================
// On Next.js the backend lives at /api/generate on the same domain — so we
// just hit that path directly. No URL config needed.
// ============================================================================
const API_ENDPOINT = '/api/generate';

const SIDES = [
  { key: 'front',     label: 'Front Panel', required: true,  placement: 'front foam panel, centered prominently' },
  { key: 'leftSide',  label: 'Left Side',   required: false, placement: 'left side mesh panel as a smaller embroidered accent, sitting on top of any stripes' },
  { key: 'rightSide', label: 'Right Side',  required: false, placement: 'right side mesh panel as a smaller embroidered accent, sitting on top of any stripes' },
];

const QUICK_COLORS = [
  '#1a1a1a', '#4a4a4a', '#8a8a8a', '#ffffff',
  '#1a2b4a', '#2d4a2b', '#5a3a1a', '#bfa57a',
  '#a8442a', '#a83232', '#c97a2a', '#e8dcc4',
];

const STRIPE_OPTIONS = [0, 1, 2, 3];

// ============================================================================
// PROMPT TEMPLATE — the language sent to Nano Banana Pro for every render.
// Each block is labelled so you can refine bits independently.
//
// IMPORTANT: Nano Banana Pro does NOT support a separate negative_prompt.
// All "do not do X" instructions are folded into the positive prompt below.
// ============================================================================

const PROMPT = {
  // 1. SUBJECT & ANGLE
  subject: 'Three-quarter front view of a high-crown structured 5-panel trucker cap, photographed at a 30-degree angle from the front-right, eye-level, sitting upright on a flat surface.',

  // 2. CAP CONSTRUCTION — explicit boundary description fixes foam/mesh confusion
  construction: 'Construction: front two panels are solid foam-backed twill, divided by a clean vertical centre seam from brim to crown. The three rear panels (left, right, back) are clearly mesh with visible woven texture. Sharp clean vertical seam where foam meets mesh — foam never bleeds into mesh, mesh never onto front. Pre-curved brim with downward arc. Small fabric squatchee button on top centre.',

  // 3. LOGO LOCKDOWN — stops AI inventing or duplicating logos
  logoLockdown: 'CRITICAL: the provided front design is the ONLY decoration on the front panel. Reproduce it EXACTLY — same shapes, colours, proportions, text characters. Do NOT invent, modify, redraw, stylise, or add to the logo. Do NOT add extra graphics, logos, text, badges, or patches anywhere. Do NOT duplicate the logo. Render as raised dimensional high quality embroidery with visible thread texture and soft shadow on the fabric. Centre the logo on the front panel.',

  // 4. NEGATIVE INSTRUCTIONS — folded in since Nano Banana has no negative_prompt field
  avoid: 'Avoid: flat brim, low-profile, baseball or fitted cap, dad hat, decorative stiching on brim, mesh on front panel, foam on side panels, panel bleeding, multiple caps, model, person, hands, mannequin, extra brims, busy or ed background, props, harsh shadows, lens flare, cartoon, illustration, sketch.',

  // 5. LIGHTING
  lighting: 'Lighting: soft directional studio light from upper-left, gentle shadows on the right of the crown, subtle shadow under the brim. Soft-box quality, no glare, no rim lighting, no ed gels.',

  // 6. BACKGROUND
  background: 'Background: pure white seamless studio backdrop, barely-perceptible cool gradient near the bottom. Soft natural contact shadow directly beneath the cap, diffuse not hard-edged. No props, no other objects.',

  // 7. STYLE / QUALITY
  style: 'Style: 85mm lens at f/4, shallow depth of field with the cap fully sharp. Ultra detail, fabric texture and mesh weave clearly visible, embroidery thread depth visible. Ecommerce product photography, clean catalogue look.',
};

export default function CapMockupGenerator() {
  const [designs, setDesigns] = useState({ front: null, leftSide: null, rightSide: null });
  const [capColor, setCapColor] = useState('#1a1a1a');
  const [stripeCount, setStripeCount] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState(null);
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

  const buildPrompt = () => {
    const colourLine = `Cap fabric colour: ${capColor}. Mesh sides match this colour or use Harmonious color/s. Brim same as front.`;
    const stripeLine = stripeCount === 0
      ? 'No stripes — clean unbroken mesh on the side panels.'
      : `${stripeCount} thin horizontal sewn-in ribbon stripe${stripeCount > 1 ? 's' : ''} across both side mesh panels in the middle third, evenly spaced and symmetrical. Flat ribbon tape sewn through the mesh (not embroidered, not painted). Stripe colour complements the ${capColor} cap — pick a tasteful contrasting tone (white, off-white, or single accent).`;
    const sideMentions = [];
    if (designs.leftSide)  sideMentions.push('smaller embroidered logo on the LEFT side mesh panel near the foam-mesh seam');
    if (designs.rightSide) sideMentions.push('smaller embroidered logo on the RIGHT side mesh panel near the foam-mesh seam');
    const sideLogoLine = sideMentions.length > 0
      ? `Also: ${sideMentions.join(', and ')}. Each side logo reproduced exactly from its reference image, embroidered, sitting on top of any stripes.`
      : 'No side panel logos.';

    return [
      PROMPT.subject,
      PROMPT.construction,
      colourLine,
      PROMPT.logoLockdown,
      sideLogoLine,
      stripeLine,
      PROMPT.lighting,
      PROMPT.background,
      PROMPT.style,
      PROMPT.avoid,
    ].join(' ');
  };

  const handleGenerate = async () => {
    if (!designs.front) { alert('Please upload at least a front-panel logo.'); return; }
    setGenerating(true);
    setResult(null);

    try {
      setProgress('Uploading your design…');
      const formData = new FormData();
      formData.append('capColor', capColor);
      formData.append('stripeCount', String(stripeCount));
      formData.append('prompt', buildPrompt());
      formData.append('design_front', designs.front.file);
      if (designs.leftSide)  formData.append('design_leftSide',  designs.leftSide.file);
      if (designs.rightSide) formData.append('design_rightSide', designs.rightSide.file);

      setProgress('Generating your cap with Nano Banana Pro…');
      const res = await fetch(API_ENDPOINT, { method: 'POST', body: formData });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server returned ${res.status}`);
      }
      const data = await res.json();
      setResult(data);
    } catch (err) {
      alert('Generation failed: ' + err.message);
    } finally {
      setGenerating(false);
      setProgress('');
    }
  };

  const SectionHeader = ({ num, title, subtitle }) => (
    <div className="flex items-baseline gap-4 mb-5 pb-3 border-b-2" style={{ borderColor: '#1a1a1a' }}>
      <span className="text-xs tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#c2410c' }}>
        {String(num).padStart(2, '0')}
      </span>
      <div className="flex-1">
        <h2 className="text-3xl leading-none" style={{ fontFamily: 'Anton, sans-serif', letterSpacing: '0.02em' }}>{title}</h2>
        {subtitle && <p className="text-sm mt-1" style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic', color: '#6b6452' }}>{subtitle}</p>}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: '#f5f1e8', fontFamily: 'Newsreader, serif', color: '#1a1a1a' }}>
      <div className="grain min-h-screen">
        <div className="max-w-5xl mx-auto px-6 py-10">

          <header className="mb-10 pb-6 border-b-2" style={{ borderColor: '#1a1a1a' }}>
            <div className="flex items-end justify-between gap-6 flex-wrap">
              <div>
                <div className="text-xs tracking-widest mb-2" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>
                  CUSTOM CAP STUDIO / PREVIEW TOOL
                </div>
                <h1 className="text-6xl leading-none" style={{ fontFamily: 'Anton, sans-serif', letterSpacing: '0.01em' }}>PREVIEW YOUR CAP</h1>
                <p className="mt-3 text-lg max-w-xl" style={{ fontStyle: 'italic', color: '#3d3829' }}>
                  Upload your logos, choose a colour and stripe count, and see how your custom 5-panel trucker would look.
                </p>
              </div>
            </div>
          </header>

          {/* 01 — Upload logos */}
          <section className="mb-10">
            <SectionHeader num={1} title="Upload your logos" subtitle="Front is required. Left and right side logos are optional." />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {SIDES.map(side => {
                const design = designs[side.key];
                return (
                  <div key={side.key}
                    onClick={() => fileInputRefs.current[side.key]?.click()}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = 'rgba(194,65,12,0.04)'; }}
                    onDragLeave={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = 'transparent'; }}
                    onDrop={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = 'transparent'; handleFile(side.key, e.dataTransfer.files?.[0]); }}
                    className="border-2 border-dashed cursor-pointer transition-colors p-4 flex items-center gap-4 min-h-32"
                    style={{ borderColor: side.required ? '#1a1a1a' : '#a39d8d' }}
                  >
                    <input ref={el => fileInputRefs.current[side.key] = el} type="file" accept="image/*" className="hidden"
                      onChange={(e) => handleFile(side.key, e.target.files?.[0])} />
                    {design ? (
                      <>
                        <div className="w-20 h-20 flex items-center justify-center bg-white border flex-shrink-0" style={{ borderColor: '#1a1a1a' }}>
                          <img src={design.preview} alt={side.label} className="max-w-full max-h-full object-contain" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs tracking-widest mb-1" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>{side.label.toUpperCase()} ✓</div>
                          <div className="text-sm truncate" style={{ fontFamily: 'Anton, sans-serif' }}>{design.file.name}</div>
                          <button onClick={(e) => { e.stopPropagation(); clearDesign(side.key); }} className="mt-1 text-xs underline" style={{ color: '#c2410c' }}>Remove</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-20 h-20 flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#e8e1cf' }}>
                          <Upload size={28} strokeWidth={1.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs tracking-widest mb-1" style={{ fontFamily: 'JetBrains Mono, monospace', color: side.required ? '#c2410c' : '#6b6452' }}>
                            {side.label.toUpperCase()} {side.required ? '· REQUIRED' : '· OPTIONAL'}
                          </div>
                          <div className="text-sm" style={{ color: '#3d3829' }}>Drop a PNG or click</div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 02 — Colour & stripes */}
          <section className="mb-10">
            <SectionHeader num={2} title="Pick your colour & stripes" subtitle="Choose any cap colour. Add 0–3 sewn stripes around the side panels." />
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-shrink-0">
                  <ColorWheel value={capColor} onChange={setCapColor} />
                </div>
                <div className="flex-1 space-y-4 min-w-0">
                  <div className="flex items-stretch gap-3">
                    <div className="flex flex-col items-center justify-center px-3 py-2 border-2" style={{ borderColor: '#1a1a1a' }}>
                      <div className="w-16 h-16 border" style={{ backgroundColor: capColor, borderColor: '#1a1a1a' }} />
                      <div className="text-[10px] tracking-widest mt-2" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>CURRENT</div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 border-2 flex-1 min-w-0" style={{ borderColor: '#1a1a1a' }}>
                      <span className="text-sm" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>HEX</span>
                      <input type="text" value={capColor}
                        onChange={(e) => { let v = e.target.value.trim(); if (!v.startsWith('#')) v = '#' + v; setCapColor(v); }}
                        className="bg-transparent flex-1 text-base min-w-0 outline-none" style={{ fontFamily: 'JetBrains Mono, monospace' }} maxLength={7} />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs tracking-widest mb-2" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>QUICK PICKS</div>
                    <div className="flex flex-wrap gap-2">
                      {QUICK_COLORS.map(c => (
                        <button key={c} onClick={() => setCapColor(c)}
                          className="w-10 h-10 transition-transform hover:scale-110"
                          style={{ backgroundColor: c, border: capColor.toLowerCase() === c.toLowerCase() ? '3px solid #c2410c' : '2px solid #1a1a1a' }}
                          title={c} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t" style={{ borderColor: '#d6d0c0' }} />

              <div>
                <div className="text-xs tracking-widest mb-3" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>
                  SEWN SIDE STRIPES — COLOUR CHOSEN AUTOMATICALLY TO COMPLEMENT THE CAP
                </div>
                <div className="relative inline-block w-full md:w-80">
                  <select value={stripeCount} onChange={(e) => setStripeCount(Number(e.target.value))}
                    className="w-full px-4 py-3 pr-10 border-2 bg-transparent appearance-none cursor-pointer text-base"
                    style={{ borderColor: '#1a1a1a', fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em', backgroundColor: '#f5f1e8' }}>
                    {STRIPE_OPTIONS.map(n => (
                      <option key={n} value={n}>
                        {n === 0 ? 'NO STRIPES' : `${n} STRIPE${n > 1 ? 'S' : ''}`}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <svg width="14" height="8" viewBox="0 0 14 8" fill="none">
                      <path d="M1 1L7 7L13 1" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 03 — Generate */}
          <section className="mb-10">
            <div className="flex items-center justify-between mb-5 pb-3 border-b-2 flex-wrap gap-3" style={{ borderColor: '#1a1a1a' }}>
              <div className="flex items-baseline gap-4">
                <span className="text-xs tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#c2410c' }}>03</span>
                <h2 className="text-3xl leading-none" style={{ fontFamily: 'Anton, sans-serif', letterSpacing: '0.02em' }}>RENDER</h2>
              </div>
              <button onClick={handleGenerate} disabled={!canGenerate}
                className="px-6 py-3 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#1a1a1a', color: '#f5f1e8', fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em' }}>
                {generating ? (<><Loader2 size={18} className="animate-spin" /> WORKING…</>) : (<><Sparkles size={18} /> GENERATE PREVIEW</>)}
              </button>
            </div>

            {generating && (
              <div className="p-6 border-2" style={{ borderColor: '#c2410c', backgroundColor: '#fff5ee' }}>
                <div className="flex items-center gap-3">
                  <Loader2 size={18} className="animate-spin" style={{ color: '#c2410c' }} />
                  <span className="text-sm" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{progress}</span>
                </div>
                <p className="text-xs mt-3" style={{ color: '#6b6452' }}>
                  Nano Banana Pro renders typically take 15–30 seconds. Hang tight.
                </p>
              </div>
            )}

            {result && !generating && (
              <div>
                <div className="border-2" style={{ borderColor: '#1a1a1a' }}>
                  <img src={result.imageUrl} alt="Generated cap preview" className="w-full block" />
                </div>
                <div className="mt-6 flex gap-3 items-center flex-wrap">
                  <button onClick={handleGenerate} className="px-5 py-2 border-2 flex items-center gap-2"
                    style={{ borderColor: '#1a1a1a', fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em' }}>
                    <RefreshCw size={16} /> GENERATE AGAIN
                  </button>
                  <a href={result.imageUrl} download target="_blank" rel="noopener noreferrer"
                     className="px-5 py-2 flex items-center gap-2"
                     style={{ backgroundColor: '#c2410c', color: '#f5f1e8', fontFamily: 'Anton, sans-serif', letterSpacing: '0.05em', textDecoration: 'none' }}>
                    DOWNLOAD
                  </a>
                  <span className="text-sm" style={{ color: '#6b6452', fontStyle: 'italic' }}>
                    Not happy with the result? Hit regenerate for a fresh attempt.
                  </span>
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

// ── Hue wheel + saturation/value square colour picker ──────────────────────
function ColorWheel({ value, onChange }) {
  const wheelRef = useRef(null);
  const svRef = useRef(null);
  const initial = useMemo(() => hexToHsv(value), []);
  const [hsv, setHsv] = useState(initial);
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value.toLowerCase() === lastEmitted.current.toLowerCase()) return;
    const newHsv = hexToHsv(value);
    if (newHsv) setHsv(newHsv);
  }, [value]);

  const updateHsv = (next) => {
    setHsv(next);
    const hex = hsvToHex(next.h, next.s, next.v);
    lastEmitted.current = hex;
    onChange(hex);
  };

  const handleWheelPointer = (e) => {
    const rect = wheelRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const x = e.clientX - rect.left - cx;
    const y = e.clientY - rect.top - cy;
    let angle = Math.atan2(y, x) * 180 / Math.PI;
    angle = (angle + 360) % 360;
    updateHsv({ ...hsv, h: angle });
  };

  const handleSvPointer = (e) => {
    const rect = svRef.current.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    updateHsv({ ...hsv, s: x, v: 1 - y });
  };

  const dragHandler = (handler) => (e) => {
    e.preventDefault();
    handler(e);
    const move = (ev) => handler(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const markerR = 90;
  const markerX = 100 + markerR * Math.cos(hsv.h * Math.PI / 180);
  const markerY = 100 + markerR * Math.sin(hsv.h * Math.PI / 180);
  const pureHueHex = hsvToHex(hsv.h, 1, 1);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: 200, height: 200 }}>
        <div ref={wheelRef} onPointerDown={dragHandler(handleWheelPointer)}
          className="absolute inset-0 cursor-crosshair"
          style={{
            borderRadius: '50%',
            background: 'conic-gradient(from 90deg, red, yellow, lime, cyan, blue, magenta, red)',
            WebkitMask: 'radial-gradient(circle, transparent 60px, black 62px, black 100px, transparent 102px)',
            mask: 'radial-gradient(circle, transparent 60px, black 62px, black 100px, transparent 102px)',
            border: '2px solid #1a1a1a',
            boxSizing: 'border-box',
          }} />
        <div className="absolute pointer-events-none"
          style={{
            left: `${markerX}px`, top: `${markerY}px`, width: 14, height: 14,
            transform: 'translate(-50%, -50%)', borderRadius: '50%',
            backgroundColor: pureHueHex, border: '2px solid #1a1a1a',
            boxShadow: '0 0 0 1.5px white inset',
          }} />
        <div ref={svRef} onPointerDown={dragHandler(handleSvPointer)}
          className="absolute cursor-crosshair"
          style={{
            left: 60, top: 60, width: 80, height: 80,
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureHueHex})`,
            border: '2px solid #1a1a1a', boxSizing: 'border-box',
          }}>
          <div className="pointer-events-none"
            style={{
              position: 'absolute',
              left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`,
              width: 12, height: 12, transform: 'translate(-50%, -50%)',
              borderRadius: '50%', border: '2px solid white',
              boxShadow: '0 0 0 1.5px #1a1a1a',
            }} />
        </div>
      </div>
      <div className="text-[10px] tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>
        DRAG WHEEL FOR HUE · DRAG CENTRE FOR SHADE
      </div>
    </div>
  );
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function hsvToHex(h, s, v) {
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if      (hp >= 0 && hp < 1) { r = c; g = x; b = 0; }
  else if (hp >= 1 && hp < 2) { r = x; g = c; b = 0; }
  else if (hp >= 2 && hp < 3) { r = 0; g = c; b = x; }
  else if (hp >= 3 && hp < 4) { r = 0; g = x; b = c; }
  else if (hp >= 4 && hp < 5) { r = x; g = 0; b = c; }
  else                        { r = c; g = 0; b = x; }
  const m = v - c;
  const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsv(hex) {
  if (!hex || typeof hex !== 'string') return { h: 0, s: 0, v: 0 };
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
  if (c.length !== 6) return { h: 0, s: 0, v: 0 };
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if      (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}
