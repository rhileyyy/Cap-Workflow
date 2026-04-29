'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, Check, Loader2, RefreshCw, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';

const API_ENDPOINT = '/api/generate';

const SIDES = [
  { key: 'front', label: 'Front Panel', required: true  },
  { key: 'side',  label: 'Side Panel',  required: false },
];

const CAP_COLORS = [
  { name: 'Jet Black',    hex: '#111111' },
  { name: 'Charcoal',     hex: '#3a3a3a' },
  { name: 'Mid Grey',     hex: '#7a7a7a' },
  { name: 'White',        hex: '#f0f0f0' },
  { name: 'Navy',         hex: '#1a2b4a' },
  { name: 'Royal Blue',   hex: '#1a4a9a' },
  { name: 'Forest Green', hex: '#1e3d22' },
  { name: 'Olive',        hex: '#4a5a1a' },
  { name: 'Crimson',      hex: '#b81a1a' },
  { name: 'Burgundy',     hex: '#6b1a1a' },
  { name: 'Brown',        hex: '#5a3010' },
  { name: 'Tan',          hex: '#bfa57a' },
  { name: 'Rust',         hex: '#b84a1a' },
  { name: 'Gold',         hex: '#c9952a' },
  { name: 'Khaki',        hex: '#c8b88a' },
  { name: 'Sand',         hex: '#e0cfa0' },
];

const STRIPE_OPTIONS = [0, 1, 2, 3];

const LOADING_STEPS = [
  { label: 'Uploading your design',       ms: 2500  },
  { label: 'Sending to render engine',    ms: 5000  },
  { label: 'Processing your cap preview', ms: 15000 },
  { label: 'Almost ready',               ms: 99999 },
];

const CapOutline = () => (
  <svg viewBox="0 0 280 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-40 h-24">
    <path d="M60 118 C56 90 68 55 120 40 C172 55 226 68 230 108"
      stroke="#c4bfb0" strokeWidth="2" strokeLinecap="round" />
    <path d="M230 108 L230 120 L60 132 L60 118 Z"
      stroke="#c4bfb0" strokeWidth="2" strokeLinejoin="round" />
    <path d="M60 132 C46 136 28 143 26 152 C24 161 44 163 64 161"
      stroke="#c4bfb0" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="145" cy="41" r="5" stroke="#c4bfb0" strokeWidth="1.5" />
    <path d="M120 118 L120 132" stroke="#d6d0c0" strokeWidth="1" strokeDasharray="3 3" />
  </svg>
);

const PersonSilhouette = () => (
  <svg viewBox="0 0 60 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-9 h-12">
    <circle cx="30" cy="16" r="9" stroke="#c4bfb0" strokeWidth="1.5" />
    <path d="M10 76 C10 53 18 41 30 41 C42 41 50 53 50 76"
      stroke="#c4bfb0" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M13 57 L6 73 M47 57 L54 73"
      stroke="#c4bfb0" strokeWidth="1.5" strokeLinecap="round" />
    <rect x="21" y="6" width="18" height="4" rx="2" stroke="#c4bfb0" strokeWidth="1" />
  </svg>
);

// ── Colour swatch grid — shared between full-palette and per-part rows ─────
function SwatchGrid({ selected, onSelect, size = 28 }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CAP_COLORS.map(c => {
        const sel = selected?.toLowerCase() === c.hex.toLowerCase();
        return (
          <button key={c.hex} title={c.name} onClick={() => onSelect(c.hex)}
            className="swatch-btn flex-shrink-0 relative"
            style={{
              width: size, height: size, borderRadius: 4,
              backgroundColor: c.hex,
              border: sel ? '2px solid #c2410c' : '1px solid rgba(0,0,0,0.13)',
              boxShadow: sel ? '0 0 0 2px #f5f1e8, 0 0 0 3.5px #c2410c' : 'none',
            }}>
            {sel && (
              <Check size={size > 22 ? 11 : 9} strokeWidth={3.5}
                style={{
                  color: isLightColor(c.hex) ? '#000' : '#fff',
                  position: 'absolute', inset: 0, margin: 'auto', display: 'block',
                }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Custom colour picker — swatch + hex input ─────────────────────────────
function CustomColorPicker({ value, onChange, label }) {
  const inputRef = useRef();
  return (
    <div className="flex items-center gap-2 mt-2 pt-2" style={{ borderTop: '1px solid #f0ece2' }}>
      <span className="text-[9px] tracking-wider flex-shrink-0"
        style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>
        {label || 'CUSTOM'}
      </span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
        ref={inputRef} className="w-7 h-7 cursor-pointer flex-shrink-0" />
      <input
        type="text"
        value={value}
        maxLength={7}
        onChange={(e) => {
          let v = e.target.value.trim();
          if (!v.startsWith('#')) v = '#' + v;
          if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
        }}
        className="text-xs px-2 py-1 rounded flex-1 min-w-0"
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          border: '1px solid #d6d0c0',
          backgroundColor: '#f8f6f0',
          color: '#1a1a1a',
          outline: 'none',
        }}
      />
    </div>
  );
}

function isLightColor(hex) {
  const h = (hex || '#000').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

export default function CapPreview() {
  const [designs, setDesigns]             = useState({ front: null, side: null });
  const [autoMode, setAutoMode]           = useState(true);
  const [variationSeed, setVariationSeed] = useState(0);
  const [colors, setColors]               = useState({ front: '#111111', mesh: '#111111', brim: '#111111' });
  const [stripeCount, setStripeCount]     = useState(0);
  const [stripeColor, setStripeColor]     = useState('#ffffff');
  const [sandwichBrim, setSandwichBrim]   = useState(false);
  const [sandwichColor, setSandwichColor] = useState('#c2410c');
  const [showAdvanced, setShowAdvanced]   = useState(false);
  const [generating, setGenerating]       = useState(false);
  const [loadingStep, setLoadingStep]     = useState(0);
  const [result, setResult]               = useState(null);
  const [error, setError]                 = useState(null);
  const [modelShots, setModelShots]       = useState({ male: null, female: null, child: null });
  const fileInputRefs = useRef({});
  const stepTimers    = useRef([]);

  const handleFile = (sideKey, file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const minPx = sideKey === 'front' ? 400 : 200;
        setDesigns(prev => ({
          ...prev,
          [sideKey]: {
            file,
            preview: e.target.result,
            lowRes: img.width < minPx || img.height < minPx,
            dims: `${img.width}×${img.height}`,
          }
        }));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  const clearDesign = (key) => setDesigns(prev => ({ ...prev, [key]: null }));
  const canGenerate = !!designs.front && !generating;

  const setAllColors = (hex) => setColors({ front: hex, mesh: hex, brim: hex });
  const setColor = (part, val) => setColors(prev => ({ ...prev, [part]: val }));

  const allMatch = (hex) =>
    [colors.front, colors.mesh, colors.brim].every(c => c.toLowerCase() === hex.toLowerCase());

  // Loading animation
  const startLoadingAnimation = () => {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
    setLoadingStep(0);
    let elapsed = 0;
    LOADING_STEPS.slice(0, -1).forEach((step, i) => {
      elapsed += step.ms;
      stepTimers.current.push(setTimeout(() => setLoadingStep(i + 1), elapsed));
    });
  };
  const stopLoadingAnimation = () => {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
  };
  useEffect(() => () => stopLoadingAnimation(), []);

  const buildFormData = (overrides = {}) => {
    const fd = new FormData();
    fd.append('mode',          overrides.mode     || (autoMode ? 'auto' : 'product'));
    fd.append('modelKey',      overrides.modelKey || 'male');
    fd.append('variationSeed', String(overrides.variationSeed ?? variationSeed));
    if (!autoMode || overrides.mode === 'model') {
      fd.append('color_front',   colors.front);
      fd.append('color_mesh',    colors.mesh);
      fd.append('color_brim',    colors.brim);
      fd.append('stripeCount',   String(stripeCount));
      fd.append('stripeColor',   stripeColor);
      fd.append('sandwichBrim',  String(sandwichBrim));
      fd.append('sandwichColor', sandwichColor);
    }
    fd.append('design_front', designs.front.file);
    if (designs.side) fd.append('design_side', designs.side.file);
    return fd;
  };

  const handleGenerate = async () => {
    if (!designs.front) return;
    setGenerating(true);
    setResult(null);
    setModelShots({ male: null, female: null, child: null });
    setError(null);
    startLoadingAnimation();
    const nextSeed = autoMode ? variationSeed + 1 : variationSeed;
    if (autoMode) setVariationSeed(nextSeed);
    try {
      const res  = await fetch(API_ENDPOINT, { method: 'POST', body: buildFormData({ variationSeed: nextSeed }) });
      const text = await res.text();
      let data = {};
      try { data = JSON.parse(text); } catch {
        throw new Error(res.status === 404 ? 'API route not found.' : 'Server error — please try again.');
      }
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      stopLoadingAnimation();
      setGenerating(false);
    }
  };

  const MODEL_LABELS = { male: 'Men', female: 'Women', child: 'Kids' };

  const handleModelShot = async (key) => {
    if (!designs.front || !result?.imageUrl) return;
    setModelShots(prev => ({ ...prev, [key]: 'loading' }));
    try {
      const fd = buildFormData({ mode: 'model', modelKey: key });
      fd.append('cap_image_url', result.imageUrl);
      const res  = await fetch(API_ENDPOINT, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      setModelShots(prev => ({
        ...prev,
        [key]: res.ok ? { imageUrl: data.imageUrl, shareId: data.shareId } : { error: data.error || 'Failed' }
      }));
    } catch (err) {
      setModelShots(prev => ({ ...prev, [key]: { error: err.message } }));
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full grain" style={{ backgroundColor: '#f5f1e8', fontFamily: 'Newsreader, serif', color: '#1a1a1a' }}>

      {/* ── Sticky Header ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid #d6d0c0', backgroundColor: 'rgba(245,241,232,0.96)', backdropFilter: 'blur(10px)' }}>
        <div>
          <div className="text-[9px] tracking-[0.35em]" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#a39d8d' }}>
            IMAGE MERCH
          </div>
          <div className="text-xl leading-none" style={{ fontFamily: 'Anton, sans-serif', letterSpacing: '0.04em' }}>
            CAP STUDIO
          </div>
        </div>
        {generating && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px]"
            style={{ backgroundColor: '#1a1a1a', color: '#f5f1e8', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em' }}>
            <Loader2 size={10} className="animate-spin" /> GENERATING
          </div>
        )}
      </header>

      {/* ── Two-column layout — Tailwind handles responsive, NOT inline styles ── */}
      <div className="flex flex-col lg:flex-row" style={{ minHeight: 'calc(100vh - 56px)' }}>

        {/* ═══ LEFT PANEL ══════════════════════════════════════════════ */}
        <aside className="w-full lg:w-[400px] xl:w-[440px] flex-shrink-0 flex flex-col"
          style={{ borderRight: '1px solid #d6d0c0', borderBottom: '1px solid #d6d0c0' }}>

          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ paddingBottom: 100 }}>

            {/* YOUR LOGOS */}
            <section>
              <div className="section-label">YOUR LOGOS</div>
              <div className="space-y-2">
                {SIDES.map(side => {
                  const design = designs[side.key];
                  return (
                    <div key={side.key}
                      className="upload-tile flex items-center gap-3 cursor-pointer rounded-md"
                      onClick={() => fileInputRefs.current[side.key]?.click()}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
                      onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
                      onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); handleFile(side.key, e.dataTransfer.files?.[0]); }}
                      style={{
                        padding: '10px 12px',
                        border: `1.5px ${design ? 'solid' : 'dashed'} ${design ? (design.lowRes ? '#d4900a' : '#d0cbbf') : side.required ? '#1a1a1a' : '#c4bfb0'}`,
                        backgroundColor: design ? '#fff' : 'transparent',
                      }}>
                      <input ref={el => fileInputRefs.current[side.key] = el}
                        type="file" accept="image/*" className="hidden"
                        onChange={(e) => handleFile(side.key, e.target.files?.[0])} />

                      {design ? (
                        <>
                          <div className="w-14 h-14 flex-shrink-0 flex items-center justify-center rounded"
                            style={{ backgroundColor: '#f8f6f0', border: `1px solid ${design.lowRes ? '#f0c060' : '#e8e1cf'}` }}>
                            <img src={design.preview} alt="" className="max-w-full max-h-full object-contain p-1" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] tracking-[0.15em] font-semibold"
                                style={{ fontFamily: 'JetBrains Mono, monospace', color: design.lowRes ? '#c97a2a' : '#2d5a2b' }}>
                                {side.label.toUpperCase()}
                              </span>
                              {design.lowRes
                                ? <span className="text-[9px] px-1.5 py-0.5 rounded"
                                    style={{ backgroundColor: '#fef3e0', color: '#c97a2a', fontFamily: 'JetBrains Mono, monospace' }}>
                                    LOW RES
                                  </span>
                                : <Check size={11} strokeWidth={3} style={{ color: '#2d5a2b' }} />
                              }
                            </div>
                            <div className="text-xs truncate" style={{ color: '#6b6452' }}>{design.file.name}</div>
                            {design.lowRes && (
                              <div className="text-[10px] mt-0.5 leading-snug" style={{ color: '#c97a2a' }}>
                                {design.dims} — upload higher resolution for best results
                              </div>
                            )}
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); clearDesign(side.key); }}
                            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full transition-colors hover:bg-red-50"
                            style={{ color: '#c2410c', fontSize: 14, border: 'none', background: 'transparent', cursor: 'pointer' }}>✕
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="w-14 h-14 flex-shrink-0 flex items-center justify-center rounded"
                            style={{ backgroundColor: '#f0ece2' }}>
                            <Upload size={20} strokeWidth={1.5} style={{ color: '#a39d8d' }} />
                          </div>
                          <div>
                            <div className="text-[10px] tracking-[0.15em] font-semibold mb-1"
                              style={{ fontFamily: 'JetBrains Mono, monospace', color: side.required ? '#1a1a1a' : '#6b6452' }}>
                              {side.label.toUpperCase()}
                            </div>
                            <div className="text-[11px]" style={{ color: '#a39d8d' }}>
                              {side.required ? 'Required · click or drag to upload' : 'Optional · click or drag to upload'}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* MODE TOGGLE */}
            <section>
              <div className="relative flex rounded-md overflow-hidden"
                style={{ border: '1px solid #d6d0c0', backgroundColor: '#fff' }}>
                <div className="absolute inset-y-0 w-1/2 transition-transform duration-200 ease-in-out"
                  style={{ backgroundColor: '#1a1a1a', transform: autoMode ? 'translateX(0%)' : 'translateX(100%)' }} />
                {[
                  { val: true,  Icon: Sparkles, label: 'SURPRISE ME' },
                  { val: false, label: 'CHOOSE COLOURS', symbol: '⊞' },
                ].map(({ val, Icon, label, symbol }) => (
                  <button key={label} onClick={() => setAutoMode(val)}
                    className="relative z-10 flex-1 flex items-center justify-center gap-1.5 py-3 transition-colors duration-200"
                    style={{
                      fontFamily: 'Anton, sans-serif', fontSize: 12, letterSpacing: '0.06em',
                      color: autoMode === val ? '#fff' : '#6b6452',
                      border: 'none', background: 'transparent', cursor: 'pointer',
                    }}>
                    {Icon ? <Icon size={12} /> : <span>{symbol}</span>}
                    {label}
                  </button>
                ))}
              </div>
              {autoMode && (
                <p className="text-xs mt-2 leading-relaxed px-0.5" style={{ color: '#6b6452' }}>
                  We'll read your logo and pick the best colours, stripes, and finish.
                  Hit <strong>Try Again</strong> to see a different combination.
                </p>
              )}
            </section>

            {/* CUSTOMISE PANEL */}
            {!autoMode && (
              <section className="space-y-3">

                {/* CAP COLOUR — named palette, sets all parts */}
                <div className="card">
                  <div className="section-label">CAP COLOUR</div>
                  <p className="text-[10px] mb-3" style={{ color: '#a39d8d' }}>
                    Select a colour to apply to all parts at once
                  </p>
                  <SwatchGrid
                    selected={[colors.front, colors.mesh, colors.brim].every(c => c === colors.front) ? colors.front : null}
                    onSelect={setAllColors}
                    size={32}
                  />
                  <CustomColorPicker
                    label="CUSTOM COLOUR"
                    value={colors.front}
                    onChange={setAllColors}
                  />

                  {/* Per-part adjustment */}
                  <button onClick={() => setShowAdvanced(v => !v)}
                    className="mt-3 w-full flex items-center justify-between px-3 py-2 rounded transition-colors hover:bg-neutral-50 text-[10px]"
                    style={{ border: '1px solid #e8e1cf', color: '#6b6452', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', background: 'transparent', cursor: 'pointer' }}>
                    ADJUST INDIVIDUAL PARTS
                    {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>

                  {showAdvanced && (
                    <div className="mt-3 pt-3 space-y-4" style={{ borderTop: '1px solid #f0ece2' }}>
                      {[
                        { key: 'front', label: 'FRONT PANEL' },
                        { key: 'mesh',  label: 'MESH' },
                        { key: 'brim',  label: 'BRIM' },
                      ].map(part => (
                        <div key={part.key}>
                          <div className="text-[9px] tracking-wider mb-2"
                            style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>
                            {part.label}
                          </div>
                          <SwatchGrid
                            selected={colors[part.key]}
                            onSelect={(hex) => setColor(part.key, hex)}
                            size={26}
                          />
                          <CustomColorPicker
                            value={colors[part.key]}
                            onChange={(hex) => setColor(part.key, hex)}
                          />
                        </div>
                      ))}

                      {/* Sandwich brim */}
                      <div className="pt-3" style={{ borderTop: '1px solid #f0ece2' }}>
                        <label className="flex items-center justify-between cursor-pointer">
                          <div>
                            <div className="text-[10px] tracking-wider font-semibold"
                              style={{ fontFamily: 'JetBrains Mono, monospace', color: '#1a1a1a' }}>
                              SANDWICH BRIM
                            </div>
                            <div className="text-[10px] mt-0.5" style={{ color: '#a39d8d' }}>
                              Contrasting colour on brim underside
                            </div>
                          </div>
                          <input type="checkbox" checked={sandwichBrim} onChange={(e) => setSandwichBrim(e.target.checked)} />
                        </label>
                        {sandwichBrim && (
                          <div className="mt-2">
                            <SwatchGrid selected={sandwichColor} onSelect={setSandwichColor} size={24} />
                            <CustomColorPicker value={sandwichColor} onChange={setSandwichColor} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* SIDE STRIPES */}
                <div className="card">
                  <div className="section-label">SIDE STRIPES</div>
                  <div className="flex gap-2">
                    {STRIPE_OPTIONS.map(n => (
                      <button key={n} onClick={() => setStripeCount(n)}
                        className="flex-1 py-2.5 text-center rounded transition-all"
                        style={{
                          fontFamily: 'Anton, sans-serif', fontSize: 13, letterSpacing: '0.04em',
                          backgroundColor: stripeCount === n ? '#1a1a1a' : 'transparent',
                          color: stripeCount === n ? '#f5f1e8' : '#6b6452',
                          border: `1px solid ${stripeCount === n ? '#1a1a1a' : '#d6d0c0'}`,
                          cursor: 'pointer',
                        }}>
                        {n === 0 ? 'NONE' : n}
                      </button>
                    ))}
                  </div>
                  {stripeCount > 0 && (
                    <div className="mt-3 pt-3" style={{ borderTop: '1px solid #f0ece2' }}>
                      <div className="section-label">STRIPE COLOUR</div>
                      <SwatchGrid selected={stripeColor} onSelect={setStripeColor} size={26} />
                      <CustomColorPicker value={stripeColor} onChange={setStripeColor} />
                    </div>
                  )}
                </div>

              </section>
            )}
          </div>

          {/* ── Sticky CTA ─────────────────────────────────────────────── */}
          <div className="sticky bottom-0 z-10 p-4"
            style={{ borderTop: '1px solid #d6d0c0', backgroundColor: 'rgba(245,241,232,0.97)', backdropFilter: 'blur(8px)' }}>
            {!designs.front && (
              <p className="text-center text-[11px] mb-3"
                style={{ color: '#a39d8d', fontFamily: 'JetBrains Mono, monospace' }}>
                Upload a front panel logo to get started
              </p>
            )}
            <button onClick={handleGenerate} disabled={!canGenerate}
              className="cta-button w-full flex items-center justify-center gap-2.5"
              style={{
                padding: '14px 24px',
                backgroundColor: canGenerate ? '#c2410c' : '#d6d0c0',
                color: canGenerate ? '#fff' : '#a39d8d',
                fontFamily: 'Anton, sans-serif', fontSize: 15, letterSpacing: '0.08em',
                border: 'none', borderRadius: 6, cursor: canGenerate ? 'pointer' : 'not-allowed',
                transition: 'background-color 0.2s ease',
              }}>
              {generating
                ? <><Loader2 size={18} className="animate-spin" /> WORKING…</>
                : <><Sparkles size={18} /> CREATE PREVIEW</>
              }
            </button>
          </div>
        </aside>

        {/* ═══ RIGHT PANEL ═════════════════════════════════════════════ */}
        <main className="flex-1 min-w-0 flex flex-col items-center justify-center p-6 lg:p-10">

          {/* Empty state */}
          {!result && !generating && !error && (
            <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: 400 }}>
              <CapOutline />
              <p className="mt-5 text-sm" style={{ color: '#a39d8d', lineHeight: 1.7 }}>
                {designs.front
                  ? <>Ready — hit <span style={{ color: '#c2410c', fontWeight: 700 }}>Create Preview</span> to see your cap</>
                  : 'Upload your logo to get started'
                }
              </p>
            </div>
          )}

          {/* Error state */}
          {error && !generating && (
            <div className="w-full" style={{ maxWidth: 420 }}>
              <div className="p-5 rounded-lg" style={{ backgroundColor: '#fdf0f0', border: '1px solid #f4c0c0' }}>
                <p className="mb-1" style={{ fontFamily: 'Anton, sans-serif', color: '#a83232', letterSpacing: '0.03em' }}>
                  SOMETHING WENT WRONG
                </p>
                <p className="text-sm mb-4 leading-relaxed" style={{ color: '#5a2020' }}>{error}</p>
                <button onClick={handleGenerate} disabled={!canGenerate}
                  className="flex items-center gap-2 px-4 py-2 rounded text-sm transition-colors"
                  style={{ border: '1.5px solid #a83232', color: '#a83232', fontFamily: 'Anton, sans-serif', letterSpacing: '0.03em', background: 'transparent', cursor: 'pointer' }}>
                  <RefreshCw size={13} /> TRY AGAIN
                </button>
              </div>
            </div>
          )}

          {/* Loading state */}
          {generating && (
            <div style={{ maxWidth: 300, width: '100%' }}>
              <div className="space-y-5 mb-8">
                {LOADING_STEPS.map((step, i) => {
                  const done    = i < loadingStep;
                  const current = i === loadingStep;
                  return (
                    <div key={i} className="flex items-center gap-4 transition-opacity duration-400"
                      style={{ opacity: i > loadingStep ? 0.2 : 1 }}>
                      <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300"
                        style={{
                          backgroundColor: done ? '#2d5a2b' : current ? '#c2410c' : 'transparent',
                          border: `2px solid ${done ? '#2d5a2b' : current ? '#c2410c' : '#d6d0c0'}`,
                        }}>
                        {done    && <Check size={12} strokeWidth={3} style={{ color: '#fff' }} />}
                        {current && <Loader2 size={12} className="animate-spin" style={{ color: '#fff' }} />}
                      </div>
                      <span className="transition-all duration-300"
                        style={{
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: current ? 13 : 12,
                          color: done ? '#2d5a2b' : current ? '#1a1a1a' : '#a39d8d',
                          fontWeight: current ? 600 : 400,
                        }}>
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-center text-[10px] tracking-widest" style={{ color: '#a39d8d', fontFamily: 'JetBrains Mono, monospace' }}>
                USUALLY 15–25 SECONDS
              </p>
            </div>
          )}

          {/* Result */}
          {result && !generating && (
            <div className="w-full" style={{ maxWidth: 700 }}>

              {/* Cap image */}
              <div className="rounded-xl overflow-hidden mb-4"
                style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.13), 0 2px 8px rgba(0,0,0,0.08)', border: '1px solid rgba(0,0,0,0.05)' }}>
                <img src={result.imageUrl} alt="Your custom cap" className="w-full block" />
              </div>

              {/* Actions */}
              <div className="flex gap-3 mb-6">
                <button onClick={handleGenerate}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-md text-sm transition-colors hover:bg-neutral-100"
                  style={{ border: '1.5px solid #1a1a1a', fontFamily: 'Anton, sans-serif', letterSpacing: '0.04em', background: 'transparent', cursor: 'pointer' }}>
                  <RefreshCw size={14} /> TRY AGAIN
                </button>
                {result.shareId && (
                  <a href={`/share/${result.shareId}`} target="_blank" rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-md text-sm"
                    style={{ backgroundColor: '#c2410c', color: '#fff', fontFamily: 'Anton, sans-serif', letterSpacing: '0.04em', textDecoration: 'none' }}>
                    VIEW YOUR CAP →
                  </a>
                )}
              </div>

              {/* Model shots */}
              <div className="pt-5" style={{ borderTop: '1px solid #d6d0c0' }}>
                <div className="section-label mb-3">SEE IT ON MODELS</div>
                <div className="grid grid-cols-3 gap-4">
                  {Object.entries(MODEL_LABELS).map(([key, label]) => {
                    const shot = modelShots[key];
                    return (
                      <div key={key} className="rounded-lg overflow-hidden"
                        style={{ border: '1px solid #d6d0c0', backgroundColor: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>

                        {shot === null && (
                          <button onClick={() => handleModelShot(key)}
                            className="w-full flex flex-col items-center justify-center gap-3 transition-colors"
                            style={{ aspectRatio: '3/4', backgroundColor: '#f8f6f0', border: 'none', cursor: 'pointer' }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0ece2'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = '#f8f6f0'}>
                            <PersonSilhouette />
                            <span className="text-[9px] tracking-[0.2em]"
                              style={{ fontFamily: 'JetBrains Mono, monospace', color: '#a39d8d' }}>
                              {label.toUpperCase()}
                            </span>
                          </button>
                        )}

                        {shot === 'loading' && (
                          <div className="w-full flex flex-col items-center justify-center gap-3"
                            style={{ aspectRatio: '3/4', backgroundColor: '#fafaf7' }}>
                            <Loader2 size={20} className="animate-spin" style={{ color: '#c2410c' }} />
                            <span className="text-[9px] tracking-[0.2em]"
                              style={{ fontFamily: 'JetBrains Mono, monospace', color: '#a39d8d' }}>
                              {label.toUpperCase()}
                            </span>
                          </div>
                        )}

                        {shot && shot !== 'loading' && shot.imageUrl && (
                          <>
                            <img src={shot.imageUrl} alt={label} className="w-full block" />
                            <button onClick={() => handleModelShot(key)}
                              className="w-full flex items-center justify-center gap-1.5 py-2 text-[9px] transition-colors hover:bg-neutral-50"
                              style={{ borderTop: '1px solid #f0ece2', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', color: '#a39d8d', background: 'transparent', border: 'none', cursor: 'pointer', borderTop: '1px solid #f0ece2' }}>
                              <RefreshCw size={9} /> RETRY
                            </button>
                          </>
                        )}

                        {shot && shot !== 'loading' && shot.error && (
                          <button onClick={() => handleModelShot(key)}
                            className="w-full flex flex-col items-center justify-center gap-2 transition-colors"
                            style={{ aspectRatio: '3/4', backgroundColor: '#fdf8f8', border: 'none', cursor: 'pointer' }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#fdf0f0'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = '#fdf8f8'}>
                            <span className="text-[10px]" style={{ color: '#a83232', fontFamily: 'JetBrains Mono, monospace' }}>FAILED</span>
                            <span className="text-[9px]" style={{ color: '#c4bfb0', fontFamily: 'JetBrains Mono, monospace' }}>TAP TO RETRY</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
