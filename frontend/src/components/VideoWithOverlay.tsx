import { useRef, useEffect, useCallback } from "react";
import type { TrackResult } from "../types";

const TRAIL_LEN = 20;
/** Rolling graph: window ± this many seconds around current time. */
const GRAPH_WINDOW_SEC = 2;
const GRAPH_MIN_HEIGHT = 24;
/** Default height ratio (0–1) gives ~80px when display height is ~400. */
const GRAPH_HEIGHT_RATIO_DEFAULT = 0.2;
/** COCO-style categories for count graph (label, class names, stroke/fill color). */
const GRAPH_CATEGORIES: Array<{
  label: string;
  classNames: Set<string>;
  stroke: string;
  fillRgba: string;
}> = [
  {
    label: "People",
    classNames: new Set(["person"]),
    stroke: "#e74c3c",
    fillRgba: "231, 76, 60",
  },
  {
    label: "Vehicles",
    classNames: new Set([
      "car", "truck", "bus", "motorcycle", "bicycle", "airplane", "train", "boat",
    ]),
    stroke: "#3498db",
    fillRgba: "52, 152, 219",
  },
  {
    label: "Animals",
    classNames: new Set([
      "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe",
    ]),
    stroke: "#27ae60",
    fillRgba: "39, 174, 96",
  },
  {
    label: "Other",
    classNames: new Set(), // "other" = any class not in the above
    stroke: "#95a5a6",
    fillRgba: "149, 165, 166",
  },
];

/** Audio level series (same chart, 0–1 scale). */
const AUDIO_GRAPH_STROKE = "#f39c12";
const AUDIO_GRAPH_FILL_RGBA = "243, 156, 18";
const AUDIO_HISTORY_MAX_SEC = 4;
const AUDIO_ANALYSER_FFT_SIZE = 256;

function trackIdToHue(id: number | null): number {
  if (id == null) return 0;
  return (id * 137.508) % 360;
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
  audioSamples: { time: number; level: number }[]
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
        let assigned = false;
        for (let c = 0; c < GRAPH_CATEGORIES.length - 1; c++) {
          if (GRAPH_CATEGORIES[c].classNames.has(name)) {
            counts[c]++;
            assigned = true;
            break;
          }
        }
        if (!assigned) counts[GRAPH_CATEGORIES.length - 1]++;
      }
    }
    categoryCounts.forEach((arr, c) => arr.push(counts[c]));
  }
  const maxCount = Math.max(
    1,
    ...categoryCounts.flat()
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
  // Audio at 100% = full video height; 0% = flat at bottom
  const audioRangeH = displayHeight * Math.max(0, Math.min(1, audioGraphHeightRatio));
  const audioBaselineY = displayHeight;
  const toYAudio = (level: number) =>
    audioBaselineY - Math.max(0, Math.min(1, level)) * audioRangeH;
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
    // Audio level (0–1 scale); at 100% slider spans full video height
    const audioLevels = times.map((t) => getAudioLevelAt(audioSamples, t));
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
  }
  ctx.font = "11px system-ui, sans-serif";
  let legendX = x0;
  for (let c = 0; c < GRAPH_CATEGORIES.length; c++) {
    ctx.fillStyle = GRAPH_CATEGORIES[c].stroke;
    ctx.fillText(GRAPH_CATEGORIES[c].label, legendX, graphTop + 14);
    legendX += ctx.measureText(GRAPH_CATEGORIES[c].label).width + 10;
  }
  ctx.fillStyle = AUDIO_GRAPH_STROKE;
  ctx.fillText("Audio", legendX, graphTop + 14);
  legendX += ctx.measureText("Audio").width + 10;
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

  // Web Audio: create context and analyser on first user interaction (click or play), resume when suspended
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
      source.connect(analyser);
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
      drawCountGraph(ctx, trackResult, fps, syncTime, displayWidth, displayHeight, graphHeightRatio, audioGraphHeightRatio, audioSamples);
      return;
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
    drawCountGraph(ctx, trackResult, fps, syncTime, displayWidth, displayHeight, graphHeightRatio, audioGraphHeightRatio, audioSamples);
  }, [trackResult, fps, showLabels, showTrackIds, overlayDelaySec, graphHeightRatio, audioGraphHeightRatio, sampleAudioLevel]);

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
    <div className="video-with-overlay" ref={containerRef}>
      <video
        ref={setRefs}
        src={videoUrl ?? undefined}
        controls
        playsInline
        className="video-element"
        crossOrigin="anonymous"
        onClick={handleVideoInteraction}
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
