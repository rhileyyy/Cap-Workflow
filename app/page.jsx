'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, Check, Loader2, RefreshCw, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';

const API_ENDPOINT = '/api/generate';

const SIDES = [
  { key: 'front', label: 'Front Panel', required: true  },
  { key: 'side',  label: 'Side Panel',  required: false },
];

// 16-colour named palette — one click sets all parts at once
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
  <svg viewBox="0 0 240 160" fill="none" xmlns="http://www.w3.org/2000/svg"
    style={{ width: 120, height: 80, opacity: 0.18, color: '#6b6452' }}>
    <path d="M55 108 C52 85 62 52 105 40 C148 52 195 62 198 98"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M198 98 L198 110 L55 122 L55 108 Z"
      stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="M55 122 C44 126 28 132 26 140 C24 148 40 150 58 148"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="55" y1="108" x2="55" y2="122" stroke="currentColor" strokeWidth="1.5" />
    <line x1="198" y1="98" x2="198" y2="110" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="128" cy="41" r="5" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const PersonSilhouette = () => (
  <svg viewBox="0 0 60 80" fill="none" xmlns="http://www.w3.org/2000/svg"
    style={{ width: 36, height: 48, opacity: 0.22, color: '#6b6452' }}>
    <circle cx="30" cy="15" r="9" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 75 C10 52 18 40 30 40 C42 40 50 52 50 75"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M13 56 L6 72 M47 56 L54 72"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <rect x="20" y="5" width="20" height="4" rx="2"
      stroke="currentColor" strokeWidth="1" />
  </svg>
);

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
        const lowRes = img.width < minPx || img.height < minPx;
        setDesigns(prev => ({
          ...prev,
          [sideKey]: { file, preview: e.target.result, lowRes, dims: `${img.width}×${img.height}` }
        }));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  const clearDesign = (key) => setDesigns(prev => ({ ...prev, [key]: null }));
  const canGenerate = !!designs.front && !generating;

  const isLight = (hex) => {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 128;
  };

  const setAllColors = (hex) => setColors({ front: hex, mesh: hex, brim: hex });
  const setColor = (part, val) => setColors(prev => ({ ...prev, [part]: val }));
  const allMatch = (hex) =>
    [colors.front, colors.mesh, colors.brim].every(c => c.toLowerCase() === hex.toLowerCase());

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
        throw new Error(res.status === 404 ? 'API route not found — check deployment.' : 'Server error — please try again.');
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

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ backgroundColor: '#f5f1e8', minHeight: '100vh', fontFamily: 'Newsreader, serif', color: '#1a1a1a' }}>
      <div className="grain" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <header style={{
          borderBottom: '1px solid #d6d0c0',
          backgroundColor: 'rgba(245,241,232,0.96)',
          backdropFilter: 'blur(8px)',
          position: 'sticky', top: 0, zIndex: 20,
          padding: '14px 24px',
        }}>
          <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.35em', color: '#a39d8d', marginBottom: 2 }}>
                IMAGE MERCH
              </div>
              <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 20, letterSpacing: '0.04em', lineHeight: 1 }}>
                CAP STUDIO
              </div>
            </div>
            {generating && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                backgroundColor: '#1a1a1a', color: '#f5f1e8',
                padding: '6px 14px', borderRadius: 20,
                fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.12em',
              }}>
                <Loader2 size={10} className="animate-spin" /> GENERATING
              </div>
            )}
          </div>
        </header>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', maxWidth: 1400, margin: '0 auto', width: '100%' }}
          className="flex-col lg:flex-row">

          {/* ═══ LEFT PANEL ══════════════════════════════════════════════ */}
          <aside style={{
            width: '100%', flexShrink: 0,
            borderRight: '1px solid #d6d0c0',
            display: 'flex', flexDirection: 'column',
          }} className="lg:w-[400px] xl:w-[440px]">

            {/* Scrollable content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 110 }}>

              {/* Logos */}
              <div>
                <div className="section-label">YOUR LOGOS</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {SIDES.map(side => {
                    const design = designs[side.key];
                    return (
                      <div key={side.key}
                        className="upload-tile"
                        onClick={() => fileInputRefs.current[side.key]?.click()}
                        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
                        onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove('drag-over');
                          handleFile(side.key, e.dataTransfer.files?.[0]);
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 12px', cursor: 'pointer', borderRadius: 6,
                          border: `1.5px ${design ? 'solid' : 'dashed'} ${
                            design ? (design.lowRes ? '#d4900a' : '#d0cbbf') : side.required ? '#1a1a1a' : '#c4bfb0'
                          }`,
                          backgroundColor: design ? '#fff' : 'transparent',
                        }}>
                        <input ref={el => fileInputRefs.current[side.key] = el} type="file" accept="image/*"
                          style={{ display: 'none' }} onChange={(e) => handleFile(side.key, e.target.files?.[0])} />

                        {design ? (
                          <>
                            <div style={{
                              width: 52, height: 52, flexShrink: 0,
                              backgroundColor: '#f8f6f0', borderRadius: 4,
                              border: `1px solid ${design.lowRes ? '#f0c060' : '#e8e1cf'}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              <img src={design.preview} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', padding: 4 }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                <span style={{
                                  fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.15em',
                                  color: design.lowRes ? '#c97a2a' : '#2d5a2b', fontWeight: 600,
                                }}>
                                  {side.label.toUpperCase()}
                                </span>
                                {design.lowRes
                                  ? <span style={{
                                      fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                                      padding: '1px 6px', borderRadius: 3,
                                      backgroundColor: '#fef3e0', color: '#c97a2a',
                                    }}>LOW RES</span>
                                  : <Check size={11} strokeWidth={3} style={{ color: '#2d5a2b' }} />
                                }
                              </div>
                              <div style={{ fontSize: 12, color: '#6b6452', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {design.file.name}
                              </div>
                              {design.lowRes && (
                                <div style={{ fontSize: 10, color: '#c97a2a', marginTop: 2, lineHeight: 1.4 }}>
                                  {design.dims} — upload higher resolution for best results
                                </div>
                              )}
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); clearDesign(side.key); }}
                              style={{
                                flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: 'none', backgroundColor: 'transparent', cursor: 'pointer',
                                color: '#c2410c', fontSize: 14,
                              }}
                              className="hover-danger">✕</button>
                          </>
                        ) : (
                          <>
                            <div style={{
                              width: 52, height: 52, flexShrink: 0, borderRadius: 4,
                              backgroundColor: '#f0ece2',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              <Upload size={20} strokeWidth={1.5} style={{ color: '#a39d8d' }} />
                            </div>
                            <div>
                              <div style={{
                                fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                                letterSpacing: '0.15em', color: side.required ? '#1a1a1a' : '#6b6452',
                                fontWeight: 600, marginBottom: 3,
                              }}>
                                {side.label.toUpperCase()}
                              </div>
                              <div style={{ fontSize: 11, color: '#a39d8d' }}>
                                {side.required ? 'Required · click or drag to upload' : 'Optional · click or drag to upload'}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Mode toggle — sliding pill */}
              <div>
                <div style={{ position: 'relative', display: 'flex', borderRadius: 6, border: '1px solid #d6d0c0', backgroundColor: '#fff', overflow: 'hidden' }}>
                  {/* Sliding background */}
                  <div style={{
                    position: 'absolute', top: 0, bottom: 0, width: '50%',
                    backgroundColor: '#1a1a1a', borderRadius: 0,
                    transform: autoMode ? 'translateX(0%)' : 'translateX(100%)',
                    transition: 'transform 0.2s ease',
                  }} />
                  {[
                    { val: true,  icon: <Sparkles size={13} />, label: 'SURPRISE ME' },
                    { val: false, icon: <span style={{ fontSize: 14 }}>⊞</span>, label: 'CHOOSE COLOURS' },
                  ].map(({ val, icon, label }) => (
                    <button key={label} onClick={() => setAutoMode(val)}
                      style={{
                        position: 'relative', zIndex: 1, flex: 1, padding: '11px 8px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        fontFamily: 'Anton, sans-serif', fontSize: 12, letterSpacing: '0.06em',
                        color: (autoMode === val) ? '#fff' : '#6b6452',
                        border: 'none', backgroundColor: 'transparent', cursor: 'pointer',
                        transition: 'color 0.2s ease',
                      }}>
                      {icon} {label}
                    </button>
                  ))}
                </div>
                {autoMode && (
                  <p style={{ fontSize: 12, color: '#6b6452', marginTop: 8, lineHeight: 1.6, paddingLeft: 2 }}>
                    We'll read your logo and choose the best colours, stripes, and finish.
                    Hit <strong>Try Again</strong> to explore a new combination.
                  </p>
                )}
              </div>

              {/* Customise panel */}
              {!autoMode && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                  {/* Colour palette */}
                  <div className="card">
                    <div className="section-label">CAP COLOUR</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
                      {CAP_COLORS.map(c => {
                        const sel = allMatch(c.hex);
                        return (
                          <button key={c.hex} title={c.name}
                            onClick={() => setAllColors(c.hex)}
                            style={{
                              aspectRatio: '1', backgroundColor: c.hex, borderRadius: 4,
                              border: sel ? '2px solid #c2410c' : '1px solid rgba(0,0,0,0.12)',
                              boxShadow: sel ? '0 0 0 2px #f5f1e8, 0 0 0 3.5px #c2410c' : 'none',
                              cursor: 'pointer', position: 'relative',
                              transition: 'transform 0.1s ease, box-shadow 0.15s ease',
                            }}
                            className="swatch-btn">
                            {sel && (
                              <Check size={10} strokeWidth={3.5}
                                style={{ color: isLight(c.hex) ? '#000' : '#fff', position: 'absolute', inset: 0, margin: 'auto', display: 'block' }} />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Advanced disclosure */}
                    <button onClick={() => setShowAdvanced(v => !v)}
                      style={{
                        marginTop: 10, width: '100%', display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', padding: '7px 10px', borderRadius: 4,
                        border: '1px solid #e8e1cf', backgroundColor: 'transparent', cursor: 'pointer',
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.1em',
                        color: '#6b6452',
                      }}
                      className="hover-subtle">
                      <span>ADJUST INDIVIDUAL PARTS</span>
                      {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>

                    {showAdvanced && (
                      <div style={{ marginTop: 8, paddingTop: 10, borderTop: '1px solid #f0ece2', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {[
                          { key: 'front', label: 'Front' },
                          { key: 'mesh',  label: 'Mesh'  },
                          { key: 'brim',  label: 'Brim'  },
                        ].map(part => (
                          <div key={part.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                              letterSpacing: '0.12em', color: '#6b6452', width: 36, flexShrink: 0,
                            }}>
                              {part.label.toUpperCase()}
                            </span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
                              {CAP_COLORS.map(c => {
                                const sel = colors[part.key].toLowerCase() === c.hex.toLowerCase();
                                return (
                                  <button key={c.hex} title={c.name}
                                    onClick={() => setColor(part.key, c.hex)}
                                    style={{
                                      width: 18, height: 18, borderRadius: 3,
                                      backgroundColor: c.hex,
                                      border: sel ? '2px solid #c2410c' : '1px solid rgba(0,0,0,0.1)',
                                      cursor: 'pointer',
                                      transition: 'transform 0.1s ease',
                                    }}
                                    className="swatch-btn"
                                  />
                                );
                              })}
                            </div>
                          </div>
                        ))}

                        {/* Sandwich brim */}
                        <div style={{ paddingTop: 8, marginTop: 2, borderTop: '1px solid #f0ece2' }}>
                          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                            <div>
                              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.1em', color: '#1a1a1a', fontWeight: 600 }}>
                                SANDWICH BRIM
                              </div>
                              <div style={{ fontSize: 10, color: '#a39d8d', marginTop: 2 }}>
                                Contrasting colour on brim underside
                              </div>
                            </div>
                            <input type="checkbox" checked={sandwichBrim} onChange={(e) => setSandwichBrim(e.target.checked)} />
                          </label>
                          {sandwichBrim && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#6b6452' }}>COLOUR</span>
                              <input type="color" value={sandwichColor} onChange={(e) => setSandwichColor(e.target.value)} style={{ width: 32, height: 32 }} />
                              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6b6452' }}>{sandwichColor}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Stripes */}
                  <div className="card">
                    <div className="section-label">SIDE STRIPES</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {STRIPE_OPTIONS.map(n => (
                        <button key={n} onClick={() => setStripeCount(n)}
                          style={{
                            flex: 1, padding: '10px 4px', textAlign: 'center', borderRadius: 4,
                            fontFamily: 'Anton, sans-serif', fontSize: 13, letterSpacing: '0.04em',
                            backgroundColor: stripeCount === n ? '#1a1a1a' : 'transparent',
                            color: stripeCount === n ? '#f5f1e8' : '#6b6452',
                            border: `1px solid ${stripeCount === n ? '#1a1a1a' : '#d6d0c0'}`,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}>
                          {n === 0 ? 'NONE' : n}
                        </button>
                      ))}
                    </div>
                    {stripeCount > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0ece2' }}>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.12em', color: '#6b6452' }}>
                          STRIPE COLOUR
                        </span>
                        <input type="color" value={stripeColor} onChange={(e) => setStripeColor(e.target.value)} style={{ width: 32, height: 32 }} />
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6b6452' }}>{stripeColor}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Sticky CTA */}
            <div style={{
              position: 'sticky', bottom: 0, zIndex: 10,
              padding: '14px 20px',
              borderTop: '1px solid #d6d0c0',
              backgroundColor: 'rgba(245,241,232,0.97)',
              backdropFilter: 'blur(8px)',
            }}>
              {!designs.front && !generating && (
                <p style={{
                  textAlign: 'center', fontSize: 11, color: '#a39d8d',
                  fontFamily: 'JetBrains Mono, monospace', marginBottom: 10,
                }}>
                  Upload a front panel logo to get started
                </p>
              )}
              <button onClick={handleGenerate} disabled={!canGenerate}
                className="cta-button"
                style={{
                  width: '100%', padding: '14px 24px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  fontFamily: 'Anton, sans-serif', fontSize: 15, letterSpacing: '0.08em',
                  backgroundColor: canGenerate ? '#c2410c' : '#d6d0c0',
                  color: canGenerate ? '#fff' : '#a39d8d',
                  border: 'none', borderRadius: 6, cursor: canGenerate ? 'pointer' : 'not-allowed',
                  transition: 'background-color 0.2s ease, opacity 0.2s ease',
                }}>
                {generating
                  ? <><Loader2 size={18} className="animate-spin" /> WORKING…</>
                  : <><Sparkles size={18} /> CREATE PREVIEW</>
                }
              </button>
            </div>
          </aside>

          {/* ═══ RIGHT PANEL ═════════════════════════════════════════════ */}
          <main style={{ flex: 1, minWidth: 0, padding: '32px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>

            {/* Empty state */}
            {!result && !generating && !error && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
                    <CapOutline />
                  </div>
                  <p style={{ fontSize: 13, color: '#a39d8d', lineHeight: 1.6 }}>
                    {designs.front
                      ? <>Ready — hit <span style={{ color: '#c2410c', fontWeight: 700 }}>Create Preview</span> to see your cap</>
                      : 'Upload your logo and we\'ll generate a preview'
                    }
                  </p>
                </div>
              </div>
            )}

            {/* Error state */}
            {error && !generating && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                <div style={{ maxWidth: 380, width: '100%' }}>
                  <div style={{
                    padding: '20px 24px', borderRadius: 8,
                    backgroundColor: '#fdf0f0', border: '1px solid #f4c0c0',
                  }}>
                    <p style={{ fontFamily: 'Anton, sans-serif', color: '#a83232', letterSpacing: '0.03em', marginBottom: 8 }}>
                      SOMETHING WENT WRONG
                    </p>
                    <p style={{ fontSize: 13, color: '#5a2020', marginBottom: 16, lineHeight: 1.6 }}>{error}</p>
                    <button onClick={handleGenerate} disabled={!canGenerate}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 16px', borderRadius: 4,
                        border: '1.5px solid #a83232', color: '#a83232',
                        fontFamily: 'Anton, sans-serif', fontSize: 12, letterSpacing: '0.03em',
                        backgroundColor: 'transparent', cursor: 'pointer',
                      }}>
                      <RefreshCw size={13} /> TRY AGAIN
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Loading state */}
            {generating && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                <div style={{ maxWidth: 280, width: '100%' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 32 }}>
                    {LOADING_STEPS.map((step, i) => {
                      const done    = i < loadingStep;
                      const current = i === loadingStep;
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: i > loadingStep ? 0.22 : 1, transition: 'opacity 0.4s ease' }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            backgroundColor: done ? '#2d5a2b' : current ? '#c2410c' : 'transparent',
                            border: `2px solid ${done ? '#2d5a2b' : current ? '#c2410c' : '#d6d0c0'}`,
                            transition: 'all 0.3s ease',
                          }}>
                            {done    && <Check size={12} strokeWidth={3} style={{ color: '#fff' }} />}
                            {current && <Loader2 size={12} className="animate-spin" style={{ color: '#fff' }} />}
                          </div>
                          <span style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: current ? 13 : 12,
                            color: done ? '#2d5a2b' : current ? '#1a1a1a' : '#a39d8d',
                            fontWeight: current ? 600 : 400,
                            transition: 'all 0.3s ease',
                          }}>
                            {step.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#a39d8d', textAlign: 'center', letterSpacing: '0.08em' }}>
                    USUALLY 15–25 SECONDS
                  </p>
                </div>
              </div>
            )}

            {/* Result */}
            {result && !generating && (
              <div style={{ width: '100%', maxWidth: 680 }}>

                {/* Cap image */}
                <div style={{
                  borderRadius: 10, overflow: 'hidden',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)',
                  border: '1px solid rgba(0,0,0,0.06)',
                  marginBottom: 14,
                }}>
                  <img src={result.imageUrl} alt="Your custom cap" style={{ width: '100%', display: 'block' }} />
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                  <button onClick={handleGenerate}
                    style={{
                      flex: 1, padding: '12px 20px', borderRadius: 6,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      border: '1.5px solid #1a1a1a', backgroundColor: 'transparent',
                      fontFamily: 'Anton, sans-serif', fontSize: 13, letterSpacing: '0.04em',
                      cursor: 'pointer', color: '#1a1a1a',
                    }}
                    className="hover-subtle">
                    <RefreshCw size={14} /> TRY AGAIN
                  </button>
                  {result.shareId && (
                    <a href={`/share/${result.shareId}`} target="_blank" rel="noopener noreferrer"
                      style={{
                        flex: 1, padding: '12px 20px', borderRadius: 6,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        backgroundColor: '#c2410c', color: '#fff', textDecoration: 'none',
                        fontFamily: 'Anton, sans-serif', fontSize: 13, letterSpacing: '0.04em',
                      }}>
                      VIEW YOUR CAP →
                    </a>
                  )}
                </div>

                {/* Model shots */}
                <div style={{ paddingTop: 20, borderTop: '1px solid #d6d0c0' }}>
                  <div className="section-label" style={{ marginBottom: 12 }}>SEE IT ON MODELS</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    {Object.entries(MODEL_LABELS).map(([key, label]) => {
                      const shot = modelShots[key];
                      return (
                        <div key={key} style={{
                          borderRadius: 8, overflow: 'hidden',
                          border: '1px solid #d6d0c0', backgroundColor: '#fff',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                        }}>
                          {shot === null && (
                            <button onClick={() => handleModelShot(key)}
                              style={{
                                width: '100%', aspectRatio: '3/4',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                                backgroundColor: '#f8f6f0', border: 'none', cursor: 'pointer',
                                transition: 'background-color 0.15s ease',
                              }}
                              className="hover-subtle">
                              <PersonSilhouette />
                              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', color: '#a39d8d' }}>
                                {label.toUpperCase()}
                              </span>
                            </button>
                          )}
                          {shot === 'loading' && (
                            <div style={{
                              width: '100%', aspectRatio: '3/4',
                              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                              backgroundColor: '#fafaf7',
                            }}>
                              <Loader2 size={20} className="animate-spin" style={{ color: '#c2410c' }} />
                              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.2em', color: '#a39d8d' }}>
                                {label.toUpperCase()}
                              </span>
                            </div>
                          )}
                          {shot && shot !== 'loading' && shot.imageUrl && (
                            <>
                              <img src={shot.imageUrl} alt={label} style={{ width: '100%', display: 'block' }} />
                              <button onClick={() => handleModelShot(key)}
                                style={{
                                  width: '100%', padding: '8px', borderTop: '1px solid #f0ece2',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                  fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.12em',
                                  color: '#a39d8d', backgroundColor: 'transparent', border: 'none', cursor: 'pointer',
                                  transition: 'color 0.15s ease, background-color 0.15s ease',
                                }}
                                className="hover-subtle">
                                <RefreshCw size={9} /> RETRY
                              </button>
                            </>
                          )}
                          {shot && shot !== 'loading' && shot.error && (
                            <button onClick={() => handleModelShot(key)}
                              style={{
                                width: '100%', aspectRatio: '3/4',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                                backgroundColor: '#fdf8f8', border: 'none', cursor: 'pointer',
                                transition: 'background-color 0.15s ease',
                              }}
                              className="hover-subtle">
                              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#a83232' }}>FAILED</span>
                              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#c4bfb0' }}>TAP TO RETRY</span>
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
    </div>
  );
}
