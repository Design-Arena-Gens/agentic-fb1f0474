'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnalysisResult,
  RemixOptions,
  RemixStyle,
  analyzeAudioBuffer,
  audioBufferToWav,
  decodeAudioFile,
  ensureAudioContext,
  generateRemix,
} from '@/lib/audio';
import { ArrowDownTrayIcon, MusicalNoteIcon, ShareIcon } from '@heroicons/react/24/outline';
import { twMerge } from 'tailwind-merge';

const STYLES: { label: string; value: RemixStyle; accent: string }[] = [
  { label: 'Electronic Pulse', value: 'electronic', accent: 'from-cyan-500 to-blue-500' },
  { label: 'Chill Drift', value: 'chill', accent: 'from-emerald-400 to-teal-500' },
  { label: 'Upbeat Surge', value: 'upbeat', accent: 'from-fuchsia-500 to-rose-500' },
];

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [remixUrl, setRemixUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [options, setOptions] = useState<RemixOptions>({
    style: 'electronic',
    tempoShift: 1,
    intensity: 0.6,
    effectDepth: 0.5,
  });

  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const remixAudioRef = useRef<HTMLAudioElement>(null);
  const scopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrame = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      if (remixUrl) URL.revokeObjectURL(remixUrl);
    };
  }, [fileUrl, remixUrl]);

  const handleFile = useCallback(async (selected: File) => {
    setAnalysis(null);
    setAnalysisError(null);
    setRemixUrl(null);
    setIsAnalyzing(true);
    try {
      const url = URL.createObjectURL(selected);
      setFileUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      const bufferDecoded = await decodeAudioFile(selected);
      setAudioBuffer(bufferDecoded);
      const result = analyzeAudioBuffer(bufferDecoded);
      setAnalysis(result);
    } catch (err) {
      console.error(err);
      setAnalysisError('Unable to analyze this audio file.');
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const onFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const selected = event.target.files?.[0];
      if (selected) {
        setFile(selected);
        void handleFile(selected);
      }
    },
    [handleFile],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      const selected = event.dataTransfer.files?.[0];
      if (selected) {
        setFile(selected);
        void handleFile(selected);
      }
    },
    [handleFile],
  );

  const drawWaveform = useCallback((wave: Float32Array) => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth * dpr;
    const height = canvas.clientHeight * dpr;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#38bdf8');
    gradient.addColorStop(1, '#6366f1');
    ctx.fillStyle = 'rgba(15, 23, 42, 0.2)';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < wave.length; i += 1) {
      const x = (i / wave.length) * width;
      const y = height / 2 - wave[i] * height * 0.45;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }, []);

  const renderVisualizer = useCallback(async () => {
    const canvas = scopeCanvasRef.current;
    const spectrumCanvas = spectrumCanvasRef.current;
    if (!canvas || !spectrumCanvas) return;

    const ctx = canvas.getContext('2d');
    const spectrumCtx = spectrumCanvas.getContext('2d');
    if (!ctx || !spectrumCtx) return;

    let audioContext = audioContextRef.current;
    if (!audioContext) {
      audioContext = await ensureAudioContext();
      audioContextRef.current = audioContext;
    }
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyserRef.current = analyser;

    if (audioRef.current) {
      const source = audioContext.createMediaElementSource(audioRef.current);
      source.connect(analyser);
      analyser.connect(audioContext.destination);
    }
    if (remixAudioRef.current) {
      const source = audioContext.createMediaElementSource(remixAudioRef.current);
      source.connect(analyser);
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const waveformArray = new Uint8Array(analyser.fftSize);

    const animate = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth * dpr;
      const height = canvas.clientHeight * dpr;
      const spectrumWidth = spectrumCanvas.clientWidth * dpr;
      const spectrumHeight = spectrumCanvas.clientHeight * dpr;

      canvas.width = width;
      canvas.height = height;
      spectrumCanvas.width = spectrumWidth;
      spectrumCanvas.height = spectrumHeight;

      analyser.getByteFrequencyData(dataArray);
      analyser.getByteTimeDomainData(waveformArray);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.12)';
      ctx.fillRect(0, 0, width, height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#22d3ee';
      ctx.beginPath();
      for (let i = 0; i < waveformArray.length; i += 1) {
        const value = waveformArray[i] / 128;
        const x = (i / waveformArray.length) * width;
        const y = value * height * 0.8;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      spectrumCtx.clearRect(0, 0, spectrumWidth, spectrumHeight);
      const gradient = spectrumCtx.createLinearGradient(0, 0, 0, spectrumHeight);
      gradient.addColorStop(0, '#ec4899');
      gradient.addColorStop(1, '#6366f1');
      for (let i = 0; i < bufferLength; i += 1) {
        const value = dataArray[i] / 255;
        const barHeight = value * spectrumHeight;
        const x = (i / bufferLength) * spectrumWidth;
        const barWidth = spectrumWidth / bufferLength + 1;
        spectrumCtx.fillStyle = gradient;
        spectrumCtx.fillRect(x, spectrumHeight - barHeight, barWidth, barHeight);
      }

      animationFrame.current = requestAnimationFrame(animate);
    };

    animationFrame.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    if (!analysis?.waveform) return;
    drawWaveform(analysis.waveform);
  }, [analysis?.waveform, drawWaveform]);

  useEffect(() => {
    if (!scopeCanvasRef.current || !spectrumCanvasRef.current) return;
    void renderVisualizer();
    return () => {
      if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
      analyserRef.current?.disconnect();
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, [renderVisualizer]);

  const generate = useCallback(async () => {
    if (!audioBuffer || !analysis) return;
    setIsRendering(true);
    try {
      const buffer = await generateRemix(audioBuffer, analysis, options);
      const wav = audioBufferToWav(buffer);
      const blob = new Blob([wav], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setRemixUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch (error) {
      console.error(error);
      setAnalysisError('Unable to render remix. Try adjusting the parameters.');
    } finally {
      setIsRendering(false);
    }
  }, [analysis, audioBuffer, options]);

  const shareRemix = useCallback(async () => {
    if (!remixUrl || !file) return;
    try {
      const response = await fetch(remixUrl);
      const blob = await response.blob();
      const remixFile = new File([blob], `${file.name.replace(/\.[^/.]+$/, '')}-remix.wav`, {
        type: 'audio/wav',
      });
      if (navigator.share && navigator.canShare?.({ files: [remixFile] })) {
        await navigator.share({
          files: [remixFile],
          title: 'DJ Remix',
        });
      } else {
        await navigator.clipboard.writeText(remixUrl);
        alert('Remix URL copied to clipboard!');
      }
    } catch (error) {
      console.error(error);
    }
  }, [file, remixUrl]);

  const downloadHref = useMemo(() => remixUrl ?? undefined, [remixUrl]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.35),_transparent_60%),radial-gradient(circle_at_bottom,_rgba(99,102,241,0.35),_transparent_55%)]" />
        <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-12 lg:px-12">
          <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.6em] text-slate-400">Agentic Remix Lab</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-50 sm:text-5xl">
                Upload. Analyze. Remix.
              </h1>
              <p className="mt-4 max-w-2xl text-base text-slate-300">
                Drop in any track and let the AI DJ console detect the groove, build breakdowns, and
                spin complex transitions automatically. Dial in the vibe, tune the energy, and walk
                away with a festival-ready remix.
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-300">
              <MusicalNoteIcon className="h-5 w-5 text-cyan-300" />
              <span>{analysis ? `${analysis.bpm.toFixed(0)} BPM • Key ${analysis.key}` : 'Awaiting track'}</span>
            </div>
          </header>

          <section className="grid gap-8 xl:grid-cols-[1.3fr_1fr]">
            <div className="flex flex-col gap-6">
              <label
                htmlFor="file"
                onDragOver={(event) => event.preventDefault()}
                onDrop={onDrop}
                className={twMerge(
                  'relative flex min-h-[220px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-12 text-center transition duration-200',
                  isAnalyzing && 'animate-pulse',
                )}
              >
                <input
                  id="file"
                  type="file"
                  accept="audio/mp3,audio/wav,audio/mpeg"
                  onChange={onFileChange}
                  className="hidden"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-white/5" />
                <div className="relative flex flex-col items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-900/80">
                    <svg
                      width="36"
                      height="36"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="text-cyan-300"
                    >
                      <path
                        d="M12 4V14M12 14L8 10M12 14L16 10M7 20H17"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-lg font-medium text-slate-50">
                      {file ? file.name : 'Upload or drag your track here'}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">MP3 or WAV, max 12 minutes</p>
                  </div>
                  {analysis && (
                    <div className="grid grid-cols-3 gap-4 text-sm text-slate-300">
                      <div>
                        <p className="text-xs uppercase text-slate-500">Tempo</p>
                        <p className="mt-1 text-slate-100">{analysis.bpm.toFixed(1)} BPM</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-slate-500">Key</p>
                        <p className="mt-1 text-slate-100">{analysis.key}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-slate-500">Dynamics</p>
                        <p className="mt-1 text-slate-100">{(analysis.rms * 100).toFixed(1)}%</p>
                      </div>
                    </div>
                  )}
                  {analysisError && (
                    <p className="text-sm text-rose-400">{analysisError}</p>
                  )}
                </div>
              </label>

              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
                <p className="text-sm uppercase tracking-[0.4em] text-slate-500">Signal Path</p>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  {STYLES.map((style) => (
                    <button
                      key={style.value}
                      type="button"
                      onClick={() => setOptions((prev) => ({ ...prev, style: style.value }))}
                      className={twMerge(
                        'group relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-left transition',
                        options.style === style.value
                          ? 'border-white/40 shadow-[0_0_25px_rgba(14,165,233,0.3)]'
                          : 'hover:border-white/20',
                      )}
                    >
                      <div
                        className={twMerge(
                          'absolute inset-0 opacity-0 transition group-hover:opacity-20',
                          `bg-gradient-to-br ${style.accent}`,
                          options.style === style.value && 'opacity-20',
                        )}
                      />
                      <p className="text-sm font-semibold text-slate-100">{style.label}</p>
                      <p className="mt-2 text-xs text-slate-400">
                        {style.value === 'electronic' && 'Glitch cuts, syncopated FX, tight transitions.'}
                        {style.value === 'chill' && 'Slow grooves, lush spatial layers, smooth rides.'}
                        {style.value === 'upbeat' && 'High energy drops, rhythmic chops, bold sweeps.'}
                      </p>
                    </button>
                  ))}
                </div>

                <div className="mt-6 grid gap-5 md:grid-cols-3">
                  <Slider
                    label="Tempo Shift"
                    value={options.tempoShift}
                    min={0.7}
                    max={1.35}
                    step={0.01}
                    format={(value) => `${Math.round(value * 100)}%`}
                    onChange={(value) => setOptions((prev) => ({ ...prev, tempoShift: value }))}
                  />
                  <Slider
                    label="Intensity"
                    value={options.intensity}
                    min={0}
                    max={1}
                    step={0.01}
                    format={(value) => `${Math.round(value * 100)}%`}
                    onChange={(value) => setOptions((prev) => ({ ...prev, intensity: value }))}
                  />
                  <Slider
                    label="Effect Depth"
                    value={options.effectDepth}
                    min={0}
                    max={1}
                    step={0.01}
                    format={(value) => `${Math.round(value * 100)}%`}
                    onChange={(value) => setOptions((prev) => ({ ...prev, effectDepth: value }))}
                  />
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.35em] text-slate-500">Remix Console</p>
                    <h2 className="mt-2 text-xl font-semibold text-slate-100">
                      Sculpt the new arrangement
                    </h2>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={generate}
                      disabled={!analysis || isRendering || isAnalyzing}
                      className={twMerge(
                        'rounded-full px-6 py-2 text-sm font-medium transition',
                        !analysis || isRendering || isAnalyzing
                          ? 'cursor-not-allowed bg-slate-700 text-slate-400'
                          : 'bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 shadow-[0_0_25px_rgba(56,189,248,0.35)] hover:from-cyan-300 hover:to-blue-400',
                      )}
                    >
                      {isRendering ? 'Rendering...' : 'Generate Remix'}
                    </button>
                    <button
                      type="button"
                      onClick={shareRemix}
                      disabled={!remixUrl}
                      className={twMerge(
                        'flex items-center gap-2 rounded-full border border-white/15 px-5 py-2 text-sm text-slate-200 transition',
                        !remixUrl
                          ? 'cursor-not-allowed border-transparent text-slate-500'
                          : 'hover:border-white/30',
                      )}
                    >
                      <ShareIcon className="h-4 w-4" />
                      Share
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid gap-6 lg:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Original Track</p>
                    <audio
                      ref={audioRef}
                      src={fileUrl ?? undefined}
                      controls
                      className="mt-2 w-full rounded-full bg-slate-800/80 p-2"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Remixed Output</p>
                      {downloadHref && (
                        <a
                          href={downloadHref}
                          download={file ? `${file.name.replace(/\.[^/.]+$/, '')}-remix.wav` : 'remix.wav'}
                          className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-slate-200 transition hover:border-white/30"
                        >
                          <ArrowDownTrayIcon className="h-4 w-4" />
                          Download
                        </a>
                      )}
                    </div>
                    <audio
                      ref={remixAudioRef}
                      src={remixUrl ?? undefined}
                      controls
                      className="mt-2 w-full rounded-full bg-slate-800/80 p-2"
                    />
                  </div>
                </div>
              </div>
            </div>

            <aside className="flex flex-col gap-6">
              <div className="rounded-3xl border border-cyan-300/20 bg-slate-900/70 p-6">
                <p className="text-xs uppercase tracking-[0.4em] text-sky-400/70">Waveform Vision</p>
                <canvas ref={waveformCanvasRef} className="mt-4 h-36 w-full rounded-2xl bg-slate-950/70" />
                <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-300">
                  <Chip label="Beat Grid" value={`${analysis?.beatGrid.length ?? 0} markers`} />
                  <Chip label="Spectral Tilt" value={analysis ? `${Math.round(analysis.spectralCentroid)} Hz` : '--'} />
                  <Chip label="Duration" value={analysis ? `${analysis.duration.toFixed(1)} s` : '--'} />
                </div>
              </div>

              <div className="rounded-3xl border border-fuchsia-300/20 bg-slate-900/70 p-6">
                <p className="text-xs uppercase tracking-[0.4em] text-fuchsia-400/70">Live Visualizer</p>
                <canvas ref={scopeCanvasRef} className="mt-4 h-32 w-full rounded-2xl bg-slate-950/70" />
                <canvas ref={spectrumCanvasRef} className="mt-4 h-24 w-full rounded-2xl bg-slate-950/70" />
                <p className="mt-4 text-xs text-slate-400">
                  The visualizer locks onto the hottest currently playing signal—switch between the original and
                  remixed decks to watch the energy morph in real time.
                </p>
              </div>

              <div className="rounded-3xl border border-emerald-300/20 bg-slate-900/70 p-6">
                <p className="text-xs uppercase tracking-[0.4em] text-emerald-400/70">Remix Blueprint</p>
                <div className="mt-4 space-y-3 text-sm text-slate-300">
                  <BlueprintItem title="Beat-synced sections">
                    Automatic detection of rhythmic anchors to slice the track into DJ-ready building blocks.
                  </BlueprintItem>
                  <BlueprintItem title="Dynamic transitions">
                    Crossfaded loops, filtered risers, and tempo-specific delays that lock to your BPM.
                  </BlueprintItem>
                  <BlueprintItem title="Scene-aware styling">
                    Remix styles guide arrangement patterns, effect curves, and stereo motion for signature moods.
                  </BlueprintItem>
                </div>
              </div>
            </aside>
          </section>
        </main>
      </div>
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}

function Slider({ label, value, min, max, step, onChange, format }: SliderProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-slate-400">
        <span>{label}</span>
        <span>{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="mt-4 h-2 w-full rounded-full bg-slate-800 accent-cyan-400"
      />
    </div>
  );
}

interface ChipProps {
  label: string;
  value: string;
}

function Chip({ label, value }: ChipProps) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/60 px-3 py-1">
      <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">{label}</span>
      <span className="text-xs font-medium text-slate-100">{value}</span>
    </div>
  );
}

interface BlueprintItemProps {
  title: string;
  children: React.ReactNode;
}

function BlueprintItem({ title, children }: BlueprintItemProps) {
  return (
    <div>
      <p className="text-sm font-semibold text-slate-100">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{children}</p>
    </div>
  );
}
