import type { ChangeEvent } from "react";
import type { TrackParams } from "../types";

interface TuningPanelProps {
  params: TrackParams;
  onChange: (params: TrackParams) => void;
  showLabels: boolean;
  showTrackIds: boolean;
  onShowLabelsChange: (v: boolean) => void;
  onShowTrackIdsChange: (v: boolean) => void;
  overlayDelaySec: number;
  onOverlayDelayChange: (v: number) => void;
  graphHeightRatio: number;
  onGraphHeightRatioChange: (v: number) => void;
  audioGraphHeightRatio: number;
  onAudioGraphHeightRatioChange: (v: number) => void;
  onApply: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export function TuningPanel({
  params,
  onChange,
  showLabels,
  showTrackIds,
  onShowLabelsChange,
  onShowTrackIdsChange,
  overlayDelaySec,
  onOverlayDelayChange,
  graphHeightRatio,
  onGraphHeightRatioChange,
  audioGraphHeightRatio,
  onAudioGraphHeightRatioChange,
  onApply,
  loading,
  disabled,
}: TuningPanelProps) {
  const update = (partial: Partial<TrackParams>) =>
    onChange({ ...params, ...partial });

  return (
    <div className="tuning-panel">
      <h3>Tuning</h3>
      <div className="control-group">
        <label>
          Confidence
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={params.conf}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              update({ conf: Number(e.target.value) })
            }
            disabled={disabled}
          />
          <span className="value">{params.conf.toFixed(2)}</span>
        </label>
      </div>
      <div className="control-group">
        <label>
          IoU
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={params.iou}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              update({ iou: Number(e.target.value) })
            }
            disabled={disabled}
          />
          <span className="value">{params.iou.toFixed(2)}</span>
        </label>
      </div>
      <div className="control-group">
        <label htmlFor="tracker">Tracker</label>
        <select
          id="tracker"
          value={params.tracker}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            update({ tracker: e.target.value })
          }
          disabled={disabled}
        >
          <option value="BoT-SORT">BoT-SORT</option>
          <option value="ByteTrack">ByteTrack</option>
        </select>
      </div>
      <div className="control-group">
        <label htmlFor="model">Model</label>
        <select
          id="model"
          value={params.model}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            update({ model: e.target.value })
          }
          disabled={disabled}
        >
          <option value="yolo11n">YOLO11n</option>
          <option value="yolo11s">YOLO11s</option>
          <option value="yolo8n">YOLO8n</option>
          <option value="yolo8s">YOLO8s</option>
        </select>
      </div>
      <div className="control-group checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={params.persist}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              update({ persist: e.target.checked })
            }
            disabled={disabled}
          />
          Persist tracks
        </label>
      </div>
      <div className="control-group checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onShowLabelsChange(e.target.checked)
            }
          />
          Show labels
        </label>
      </div>
      <div className="control-group checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={showTrackIds}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onShowTrackIdsChange(e.target.checked)
            }
          />
          Show track IDs
        </label>
      </div>
      <div className="control-group">
        <label>
          Overlay delay (s)
          <input
            type="range"
            min={0}
            max={3}
            step={0.1}
            value={overlayDelaySec}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onOverlayDelayChange(Number(e.target.value))
            }
            disabled={disabled}
          />
          <span className="value">{overlayDelaySec.toFixed(1)}s</span>
        </label>
      </div>
      <div className="control-group">
        <label>
          Graph height
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={graphHeightRatio}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onGraphHeightRatioChange(Number(e.target.value))
            }
            disabled={disabled}
          />
          <span className="value">{Math.round(graphHeightRatio * 100)}%</span>
        </label>
      </div>
      <div className="control-group">
        <label>
          Audio graph height
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={audioGraphHeightRatio}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onAudioGraphHeightRatioChange(Number(e.target.value))
            }
            disabled={disabled}
          />
          <span className="value">{Math.round(audioGraphHeightRatio * 100)}%</span>
        </label>
      </div>
      <button
        type="button"
        className="apply-btn"
        onClick={onApply}
        disabled={disabled || loading}
      >
        {loading ? "Running…" : "Apply & re-run tracking"}
      </button>
    </div>
  );
}
