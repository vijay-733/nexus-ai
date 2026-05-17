import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Download, RefreshCw, Zap, Sparkles, Camera, Star, Film,
  Cpu, Droplets, Pencil, Wand2, Loader2, AlertCircle, Check,
  LayoutGrid, Image as ImageIcon, Copy, Palette, Wifi, WifiOff,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  generateImage, enhancePrompt, getServerStatus,
  type GeneratedImage, type ImageProvider, type ImageQuality,
} from '../services/imageService';

interface Props {
  mirror?: boolean;
  addToWorkspace: (content: string) => void;
  setModule: (m: string) => void;
}

interface StylePreset {
  id: string;
  name: string;
  icon: React.ElementType;
  gradient: string;
}

const STYLE_PRESETS: StylePreset[] = [
  { id: 'photorealistic', name: 'Realistic',  icon: Camera,   gradient: 'from-sky-500 to-blue-600'      },
  { id: 'anime',          name: 'Anime',       icon: Star,     gradient: 'from-pink-500 to-rose-500'     },
  { id: 'cinematic',      name: 'Cinematic',   icon: Film,     gradient: 'from-amber-500 to-orange-600'  },
  { id: 'oilpainting',    name: 'Oil Paint',   icon: Palette,  gradient: 'from-yellow-500 to-amber-600'  },
  { id: 'scifi',          name: 'Sci-Fi',      icon: Cpu,      gradient: 'from-purple-500 to-violet-600' },
  { id: 'watercolor',     name: 'Watercolor',  icon: Droplets, gradient: 'from-teal-400 to-emerald-500'  },
  { id: 'sketch',         name: 'Sketch',      icon: Pencil,   gradient: 'from-gray-400 to-slate-500'    },
  { id: 'fantasy',        name: 'Fantasy',     icon: Sparkles, gradient: 'from-fuchsia-500 to-purple-600'},
];

type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

const ASPECT_RATIOS: { ratio: AspectRatio; label: string; w: number; h: number }[] = [
  { ratio: '1:1',  label: 'Square',    w: 1,  h: 1  },
  { ratio: '16:9', label: 'Landscape', w: 16, h: 9  },
  { ratio: '9:16', label: 'Portrait',  w: 9,  h: 16 },
  { ratio: '4:3',  label: 'Classic',   w: 4,  h: 3  },
  { ratio: '3:4',  label: 'Photo',     w: 3,  h: 4  },
];

const QUICK_PROMPTS = [
  'Bioluminescent deep ocean abyss, ethereal jellyfish, volumetric light rays',
  'Cyberpunk samurai on neon-lit Tokyo rooftop at midnight, rain',
  'Ancient crystalline cave, glowing minerals, underground lake reflection',
  'Ethereal fox spirit crossing misty bamboo forest at dawn, Japan',
  'Retro-futuristic space station interior, warm sunset through porthole',
  'Macro photograph of a dewy spider web, golden morning light refraction',
];

const PROVIDER_META: Record<string, { label: string; color: string; dot: string }> = {
  openai:       { label: 'OpenAI',       color: 'text-emerald-400/70 border-emerald-400/20 bg-emerald-400/5', dot: 'bg-emerald-400' },
  stability:    { label: 'Stability AI', color: 'text-violet-400/70 border-violet-400/20 bg-violet-400/5',   dot: 'bg-violet-400'  },
  pollinations: { label: 'Free · FLUX',  color: 'text-cyan-400/70 border-cyan-400/20 bg-cyan-400/5',         dot: 'bg-cyan-400'    },
  offline:      { label: 'Offline',      color: 'text-rose-400/70 border-rose-400/20 bg-rose-400/5',         dot: 'bg-rose-400'    },
};

export function ImageForge({ mirror = false, addToWorkspace, setModule }: Props) {
  const [prompt, setPrompt]               = useState('');
  const [style, setStyle]                 = useState('photorealistic');
  const [aspectRatio, setAspectRatio]     = useState<AspectRatio>('1:1');
  const [quality, setQuality]             = useState<ImageQuality>('standard');
  const [seed, setSeed]                   = useState(Math.floor(Math.random() * 999_999));
  const [loading, setLoading]             = useState(false);
  const [enhancing, setEnhancing]         = useState(false);
  const [currentImage, setCurrentImage]   = useState<GeneratedImage | null>(null);
  const [history, setHistory]             = useState<GeneratedImage[]>([]);
  const [error, setError]                 = useState<string | null>(null);
  const [copied, setCopied]               = useState(false);
  const [serverProvider, setServerProvider] = useState<string>('…');

  // On mount, ping /api/status to show which provider is active
  useEffect(() => {
    getServerStatus().then(s => setServerProvider(s.imageProvider));
  }, []);

  const accentClass = mirror ? 'from-blue-500 to-cyan-500' : 'from-purple-500 to-blue-500';
  const accentGlow  = mirror ? 'shadow-blue-500/30'        : 'shadow-purple-500/30';
  const dotColor    = mirror ? 'bg-blue-400'               : 'bg-purple-400';

  const handleGenerate = async (customPrompt?: string, customSeed?: number) => {
    const p = (customPrompt ?? prompt).trim();
    if (!p || loading) return;
    setLoading(true);
    setError(null);
    try {
      const img = await generateImage({ prompt: p, style, aspectRatio, seed: customSeed ?? seed, quality });
      setCurrentImage(img);
      setHistory(prev => [img, ...prev].slice(0, 20));
      setSeed(Math.floor(Math.random() * 999_999));
      setServerProvider(img.source); // keep status badge in sync
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Generation failed. Check the server.');
    } finally {
      setLoading(false);
    }
  };

  const handleEnhance = async () => {
    if (!prompt.trim() || enhancing) return;
    setEnhancing(true);
    try {
      setPrompt(await enhancePrompt(prompt));
    } catch { /* silent */ } finally { setEnhancing(false); }
  };

  const handleDownload = (img: GeneratedImage) => {
    const a = document.createElement('a');
    a.href = img.url;
    a.download = `nexus_${img.timestamp}.png`;
    a.click();
  };

  const handleCopy = async () => {
    if (!currentImage) return;
    await navigator.clipboard.writeText(currentImage.revisedPrompt ?? currentImage.prompt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const providerKey = currentImage?.source ?? (serverProvider as ImageProvider | '…');
  const providerUI  = PROVIDER_META[providerKey] ?? PROVIDER_META['pollinations'];

  const aspectBoxStyle = (w: number, h: number) => {
    const max = Math.max(w, h);
    return { width: `${Math.round(22 * w / max)}px`, height: `${Math.round(22 * h / max)}px` };
  };

  return (
    <div className="flex flex-col bg-black" style={{ minHeight: '100vh' }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-white/5 bg-black/70 backdrop-blur-xl sticky top-0 z-10">
        <button
          onClick={() => setModule('dashboard')}
          className="flex items-center gap-2 text-white/30 hover:text-white transition-colors text-xs font-mono uppercase tracking-widest group"
        >
          <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
          Dashboard
        </button>

        <div className="flex items-center gap-2.5">
          <span className={cn('w-1.5 h-1.5 rounded-full animate-pulse', dotColor)} />
          <span className="text-[10px] font-mono text-white/40 uppercase tracking-[0.3em]">
            {mirror ? 'Synthesis Mirror' : 'Image Forge'} · v4.0
          </span>
        </div>

        {/* Provider badge */}
        <span className={cn(
          'text-[9px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-full border flex items-center gap-1.5',
          providerUI.color,
        )}>
          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', providerUI.dot)} />
          {providerUI.label}
        </span>
      </div>

      {/* ── Main layout ─────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left Sidebar ──────────────────────────────────────────── */}
        <div className="w-64 flex-shrink-0 border-r border-white/5 flex flex-col overflow-y-auto bg-black/40 custom-scrollbar">

          {/* Style presets */}
          <div className="p-4 border-b border-white/5">
            <p className="text-[8px] font-mono text-white/20 uppercase tracking-[0.35em] mb-3">Style Preset</p>
            <div className="grid grid-cols-2 gap-1.5">
              {STYLE_PRESETS.map(preset => {
                const Icon = preset.icon;
                const active = style === preset.id;
                return (
                  <motion.button key={preset.id} whileTap={{ scale: 0.95 }}
                    onClick={() => setStyle(preset.id)}
                    className={cn(
                      'relative flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all duration-200 group',
                      active ? 'border-white/25 bg-white/8' : 'border-white/5 hover:border-white/12 bg-white/[0.02] hover:bg-white/[0.04]',
                    )}
                  >
                    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br', preset.gradient)}>
                      <Icon className="w-3.5 h-3.5 text-white" />
                    </div>
                    <span className={cn('text-[8px] font-mono uppercase tracking-wide leading-tight transition-colors',
                      active ? 'text-white/80' : 'text-white/30 group-hover:text-white/55')}>
                      {preset.name}
                    </span>
                    {active && <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-white/80" />}
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Aspect ratio */}
          <div className="p-4 border-b border-white/5">
            <p className="text-[8px] font-mono text-white/20 uppercase tracking-[0.35em] mb-3">Aspect Ratio</p>
            <div className="space-y-1">
              {ASPECT_RATIOS.map(({ ratio, label, w, h }) => (
                <button key={ratio} onClick={() => setAspectRatio(ratio)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-xl border transition-all text-left',
                    aspectRatio === ratio
                      ? 'border-white/25 bg-white/8 text-white'
                      : 'border-white/5 bg-white/[0.02] text-white/35 hover:text-white/65 hover:border-white/12',
                  )}
                >
                  <div className="border border-current flex-shrink-0 rounded-[2px]" style={aspectBoxStyle(w, h)} />
                  <span className="text-[9px] font-mono uppercase tracking-wider">{ratio}</span>
                  <span className="text-[8px] text-white/20 ml-auto">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Output Size */}
          <div className="p-4 border-b border-white/5">
            <p className="text-[8px] font-mono text-white/20 uppercase tracking-[0.35em] mb-3">Output Size</p>
            <div className="space-y-1">
              {([
                { q: 'standard' as ImageQuality, label: 'Standard', px: '1024 px', desc: 'Fast' },
                { q: 'large'    as ImageQuality, label: 'Large',    px: '1536 px', desc: 'Balanced' },
                { q: 'ultra'    as ImageQuality, label: 'Ultra',    px: '2048 px', desc: 'Slow' },
              ]).map(({ q, label, px, desc }) => (
                <button key={q} onClick={() => setQuality(q)}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 rounded-xl border transition-all text-left',
                    quality === q
                      ? 'border-white/25 bg-white/8 text-white'
                      : 'border-white/5 bg-white/[0.02] text-white/35 hover:text-white/65 hover:border-white/12',
                  )}
                >
                  <span className="text-[9px] font-mono uppercase tracking-wider">{label}</span>
                  <span className="text-[8px] text-white/30 font-mono">{px}</span>
                  <span className="text-[8px] text-white/20">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Seed */}
          <div className="p-4">
            <p className="text-[8px] font-mono text-white/20 uppercase tracking-[0.35em] mb-3">Seed</p>
            <div className="flex items-center gap-2 mb-1.5">
              <input
                type="number"
                value={seed}
                onChange={e => setSeed(Number(e.target.value))}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] font-mono text-white/50 focus:outline-none focus:border-white/25 transition-colors min-w-0"
              />
              <button onClick={() => setSeed(Math.floor(Math.random() * 999_999))}
                className="p-2 rounded-xl border border-white/10 bg-white/5 text-white/25 hover:text-white/70 hover:border-white/25 transition-all flex-shrink-0"
                title="Randomize seed"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[8px] font-mono text-white/12 leading-relaxed">Same seed + prompt = consistent output</p>

            {/* Server status */}
            <div className="mt-4 p-2.5 rounded-xl border border-white/5 bg-white/[0.02]">
              <div className="flex items-center gap-2 mb-1">
                {serverProvider === 'offline'
                  ? <WifiOff className="w-3 h-3 text-rose-400/60" />
                  : <Wifi className="w-3 h-3 text-emerald-400/60" />
                }
                <span className="text-[8px] font-mono text-white/20 uppercase tracking-[0.2em]">Image Server</span>
              </div>
              <p className="text-[9px] font-mono text-white/40">
                {serverProvider === '…' ? 'Checking…'
                  : serverProvider === 'offline' ? 'Offline — run: npm run server'
                  : serverProvider === 'pollinations' ? 'Free · Pollinations FLUX'
                  : serverProvider === 'openai' ? 'OpenAI gpt-image-1'
                  : 'Stability AI Core'}
              </p>
            </div>
          </div>
        </div>

        {/* ── Main Canvas ───────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Image display */}
          <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
            <AnimatePresence mode="wait">

              {loading && (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-8"
                >
                  <div className="relative w-64 h-64 rounded-3xl border border-white/5 overflow-hidden flex items-center justify-center">
                    <motion.div
                      animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
                      transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                      className="absolute inset-0 opacity-25"
                      style={{
                        background: mirror
                          ? 'linear-gradient(135deg,#1d4ed8,#0891b2,#1d4ed8)'
                          : 'linear-gradient(135deg,#7c3aed,#1d4ed8,#db2777)',
                        backgroundSize: '200% 200%',
                      }}
                    />
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}>
                      <Loader2 className={cn('w-12 h-12 relative z-10', mirror ? 'text-blue-300' : 'text-purple-300')} />
                    </motion.div>
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-mono text-white/40 uppercase tracking-[0.4em] animate-pulse">
                      Synthesizing neural field
                    </p>
                    <p className="text-[9px] font-mono text-white/15 mt-1.5">{style} · {aspectRatio} · seed {seed}</p>
                  </div>
                </motion.div>
              )}

              {!loading && error && (
                <motion.div key="error" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-5 max-w-md text-center"
                >
                  <div className="w-16 h-16 rounded-2xl bg-rose-500/8 border border-rose-500/20 flex items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-rose-400" />
                  </div>
                  <div>
                    <p className="text-sm font-mono text-rose-400 font-bold mb-3">Generation Failed</p>
                    <p className="text-xs text-white/40 leading-relaxed whitespace-pre-line">{error}</p>
                  </div>
                  <button onClick={() => setError(null)}
                    className="px-5 py-2 rounded-xl border border-white/10 text-[9px] font-mono text-white/30 hover:text-white hover:border-white/25 transition-all uppercase tracking-widest"
                  >
                    Dismiss
                  </button>
                </motion.div>
              )}

              {!loading && !error && currentImage && (
                <motion.div key="image" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-4 w-full max-w-2xl"
                >
                  {/* Warning banner (e.g. provider fell back) */}
                  {currentImage.warning && (
                    <div className="w-full px-4 py-2 rounded-xl border border-amber-500/20 bg-amber-500/5 text-[9px] font-mono text-amber-400/70">
                      ⚠ {currentImage.warning}
                    </div>
                  )}

                  {/* Image */}
                  <div className="relative group w-full rounded-2xl overflow-hidden border border-white/8 shadow-2xl">
                    <img
                      src={currentImage.url}
                      alt={currentImage.prompt}
                      className="w-full object-contain max-h-[55vh]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-end">
                      <p className="p-4 text-[9px] font-mono text-white/60 line-clamp-2">
                        {currentImage.revisedPrompt ?? currentImage.prompt}
                      </p>
                    </div>
                  </div>

                  {/* Action bar */}
                  <div className="flex items-center gap-2 w-full">
                    <button onClick={() => handleDownload(currentImage)}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/6 border border-white/8 hover:bg-white/12 hover:border-white/20 text-white/70 hover:text-white text-[9px] font-mono uppercase tracking-wider transition-all"
                    >
                      <Download className="w-3.5 h-3.5" /> Download
                    </button>
                    <button onClick={() => handleGenerate(currentImage.prompt, Math.floor(Math.random() * 999_999))}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/6 border border-white/8 hover:bg-white/12 hover:border-white/20 text-white/70 hover:text-white text-[9px] font-mono uppercase tracking-wider transition-all"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Regenerate
                    </button>
                    <button onClick={handleCopy}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/6 border border-white/8 hover:bg-white/12 hover:border-white/20 text-white/70 hover:text-white text-[9px] font-mono uppercase tracking-wider transition-all"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? 'Copied' : 'Prompt'}
                    </button>
                    <button
                      onClick={() => addToWorkspace(`IMAGE: ${currentImage.url}\nPROMPT: ${currentImage.prompt}`)}
                      className="p-2.5 rounded-xl bg-white/6 border border-white/8 hover:bg-white/12 hover:border-white/20 text-white/50 hover:text-white transition-all"
                      title="Add to Workspace"
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Metadata */}
                  <div className="flex items-center gap-3 text-[8px] font-mono text-white/15 w-full px-1 flex-wrap">
                    <span>Seed {currentImage.seed}</span>
                    <span>·</span>
                    <span>{currentImage.style.toUpperCase()}</span>
                    <span>·</span>
                    <span>{currentImage.aspectRatio}</span>
                    <span>·</span>
                    <span className={PROVIDER_META[currentImage.source]?.dot.replace('bg-', 'text-') + '/60'}>
                      {PROVIDER_META[currentImage.source]?.label ?? currentImage.source}
                    </span>
                  </div>
                </motion.div>
              )}

              {!loading && !error && !currentImage && (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="flex flex-col items-center gap-8 text-center select-none"
                >
                  <div className="w-36 h-36 rounded-3xl border border-dashed border-white/8 flex items-center justify-center">
                    <ImageIcon className="w-12 h-12 text-white/8" />
                  </div>
                  <div>
                    <p className="text-sm font-mono text-white/15 uppercase tracking-[0.3em]">Neural canvas empty</p>
                    <p className="text-[10px] text-white/8 mt-2">Enter a prompt below — ⌘ + Enter to generate</p>
                  </div>

                  {/* Quick prompts */}
                  <div className="grid grid-cols-2 gap-2 max-w-xl w-full">
                    {QUICK_PROMPTS.map(p => (
                      <button key={p} onClick={() => setPrompt(p)}
                        className="px-3 py-2.5 rounded-xl border border-white/6 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15 text-[9px] font-mono text-white/25 hover:text-white/55 transition-all text-left leading-relaxed"
                      >
                        {p.slice(0, 55)}…
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}

            </AnimatePresence>
          </div>

          {/* ── Prompt input ─────────────────────────────────────────── */}
          <div className="border-t border-white/5 bg-black/50 p-4">
            <div className="flex items-end gap-3">
              <div className="flex-1 relative">
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleGenerate(); }
                  }}
                  placeholder="Describe your vision — subject, style, lighting, mood, composition, color palette…"
                  rows={3}
                  className="w-full bg-white/4 border border-white/8 rounded-2xl px-5 py-4 text-white text-sm placeholder:text-white/12 focus:outline-none focus:border-white/22 resize-none transition-colors custom-scrollbar leading-relaxed"
                />
                <div className="absolute bottom-3 left-5">
                  <span className="text-[8px] font-mono text-white/12">{prompt.length} chars · ⌘+Enter to generate</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 flex-shrink-0">
                <button onClick={handleEnhance} disabled={!prompt.trim() || enhancing}
                  title="AI-enhance prompt (adds vivid detail)"
                  className="p-3 rounded-2xl border border-white/10 bg-white/4 text-white/30 hover:text-white hover:border-white/25 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
                >
                  {enhancing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
                </button>
                <button onClick={() => handleGenerate()} disabled={!prompt.trim() || loading}
                  title="Generate (⌘+Enter)"
                  className={cn(
                    'p-3 rounded-2xl transition-all',
                    prompt.trim() && !loading
                      ? cn(`bg-gradient-to-br ${accentClass} text-white hover:scale-105 active:scale-95 shadow-lg`, accentGlow)
                      : 'bg-white/4 border border-white/8 text-white/15 cursor-not-allowed',
                  )}
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>

          {/* ── History gallery ──────────────────────────────────────── */}
          {history.length > 0 && (
            <div className="border-t border-white/5 bg-black/60 px-4 py-3">
              <div className="flex items-center gap-3 mb-2.5">
                <span className="text-[8px] font-mono text-white/18 uppercase tracking-[0.3em]">Session History</span>
                <span className="text-[7px] font-mono text-white/10">{history.length} / 20</span>
              </div>
              <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-0.5">
                {history.map(img => (
                  <motion.button key={img.timestamp}
                    whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.96 }}
                    onClick={() => setCurrentImage(img)}
                    className={cn(
                      'flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden border transition-all',
                      currentImage?.timestamp === img.timestamp
                        ? 'border-white/40 ring-1 ring-white/20'
                        : 'border-white/8 opacity-60 hover:opacity-100 hover:border-white/25',
                    )}
                  >
                    <img src={img.url} alt={img.prompt} className="w-full h-full object-cover" />
                  </motion.button>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
