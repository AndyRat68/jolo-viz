import { useRef, useEffect, useCallback } from "react";
import type { TrackResult } from "../types";
import { COCO_CLASS_NAMES } from "../types";

const TRAIL_LEN = 20;
/** Rolling graph: window ± this many seconds around current time. */
const GRAPH_WINDOW_SEC = 2;
const GRAPH_MIN_HEIGHT = 24;
/** Default height ratio (0–1) gives ~80px when display height is ~400. */
const GRAPH_HEIGHT_RATIO_DEFAULT = 0.2;

type GraphCategory = {
  label: string;
  classNames: Set<string>;
  stroke: string;
  fillRgba: string;
};

/** Hue (0–360) to hex and rgba string. */
function hueToStrokeAndRgba(hue: number): { stroke: string; fillRgba: string } {
  const h = hue / 360;
  const s = 0.7;
  const l = 0.5;
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }
  const rr = Math.round(r * 255);
  const gg = Math.round(g * 255);
  const bb = Math.round(b * 255);
  return {
    stroke: `#${rr.toString(16).padStart(2, "0")}${gg.toString(16).padStart(2, "0")}${bb.toString(16).padStart(2, "0")}`,
    fillRgba: `${rr}, ${gg}, ${bb}`,
  };
}
function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function capitalizeLabel(name: string): string {
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build graph categories: one per COCO class + Other. */
function buildGraphCategories(): GraphCategory[] {
  const list: GraphCategory[] = [];
  for (let i = 0; i < COCO_CLASS_NAMES.length; i++) {
    const name = COCO_CLASS_NAMES[i];
    const { stroke, fillRgba } = hueToStrokeAndRgba((i * 137.508) % 360);
    list.push({
      label: name,
      classNames: new Set([name]),
      stroke,
      fillRgba,
    });
  }
  list.push({
    label: "Other",
    classNames: new Set(),
    stroke: "#95a5a6",
    fillRgba: "149, 165, 166",
  });
  return list;
}

const GRAPH_CATEGORIES = buildGraphCategories();
/** Map detection class name (lowercase) to category index. */
const CLASS_NAME_TO_INDEX = (() => {
  const m = new Map<string, number>();
  for (let c = 0; c < GRAPH_CATEGORIES.length; c++) {
    GRAPH_CATEGORIES[c].classNames.forEach((n) => m.set(n.toLowerCase(), c));
  }
  return m;
})();
const OTHER_INDEX = GRAPH_CATEGORIES.length - 1;

/** Audio level series (same chart, 0–1 scale). */
const AUDIO_GRAPH_STROKE = "#f39c12";
const AUDIO_GRAPH_FILL_RGBA = "243, 156, 18";
const AUDIO_HISTORY_MAX_SEC = 4;
const AUDIO_ANALYSER_FFT_SIZE = 256;

function trackIdToHue(id: number | null): number {
  if (id == null) return 0;
  return (id * 137.508) % 360;
}

/** Jet-like colormap: 0 -> blue, 0.5 -> green/yellow, 1 -> red. Returns rgba string. */
function saliencyToColor(v: number): string {
  const x = Math.max(0, Math.min(1, v));
  let r = 0,
    g = 0,
    b = 0;
  if (x < 0.25) {
    r = 0;
    g = 0;
    b = 128 + 127 * (x / 0.25);
  } else if (x < 0.5) {
    r = 0;
    g = 255 * ((x - 0.25) / 0.25);
    b = 255;
  } else if (x < 0.75) {
    r = 255 * ((x - 0.5) / 0.25);
    g = 255;
    b = 255 - 255 * ((x - 0.5) / 0.25);
  } else {
    r = 255;
    g = 255 - 255 * ((x - 0.75) / 0.25);
    b = 0;
  }
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.85)`;
}

function drawSaliencyHeatmap(
  ctx: CanvasRenderingContext2D,
  saliency: number[][],
  displayWidth: number,
  displayHeight: number
): void {
  const rows = saliency.length;
  const cols = rows > 0 ? saliency[0].length : 0;
  if (rows === 0 || cols === 0) return;
  const heatCanvas = document.createElement("canvas");
  heatCanvas.width = cols;
  heatCanvas.height = rows;
  const hCtx = heatCanvas.getContext("2d");
  if (!hCtx) return;
  const imgData = hCtx.createImageData(cols, rows);
  for (let y = 0; y < rows; y++) {
    const row = saliency[y];
    if (!row) continue;
    for (let x = 0; x < cols; x++) {
      const v = row[x] ?? 0;
      const c = saliencyToColor(v);
      const match = c.match(/rgba?\((\d+),(\d+),(\d+),([\d.]+)\)/);
      if (match) {
        const i = (y * cols + x) * 4;
        imgData.data[i] = parseInt(match[1], 10);
        imgData.data[i + 1] = parseInt(match[2], 10);
        imgData.data[i + 2] = parseInt(match[3], 10);
        imgData.data[i + 3] = Math.round(255 * parseFloat(match[4]));
      }
    }
  }
  hCtx.putImageData(imgData, 0, 0);
  ctx.save();
  ctx.globalAlpha = 0.65;
  ctx.drawImage(heatCanvas, 0, 0, cols, rows, 0, 0, displayWidth, displayHeight);
  ctx.restore();
}

function getAudioLevelAt(
  audioSamples: { time: number; level: number }[],
  t: number
): number {
  if (audioSamples.length === 0) return 0;
  if (audioSamples.length === 1) return audioSamples[0].level;
  let i = 0;
  while (i < audioSamples.length && audioSamples[i].time < t) i++;
  if (i === 0) return audioSamples[0].level;
  if (i >= audioSamples.length) return audioSamples[audioSamples.length - 1].level;
  const a = audioSamples[i - 1];
  const b = audioSamples[i];
  const frac = (t - a.time) / (b.time - a.time || 1);
  return a.level + frac * (b.level - a.level);
}

function drawCountGraph(
  ctx: CanvasRenderingContext2D,
  trackResult: TrackResult,
  fps: number,
  syncTime: number,
  displayWidth: number,
  displayHeight: number,
  graphHeightRatio: number,
  audioGraphHeightRatio: number,
  audioSamples: { time: number; level: number }[],
  graphCategoryVisible: Record<string, boolean>
): void {
  const graphHeight = Math.round(
    GRAPH_MIN_HEIGHT + graphHeightRatio * (displayHeight - GRAPH_MIN_HEIGHT)
  );
  const tMin = Math.max(0, syncTime - GRAPH_WINDOW_SEC);
  const tMax = syncTime + GRAPH_WINDOW_SEC;
  const frameMin = Math.floor(tMin * fps);
  const frameMax = Math.ceil(tMax * fps);
  const times: number[] = [];
  const categoryCounts = GRAPH_CATEGORIES.map(() => [] as number[]);
  for (let fi = frameMin; fi <= frameMax; fi++) {
    const fr = trackResult.frames[fi];
    const t = fi / fps;
    if (t > tMax) break;
    times.push(t);
    const counts = GRAPH_CATEGORIES.map(() => 0);
    if (fr) {
      for (let i = 0; i < (fr.names?.length ?? 0); i++) {
        const name = (fr.names[i] ?? "").toLowerCase();
        const idx = CLASS_NAME_TO_INDEX.get(name) ?? OTHER_INDEX;
        counts[idx]++;
      }
    }
    categoryCounts.forEach((arr, c) => arr.push(counts[c]));
  }
  const maxCount = Math.max(
    1,
    ...GRAPH_CATEGORIES.flatMap((_, c) =>
      graphCategoryVisible[GRAPH_CATEGORIES[c].label] ? categoryCounts[c] : []
    ).flat()
  );
  const graphTop = displayHeight - graphHeight;
  const graphLeft = 0;
  const graphW = displayWidth;
  const graphRight = graphLeft + graphW;
  const graphBottom = displayHeight;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(graphLeft, graphTop, graphW, graphHeight);
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(graphLeft, graphTop, graphW, graphHeight);
  const pad = 8;
  const x0 = graphLeft + pad;
  const x1 = graphRight - pad;
  const y0 = graphTop + pad;
  const y1 = graphBottom - pad;
  const chartW = x1 - x0;
  const chartH = y1 - y0;
  const toX = (t: number) => x0 + ((t - tMin) / (tMax - tMin || 1)) * chartW;
  const toY = (c: number) => y1 - (c / maxCount) * chartH;
  // Audio at 100% = full video height; 0% = flat at bottom. Boost display by 5x so small levels are visible.
  const AUDIO_LEVEL_BOOST = 5;
  const audioRangeH = displayHeight * Math.max(0, Math.min(1, audioGraphHeightRatio));
  const audioBaselineY = displayHeight;
  const toYAudio = (level: number) => {
    const boosted = Math.min(1, level * AUDIO_LEVEL_BOOST);
    return audioBaselineY - Math.max(0, boosted) * audioRangeH;
  };
  const curX = toX(syncTime);
  if (curX >= x0 && curX <= x1) {
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(curX, y0);
    ctx.lineTo(curX, y1);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (times.length > 0) {
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let c = 0; c < GRAPH_CATEGORIES.length; c++) {
      if (!graphCategoryVisible[GRAPH_CATEGORIES[c].label]) continue;
      const cat = GRAPH_CATEGORIES[c];
      const counts = categoryCounts[c];
      const grad = ctx.createLinearGradient(0, y0, 0, y1);
      grad.addColorStop(0, `rgba(${cat.fillRgba}, 0.4)`);
      grad.addColorStop(1, `rgba(${cat.fillRgba}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(toX(times[0]), y1);
      for (let i = 0; i < times.length; i++) {
        ctx.lineTo(toX(times[i]), toY(counts[i]));
      }
      ctx.lineTo(toX(times[times.length - 1]), y1);
      ctx.closePath();
      ctx.fill();
    }
    for (let c = 0; c < GRAPH_CATEGORIES.length; c++) {
      if (!graphCategoryVisible[GRAPH_CATEGORIES[c].label]) continue;
      const cat = GRAPH_CATEGORIES[c];
      const counts = categoryCounts[c];
      ctx.strokeStyle = cat.stroke;
      ctx.beginPath();
      ctx.moveTo(toX(times[0]), toY(counts[0]));
      for (let i = 1; i < times.length; i++) {
        ctx.lineTo(toX(times[i]), toY(counts[i]));
      }
      ctx.stroke();
    }
    // Audio: prefer pre-scanned levels; fall back to live. Draw only up to current time (flat after) so it looks live.
    const showAudio = graphCategoryVisible["Audio"] !== false;
    const preScanned = trackResult.audio_levels && trackResult.audio_levels.length > 0;
    const audioLevels = preScanned
      ? times.map((t) => {
          if (t > syncTime) return 0;
          const idx = Math.min(Math.floor(t * fps), trackResult.audio_levels!.length - 1);
          return trackResult.audio_levels![Math.max(0, idx)] ?? 0;
        })
      : times.map((t) => (t > syncTime ? 0 : getAudioLevelAt(audioSamples, t)));
    if (showAudio) {
      const audioTopY = audioBaselineY - audioRangeH;
      const audioGrad = ctx.createLinearGradient(0, audioTopY, 0, audioBaselineY);
      audioGrad.addColorStop(0, `rgba(${AUDIO_GRAPH_FILL_RGBA}, 0.35)`);
      audioGrad.addColorStop(1, `rgba(${AUDIO_GRAPH_FILL_RGBA}, 0)`);
      ctx.fillStyle = audioGrad;
      ctx.beginPath();
      ctx.moveTo(toX(times[0]), audioBaselineY);
      for (let i = 0; i < times.length; i++) {
        ctx.lineTo(toX(times[i]), toYAudio(audioLevels[i]));
      }
      ctx.lineTo(toX(times[times.length - 1]), audioBaselineY);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = AUDIO_GRAPH_STROKE;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(toX(times[0]), toYAudio(audioLevels[0]));
      for (let i = 1; i < times.length; i++) {
        ctx.lineTo(toX(times[i]), toYAudio(audioLevels[i]));
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Center marker: vertical bar at playhead showing current audio level (follows the graph)
      const levelAtSyncTime = preScanned
        ? (trackResult.audio_levels![Math.min(Math.max(0, Math.floor(syncTime * fps)), trackResult.audio_levels!.length - 1)] ?? 0)
        : getAudioLevelAt(audioSamples, syncTime);
      const markerY = toYAudio(levelAtSyncTime);
      if (curX >= x0 && curX <= x1) {
        ctx.strokeStyle = AUDIO_GRAPH_STROKE;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(curX, audioBaselineY);
        ctx.lineTo(curX, markerY);
        ctx.stroke();
        ctx.fillStyle = AUDIO_GRAPH_STROKE;
        ctx.beginPath();
        ctx.arc(curX, markerY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
  ctx.font = "11px system-ui, sans-serif";
  let legendX = x0;
  for (let c = 0; c < GRAPH_CATEGORIES.length; c++) {
    if (!graphCategoryVisible[GRAPH_CATEGORIES[c].label]) continue;
    const label = capitalizeLabel(GRAPH_CATEGORIES[c].label);
    ctx.fillStyle = GRAPH_CATEGORIES[c].stroke;
    ctx.fillText(label, legendX, graphTop + 14);
    legendX += ctx.measureText(label).width + 10;
  }
  if (graphCategoryVisible["Audio"] !== false) {
    ctx.fillStyle = AUDIO_GRAPH_STROKE;
    ctx.fillText("Audio", legendX, graphTop + 14);
    legendX += ctx.measureText("Audio").width + 10;
  }
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillText(`${tMin.toFixed(1)}s – ${tMax.toFixed(1)}s`, x1 - 70, graphTop + 14);
}

interface VideoWithOverlayProps {
  videoUrl: string | null;
  trackResult: TrackResult | null;
  fps: number;
  showLabels: boolean;
  showTrackIds: boolean;
  playbackRate: number;
  /** Delay overlay by this many seconds (positive = overlay lags video, fixes lead). */
  overlayDelaySec: number;
  /** Graph height 0 = flat strip, 1 = full page height. */
  graphHeightRatio: number;
  /** Audio graph vertical scale within the chart (0 = flat, 1 = full chart height). */
  audioGraphHeightRatio: number;
  /** Which graph categories (People, Vehicles, Animals, Other, Audio) are visible. */
  graphCategoryVisible: Record<string, boolean>;
  showSaliency: boolean;
  onVideoRef?: (el: HTMLVideoElement | null) => void;
}

export function VideoWithOverlay({
  videoUrl,
  trackResult,
  fps,
  showLabels,
  showTrackIds,
  playbackRate,
  overlayDelaySec,
  graphHeightRatio,
  audioGraphHeightRatio,
  graphCategoryVisible,
  showSaliency,
  onVideoRef,
}: VideoWithOverlayProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioHistoryRef = useRef<{ time: number; level: number }[]>([]);
  const audioDataRef = useRef<Uint8Array | null>(null);

  const setRefs = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      onVideoRef?.(el);
    },
    [onVideoRef]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate]);

  // Web Audio: sum all channels (stereo + surround) with equal weight so background/foreground/all channels are monitored
  const MAX_AUDIO_CHANNELS = 6; // stereo + 5.1
  const initAudioPipeline = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.src || analyserRef.current) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const source = ctx.createMediaElementSource(video);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = AUDIO_ANALYSER_FFT_SIZE;
      analyser.smoothingTimeConstant = 0.5;
      analyser.channelCount = 1;
      analyser.channelCountMode = "explicit";

      const splitter = ctx.createChannelSplitter(MAX_AUDIO_CHANNELS);
      source.connect(splitter);
      const gainPerChannel = 1 / MAX_AUDIO_CHANNELS;
      for (let ch = 0; ch < MAX_AUDIO_CHANNELS; ch++) {
        const gain = ctx.createGain();
        gain.gain.value = gainPerChannel;
        splitter.connect(gain, ch, 0);
        gain.connect(analyser);
      }
      analyser.connect(ctx.destination);

      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      mediaSourceRef.current = source;
      audioDataRef.current = new Uint8Array(analyser.fftSize);
    } catch {
      // No Web Audio
    }
  }, []);

  const resumeAudioContext = useCallback(async () => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // Resume failed (e.g. no user gesture)
      }
    }
  }, []);

  useEffect(() => {
    if (!videoUrl) return;
    return () => {
      const ctx = audioContextRef.current;
      if (ctx) {
        ctx.close().catch(() => {});
        audioContextRef.current = null;
        analyserRef.current = null;
        mediaSourceRef.current = null;
        audioDataRef.current = null;
        audioHistoryRef.current = [];
      }
    };
  }, [videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    const onPlay = () => {
      initAudioPipeline();
      resumeAudioContext();
    };
    video.addEventListener("play", onPlay);
    return () => video.removeEventListener("play", onPlay);
  }, [videoUrl, initAudioPipeline, resumeAudioContext]);

  const sampleAudioLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    const data = audioDataRef.current;
    if (!analyser || !data) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    const center = 128;
    for (let i = 0; i < data.length; i++) {
      const d = data[i] - center;
      sum += d * d;
    }
    const rms = Math.sqrt(sum / data.length) / 128;
    return Math.min(1, rms);
  }, []);

  const drawOverlay = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !trackResult || video.readyState < 2) return;

    const displayWidth = video.clientWidth;
    const displayHeight = video.clientHeight;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0) return;

    const scaleX = displayWidth / vw;
    const scaleY = displayHeight / vh;
    const syncTime = Math.max(0, video.currentTime - overlayDelaySec);
    const frameIndex = Math.floor(syncTime * fps);
    const frame = trackResult.frames[frameIndex];

    // Sample audio level and keep rolling history (past ~4s)
    if (analyserRef.current && !video.paused && !video.ended) {
      const level = sampleAudioLevel();
      const history = audioHistoryRef.current;
      history.push({ time: video.currentTime, level });
      const cutoff = video.currentTime - AUDIO_HISTORY_MAX_SEC;
      while (history.length > 0 && history[0].time < cutoff) {
        history.shift();
      }
    }
    const audioSamples = audioHistoryRef.current;

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    if (!frame) {
      drawCountGraph(ctx, trackResult, fps, syncTime, displayWidth, displayHeight, graphHeightRatio, audioGraphHeightRatio, audioSamples, graphCategoryVisible);
      return;
    }

    if (showSaliency && frame.saliency && frame.saliency.length > 0) {
      drawSaliencyHeatmap(ctx, frame.saliency, displayWidth, displayHeight);
    }

    // Optional trails: collect centers per track_id from last TRAIL_LEN frames
    const trailByTrack: Map<number, { x: number; y: number }[]> = new Map();
    const startFrame = Math.max(0, frameIndex - TRAIL_LEN);
    for (let f = startFrame; f <= frameIndex; f++) {
      const fr = trackResult.frames[f];
      if (!fr) continue;
      for (let i = 0; i < fr.boxes.length; i++) {
        const [x1, y1, x2, y2] = fr.boxes[i];
        const tid = fr.track_ids[i];
        if (tid == null) continue;
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        if (!trailByTrack.has(tid)) trailByTrack.set(tid, []);
        trailByTrack.get(tid)!.push({ x: cx * scaleX, y: cy * scaleY });
      }
    }
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    trailByTrack.forEach((points, tid) => {
      if (points.length < 2) return;
      const hue = trackIdToHue(tid);
      ctx.strokeStyle = `hsla(${hue}, 85%, 55%, 0.5)`;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let p = 1; p < points.length; p++) {
        ctx.lineTo(points[p].x, points[p].y);
      }
      ctx.stroke();
    });

    const { boxes, track_ids, names, scores } = frame;
    for (let i = 0; i < boxes.length; i++) {
      const [x1, y1, x2, y2] = boxes[i];
      const tid = track_ids[i];
      const hue = trackIdToHue(tid);
      const stroke = `hsl(${hue}, 85%, 55%)`;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(
        x1 * scaleX,
        y1 * scaleY,
        (x2 - x1) * scaleX,
        (y2 - y1) * scaleY
      );
        if (showLabels || showTrackIds) {
        const parts: string[] = [];
        if (showTrackIds && tid != null) parts.push(`#${tid}`);
        if (showLabels) parts.push(`${names[i] ?? ""} ${(scores[i] * 100).toFixed(0)}%`);
        const label = parts.join(" ");
        if (label) {
          ctx.font = "12px system-ui, sans-serif";
          const metrics = ctx.measureText(label);
          const tw = metrics.width + 4;
          const th = 16;
          const lx = x1 * scaleX;
          const ly = y1 * scaleY - th;
          ctx.fillStyle = stroke;
          ctx.fillRect(lx, ly, tw, th);
          ctx.strokeStyle = "rgba(0,0,0,0.5)";
          ctx.lineWidth = 1;
          ctx.strokeText(label, lx + 2, ly + 12);
          ctx.fillStyle = "#fff";
          ctx.fillText(label, lx + 2, ly + 12);
        }
      }
    }
    drawCountGraph(ctx, trackResult, fps, syncTime, displayWidth, displayHeight, graphHeightRatio, audioGraphHeightRatio, audioSamples, graphCategoryVisible);
  }, [trackResult, fps, showLabels, showTrackIds, overlayDelaySec, graphHeightRatio, audioGraphHeightRatio, graphCategoryVisible, showSaliency, sampleAudioLevel]);

  // Redraw overlay every display frame (smooth) instead of only on timeupdate (~4/sec).
  useEffect(() => {
    let rafId: number;
    const tick = () => {
      drawOverlay();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [drawOverlay]);

  // Resize and initial draw when video loads.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onResize = () => drawOverlay();
    video.addEventListener("loadeddata", drawOverlay);
    video.addEventListener("resize", onResize);
    drawOverlay();
    return () => {
      video.removeEventListener("loadeddata", drawOverlay);
      video.removeEventListener("resize", onResize);
    };
  }, [drawOverlay]);

  const handleVideoInteraction = useCallback(() => {
    initAudioPipeline();
    resumeAudioContext();
  }, [initAudioPipeline, resumeAudioContext]);

  return (
    <div
      className="video-with-overlay"
      ref={containerRef}
      onClick={handleVideoInteraction}
    >
      <video
        ref={setRefs}
        src={videoUrl ?? undefined}
        controls
        playsInline
        className="video-element"
        crossOrigin="anonymous"
      />
      {trackResult && (
        <canvas
          ref={canvasRef}
          className="overlay-canvas"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
