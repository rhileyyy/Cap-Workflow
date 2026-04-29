'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, Check, Loader2, RefreshCw, Sparkles, Users } from 'lucide-react';

const API_ENDPOINT = '/api/generate';

const SIDES = [
  { key: 'front', label: 'Front Panel', required: true  },
  { key: 'side',  label: 'Side Panel',  required: false },
];

const QUICK_COLORS = [
  '#1a1a1a', '#4a4a4a', '#8a8a8a', '#ffffff',
  '#1a2b4a', '#2d4a2b', '#5a3a1a', '#bfa57a',
  '#a8442a', '#a83232', '#c97a2a', '#e8dcc4',
];

const STRIPE_OPTIONS = [0, 1, 2, 3];

const CAP_PARTS = [
  { key: 'front', label: 'Front' },
  { key: 'mesh',  label: 'Mesh'  },
  { key: 'brim',  label: 'Brim'  },
];

// Loading steps — shown while the backend generates. Durations are estimates
// that match real Nano Banana render times so the animation feels accurate.
const LOADING_STEPS = [
  { label: 'Uploading your design',       ms: 2500  },
  { label: 'Sending to render engine',    ms: 5000  },
  { label: 'Processing your cap preview', ms: 15000 },
  { label: 'Almost ready',               ms: 99999 }, // stays until done
];

export default function CapMockupGenerator() {
  const [designs, setDesigns]         = useState({ front: null, side: null });
  const [autoMode, setAutoMode]       = useState(true);
  const [variationSeed, setVariationSeed] = useState(0);
  const [colors, setColors]           = useState({ front: '#1a1a1a', mesh: '#1a1a1a', brim: '#1a1a1a' });
  const [stripeCount, setStripeCount] = useState(0);
  const [stripeColor, setStripeColor] = useState('#ffffff');
  const [sandwichBrim, setSandwichBrim]   = useState(false);
  const [sandwichColor, setSandwichColor] = useState('#c2410c');
  const [generating, setGenerating]       = useState(false);
  const [loadingStep, setLoadingStep]     = useState(0);
  const [result, setResult]               = useState(null);
  const [error, setError]                 = useState(null);
  const [generatingModels, setGeneratingModels] = useState(false);
  const [modelProgress, setModelProgress]       = useState('');
  const [modelShots, setModelShots]             = useState(null);
  const fileInputRefs = useRef({});
  const stepTimers    = useRef([]);

  const handleFile = (sideKey, file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Please upload an image file.'); return; }
    const reader = new FileReader();
    reader.onload = (e) => setDesigns(prev => ({ ...prev, [sideKey]: { file, preview: e.target.result } }));
    reader.readAsDataURL(file);
  };
  const clearDesign   = (sideKey) => setDesigns(prev => ({ ...prev, [sideKey]: null }));
  const canGenerate   = !!designs.front && !generating;
  const setColor      = (part, value) => setColors(prev => ({ ...prev, [part]: value }));
  const matchAll = () => setColors({ front: colors.front, mesh: colors.front, brim: colors.front });

  // ── Animated loading steps ─────────────────────────────────────────────
  const startLoadingAnimation = () => {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
    setLoadingStep(0);
    let elapsed = 0;
    LOADING_STEPS.slice(0, -1).forEach((step, i) => {
      elapsed += step.ms;
      const t = setTimeout(() => setLoadingStep(i + 1), elapsed);
      stepTimers.current.push(t);
    });
  };

  const stopLoadingAnimation = () => {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
  };

  useEffect(() => () => stopLoadingAnimation(), []);

  // ── Build FormData with structured settings (NO prompt) ──────────────────
  const buildFormData = (overrides = {}) => {
    const fd = new FormData();
    fd.append('mode',      overrides.mode     || (autoMode ? 'auto' : 'product'));
    fd.append('modelKey',  overrides.modelKey || 'male');
    fd.append('variationSeed', String(overrides.variationSeed ?? variationSeed));
    if (!autoMode || overrides.mode === 'model') {
      fd.append('color_front', colors.front);
      fd.append('color_mesh',  colors.mesh);
      fd.append('color_brim',  colors.brim);
      fd.append('stripeCount', String(stripeCount));
      fd.append('stripeColor', stripeColor);
      fd.append('sandwichBrim',  String(sandwichBrim));
      fd.append('sandwichColor', sandwichColor);
    }
    fd.append('design_front', designs.front.file);
    if (designs.side) fd.append('design_side', designs.side.file);
    return fd;
  };

  // ── Product shot ──────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!designs.front) return;
    setGenerating(true);
    setResult(null);
    setModelShots(null);
    setError(null);
    startLoadingAnimation();
    // Increment seed each time so auto mode picks a different design direction
    const nextSeed = autoMode ? variationSeed + 1 : variationSeed;
    if (autoMode) setVariationSeed(nextSeed);

    try {
      const res = await fetch(API_ENDPOINT, { method: 'POST', body: buildFormData({ variationSeed: nextSeed }) });
      // Use text() first so a non-JSON response (HTML error page, etc.) doesn't crash
      const text = await res.text();
      let data = {};
      try { data = JSON.parse(text); } catch {
        // Backend returned HTML or plain text — surface a useful message
        console.error('Non-JSON response from backend:', text.slice(0, 500));
        throw new Error(res.status === 500
          ? 'Server error — check Vercel logs for details.'
          : res.status === 404
          ? 'API route not found — the deployment may not have completed yet.'
          : `Unexpected response (${res.status}). Please try again.`
        );
      }
      if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      stopLoadingAnimation();
      setGenerating(false);
    }
  };

  // ── Model shots ───────────────────────────────────────────────────────
  const handleModelShots = async () => {
    if (!designs.front || !result?.imageUrl) return;
    setGeneratingModels(true);
    setModelShots(null);
    setModelProgress('Creating lifestyle previews…');

    try {
      const modelKeys = ['male', 'female', 'child'];
      const labels    = ['Men', 'Women', 'Kids'];
      const results   = await Promise.all(modelKeys.map(async (key, i) => {
        const fd = buildFormData({ mode: 'model', modelKey: key });
        // Send the already-rendered cap image so the model uses the exact cap
        fd.append('cap_image_url', result.imageUrl);
        const res = await fetch(API_ENDPOINT, { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { key, label: labels[i], error: data.error || 'Failed' };
        return { key, label: labels[i], imageUrl: data.imageUrl, shareId: data.shareId };
      }));
      setModelShots(results);
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingModels(false);
      setModelProgress('');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: '#f5f1e8', fontFamily: 'Newsreader, serif', color: '#1a1a1a' }}>
      <div className="grain min-h-screen">

        {/* Header */}
        <header className="px-6 py-6 max-w-[1440px] mx-auto">
          <div className="text-[10px] tracking-[0.3em] mb-2" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>
            CUSTOM CAP STUDIO
          </div>
          <h1 className="text-4xl md:text-5xl leading-[0.95]" style={{ fontFamily: 'Anton, sans-serif' }}>PREVIEW YOUR CAP</h1>
        </header>

        {/* Two-column layout */}
        <div className="max-w-[1440px] mx-auto px-6 pb-12 flex flex-col lg:flex-row gap-6">

          {/* ═══ LEFT PANEL ═══════════════════════════════════════════ */}
          <div className="w-full lg:w-[440px] xl:w-[480px] flex-shrink-0 space-y-4">

            {/* Logos */}
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
                      className="flex items-center gap-3 p-2.5 cursor-pointer"
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

            {/* Auto / Manual toggle */}
            <div className="bg-white border overflow-hidden" style={{ borderColor: '#d6d0c0' }}>
              <div className="flex">
                <button
                  onClick={() => setAutoMode(true)}
                  className="flex-1 py-3 flex items-center justify-center gap-2 text-sm transition-colors"
                  style={{
                    fontFamily: 'Anton, sans-serif',
                    letterSpacing: '0.05em',
                    backgroundColor: autoMode ? '#1a1a1a' : 'transparent',
                    color: autoMode ? '#ffffff' : '#6b6452',
                    borderRight: '1px solid #d6d0c0',
                  }}>
                  <Sparkles size={14} /> AUTO DESIGN
                </button>
                <button
                  onClick={() => setAutoMode(false)}
                  className="flex-1 py-3 flex items-center justify-center gap-2 text-sm transition-colors"
                  style={{
                    fontFamily: 'Anton, sans-serif',
                    letterSpacing: '0.05em',
                    backgroundColor: !autoMode ? '#1a1a1a' : 'transparent',
                    color: !autoMode ? '#ffffff' : '#6b6452',
                  }}>
                  ⚙ CUSTOMISE
                </button>
              </div>
              {autoMode && (
                <div className="px-4 py-3" style={{ backgroundColor: '#fafaf7', borderTop: '1px solid #f0ece2' }}>
                  <p className="text-xs leading-relaxed" style={{ color: '#6b6452' }}>
                    We'll analyse your logo and choose the best cap colours, stripes, and construction for a professional result.
                  </p>
                </div>
              )}
            </div>

            {/* Manual customisation panel — only shown when not in auto mode */}
            {!autoMode && (
              <>
                {/* Cap colours */}
                <div className="bg-white border p-4" style={{ borderColor: '#d6d0c0' }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px] tracking-[0.2em]" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>CAP COLOURS</div>
                    <button onClick={matchAll} className="text-[10px] hover:underline" style={{ color: '#c2410c', fontFamily: 'JetBrains Mono, monospace' }}>MATCH ALL →</button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {CAP_PARTS.map(part => (
                      <div key={part.key} className="text-center">
                        <input type="color" value={colors[part.key]} onChange={(e) => setColor(part.key, e.target.value)} className="w-full h-12 cursor-pointer" />
                        <div className="text-[9px] tracking-[0.12em] mt-1" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>
                          {part.label.toUpperCase()}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ borderTop: '1px solid #f0ece2' }} className="mt-3 pt-3">
                    <div className="text-[9px] tracking-[0.15em] mb-2" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#a39d8d' }}>
                      QUICK START — SETS ALL PARTS
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_COLORS.map(c => {
                        const sel = colors.front.toLowerCase() === c.toLowerCase()
                                 && colors.mesh.toLowerCase() === c.toLowerCase()
                                 && colors.brim.toLowerCase() === c.toLowerCase();
                        return (
                          <button key={c}
                            onClick={() => setColors({ front: c, mesh: c, brim: c })}
                            className="w-7 h-7"
                            style={{
                              backgroundColor: c,
                              border: sel ? '2px solid #c2410c' : '1px solid rgba(0,0,0,0.15)',
                              boxShadow: sel ? '0 0 0 1.5px #f5f1e8 inset' : 'none',
                            }}
                            title={c}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Stripes */}
                <div className="bg-white border p-4" style={{ borderColor: '#d6d0c0' }}>
                  <div className="text-[10px] tracking-[0.2em] mb-3" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>SIDE STRIPES</div>
                  <div className="flex gap-2 mb-2">
                    {STRIPE_OPTIONS.map(n => (
                      <button key={n} onClick={() => setStripeCount(n)}
                        className="flex-1 py-2.5 text-center text-sm"
                        style={{
                          fontFamily: 'Anton, sans-serif', letterSpacing: '0.03em',
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

                {/* Sandwich brim */}
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
              </>
            )}

            {/* Sticky CTA */}
            <div className="sticky bottom-4 z-10">
              <button onClick={handleGenerate} disabled={!canGenerate}
                className="w-full py-4 flex items-center justify-center gap-2 text-lg disabled:opacity-40 disabled:cursor-not-allowed shadow-xl"
                style={{ backgroundColor: '#c2410c', color: '#ffffff', fontFamily: 'Anton, sans-serif', letterSpacing: '0.08em' }}>
                {generating ? (<><Loader2 size={20} className="animate-spin" /> WORKING…</>) : (<><Sparkles size={20} /> CREATE PREVIEW</>)}
              </button>
            </div>
          </div>

          {/* ═══ RIGHT PANEL ══════════════════════════════════════════ */}
          <div className="flex-1 min-w-0">
            <div className="lg:sticky lg:top-6 space-y-4">

              {/* Empty state */}
              {!result && !generating && !error && (
                <div className="border bg-white flex items-center justify-center" style={{ borderColor: '#d6d0c0', minHeight: '400px' }}>
                  <div className="text-center p-8">
                    <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-full" style={{ backgroundColor: '#f0ece2' }}>
                      <Sparkles size={24} style={{ color: '#a39d8d' }} />
                    </div>
                    <p className="text-sm" style={{ color: '#6b6452' }}>
                      Upload a logo and hit <b style={{ color: '#c2410c' }}>Create Preview</b> to see your cap.
                    </p>
                  </div>
                </div>
              )}

              {/* Error state */}
              {error && !generating && (
                <div className="border p-6" style={{ borderColor: '#a83232', backgroundColor: '#fdf0f0' }}>
                  <p className="text-sm font-medium mb-1" style={{ color: '#a83232', fontFamily: 'Anton, sans-serif', letterSpacing: '0.03em' }}>SOMETHING WENT WRONG</p>
                  <p className="text-sm" style={{ color: '#3d3829' }}>{error}</p>
                  <button onClick={handleGenerate} disabled={!canGenerate}
                    className="mt-4 px-4 py-2 flex items-center gap-1.5 text-sm disabled:opacity-40"
                    style={{ border: '1px solid #a83232', color: '#a83232', fontFamily: 'Anton, sans-serif', letterSpacing: '0.03em' }}>
                    <RefreshCw size={14} /> TRY AGAIN
                  </button>
                </div>
              )}

              {/* Loading state — animated steps */}
              {generating && (
                <div className="border bg-white p-8" style={{ borderColor: '#d6d0c0', minHeight: '400px' }}>
                  <div className="space-y-4">
                    {LOADING_STEPS.map((step, i) => {
                      const done    = i < loadingStep;
                      const current = i === loadingStep;
                      const future  = i > loadingStep;
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{
                              backgroundColor: done ? '#2d5a2b' : current ? '#c2410c' : 'transparent',
                              border: `2px solid ${done ? '#2d5a2b' : current ? '#c2410c' : '#d6d0c0'}`,
                            }}>
                            {done    && <Check size={12} strokeWidth={3} style={{ color: '#fff' }} />}
                            {current && <Loader2 size={12} className="animate-spin" style={{ color: '#fff' }} />}
                          </div>
                          <span className="text-sm" style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            color: done ? '#2d5a2b' : current ? '#1a1a1a' : '#c4bfb0',
                            fontSize: current ? '0.875rem' : '0.8rem',
                          }}>
                            {step.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs mt-8" style={{ color: '#a39d8d' }}>Usually takes 15-30 seconds</p>
                </div>
              )}

              {/* Result */}
              {result && !generating && (
                <div className="space-y-3">
                  <div className="border bg-white" style={{ borderColor: '#1a1a1a' }}>
                    <img src={result.imageUrl} alt="Cap preview" className="w-full block" />
                  </div>

                  {/* Action buttons — TRY AGAIN + VIEW CAP (share page) */}
                  <div className="flex gap-2">
                    <button onClick={handleGenerate}
                      className="flex-1 py-2.5 border flex items-center justify-center gap-1.5 text-sm"
                      style={{ borderColor: '#1a1a1a', fontFamily: 'Anton, sans-serif', letterSpacing: '0.03em' }}>
                      <RefreshCw size={14} /> TRY AGAIN
                    </button>
                    {result.shareId && (
                      <a href={`/share/${result.shareId}`} target="_blank" rel="noopener noreferrer"
                        className="flex-1 py-2.5 flex items-center justify-center gap-1.5 text-sm"
                        style={{ backgroundColor: '#c2410c', color: '#fff', fontFamily: 'Anton, sans-serif', letterSpacing: '0.03em', textDecoration: 'none' }}>
                        VIEW YOUR CAP →
                      </a>
                    )}
                  </div>

                  {/* See it on models */}
                  <div className="pt-3" style={{ borderTop: '1px solid #d6d0c0' }}>
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
                        <p className="text-xs mt-1" style={{ color: '#6b6452' }}>Placing your cap on models (30-45 sec)</p>
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
                                <span className="text-[9px] tracking-[0.15em]" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6b6452' }}>
                                  {shot.label.toUpperCase()}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {/* Single retry button only */}
                        <button onClick={handleModelShots}
                          className="w-full py-2.5 border flex items-center justify-center gap-1.5 text-sm"
                          style={{ borderColor: '#1a1a1a', fontFamily: 'Anton, sans-serif', letterSpacing: '0.03em' }}>
                          <RefreshCw size={14} /> TRY AGAIN
                        </button>
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
