import { useState, useCallback } from "react";
import { uploadVideo, runTrack, videoUrl, type TrackProgress } from "./api";
import { DEFAULT_GRAPH_CATEGORY_VISIBLE, DEFAULT_TRACK_PARAMS, type GraphCategoryVisible, type TrackParams, type TrackResult } from "./types";
import { VideoWithOverlay } from "./components/VideoWithOverlay";
import { SpeedControl } from "./components/SpeedControl";
import { TuningPanel } from "./components/TuningPanel";
import "./App.css";

function App() {
  const [videoId, setVideoId] = useState<string | null>(null);
  const [trackResult, setTrackResult] = useState<TrackResult | null>(null);
  const [params, setParams] = useState<TrackParams>(DEFAULT_TRACK_PARAMS);
  const [showLabels, setShowLabels] = useState(true);
  const [showTrackIds, setShowTrackIds] = useState(true);
  const [graphHeightRatio, setGraphHeightRatio] = useState(0.2);
  const [audioGraphHeightRatio, setAudioGraphHeightRatio] = useState(0.2);
  const [graphCategoryVisible, setGraphCategoryVisible] = useState<GraphCategoryVisible>(() => ({ ...DEFAULT_GRAPH_CATEGORY_VISIBLE }));
  const [showSaliency, setShowSaliency] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [trackProgress, setTrackProgress] = useState<TrackProgress | null>(null);

  const fps = trackResult?.fps ?? 30;
  const totalFrames = trackProgress?.total_frames ?? trackResult?.frame_count ?? 1;
  const currentFrame = trackProgress?.current_frame ?? 0;

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setError(null);
      setUploading(true);
      setUploadPercent(0);
      try {
        const { video_id } = await uploadVideo(file, (p) => setUploadPercent(p));
        setVideoId(video_id);
        setTrackResult(null);
        setUploading(false);
        setUploadPercent(null);
        setLoading(true);
        setTrackProgress(null);
        const result = await runTrack(video_id, params, (p) => setTrackProgress(p));
        setTrackResult(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setVideoId(null);
        setTrackResult(null);
      } finally {
        setUploading(false);
        setUploadPercent(null);
        setLoading(false);
        setTrackProgress(null);
      }
    },
    [params]
  );

  const handleApply = useCallback(async () => {
    if (!videoId) return;
    setError(null);
    setLoading(true);
    setTrackProgress(null);
    try {
      const result = await runTrack(videoId, params, (p) => setTrackProgress(p));
      setTrackResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setTrackProgress(null);
    }
  }, [videoId, params]);

  const videoSrc = videoId ? videoUrl(videoId) : null;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <img src="/companion-logo.png" alt="" className="app-logo" />
          <h1>Video Analyzer</h1>
        </div>
        <div className="upload-row">
          <label className="file-label">
            <input
              type="file"
              accept=".mp4,video/mp4"
              onChange={handleFileChange}
              disabled={uploading || loading}
            />
            {uploading
              ? `Uploading… ${uploadPercent != null ? uploadPercent + "%" : ""}`
              : loading
                ? "Tracking…"
                : "Select MP4"}
          </label>
          <SpeedControl
            value={playbackRate}
            onChange={setPlaybackRate}
            disabled={!videoId}
          />
        </div>
        <p className="upload-hint">Video is sent to the server, then tracking runs.</p>
        {(uploading || loading) && (
          <div className="status-row">
            <span className="status-text">
              {uploading
                ? `Uploading… ${uploadPercent != null ? uploadPercent + "%" : ""}`
                : loading && trackProgress
                  ? (trackProgress.message || `Frame ${trackProgress.current_frame} / ${trackProgress.total_frames}`)
                  : "Running tracking…"}
            </span>
            <progress
              className="status-progress"
              value={uploading && uploadPercent != null ? uploadPercent : loading ? currentFrame : undefined}
              max={uploading ? 100 : totalFrames}
            >
              {uploading && uploadPercent != null ? `${uploadPercent}%` : loading ? `${currentFrame} / ${totalFrames}` : "…"}
            </progress>
          </div>
        )}
        {loading && (
          <p className="loading-status-hint">
            This can take several minutes. First run may download the YOLO model (~6MB). Check backend terminal for progress.
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </header>
      <main className="app-main">
        <div className="video-section">
          <VideoWithOverlay
            videoUrl={videoSrc}
            trackResult={trackResult}
            fps={fps}
            showLabels={showLabels}
            showTrackIds={showTrackIds}
            playbackRate={playbackRate}
            overlayDelaySec={0}
            graphHeightRatio={graphHeightRatio}
            audioGraphHeightRatio={audioGraphHeightRatio}
            graphCategoryVisible={graphCategoryVisible}
            showSaliency={showSaliency}
          />
          {loading && (
            <div className="loading-overlay">
              <p>Running tracking…</p>
              <p className="loading-hint">
                This can take several minutes. The first run downloads the YOLO model (~6MB).
                Check the backend terminal for progress or errors.
              </p>
            </div>
          )}
        </div>
        <aside className="panel-section">
          <TuningPanel
            params={params}
            onChange={setParams}
            showLabels={showLabels}
            showTrackIds={showTrackIds}
            onShowLabelsChange={setShowLabels}
            onShowTrackIdsChange={setShowTrackIds}
            graphHeightRatio={graphHeightRatio}
            onGraphHeightRatioChange={setGraphHeightRatio}
            audioGraphHeightRatio={audioGraphHeightRatio}
            onAudioGraphHeightRatioChange={setAudioGraphHeightRatio}
            graphCategoryVisible={graphCategoryVisible}
            onGraphCategoryChange={(key, visible) =>
              setGraphCategoryVisible((prev) => ({ ...prev, [key]: visible }))
            }
            showSaliency={showSaliency}
            onShowSaliencyChange={setShowSaliency}
            onApply={handleApply}
            loading={loading}
            disabled={!videoId}
          />
        </aside>
      </main>
    </div>
  );
}

export default App;
