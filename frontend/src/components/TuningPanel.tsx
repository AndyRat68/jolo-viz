import type { ChangeEvent } from "react";
import type { GraphCategoryVisible, TrackParams } from "../types";
import { GRAPH_CATEGORY_KEYS } from "../types";

function capitalizeLabel(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

interface TuningPanelProps {
  params: TrackParams;
  onChange: (params: TrackParams) => void;
  showLabels: boolean;
  showTrackIds: boolean;
  onShowLabelsChange: (v: boolean) => void;
  onShowTrackIdsChange: (v: boolean) => void;
  graphHeightRatio: number;
  onGraphHeightRatioChange: (v: number) => void;
  audioGraphHeightRatio: number;
  onAudioGraphHeightRatioChange: (v: number) => void;
  graphCategoryVisible: GraphCategoryVisible;
  onGraphCategoryChange: (key: string, visible: boolean) => void;
  showSaliency: boolean;
  onShowSaliencyChange: (v: boolean) => void;
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
  graphHeightRatio,
  onGraphHeightRatioChange,
  audioGraphHeightRatio,
  onAudioGraphHeightRatioChange,
  graphCategoryVisible,
  onGraphCategoryChange,
  showSaliency,
  onShowSaliencyChange,
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
          <option value="yolo11n">11n</option>
          <option value="yolo11s">11s</option>
          <option value="yolo8n">8n</option>
          <option value="yolo8s">8s</option>
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
      <div className="control-group checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={params.include_saliency ?? false}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              update({ include_saliency: e.target.checked })
            }
            disabled={disabled}
          />
          Include saliency (slower)
        </label>
      </div>
      <div className="control-group checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={showSaliency}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onShowSaliencyChange(e.target.checked)
            }
          />
          Show saliency heatmap
        </label>
      </div>
      <div className="control-group">
        <span className="control-label">Graph categories</span>
        <div className="checkbox-group checkbox-list checkbox-list-scroll">
          {GRAPH_CATEGORY_KEYS.map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={graphCategoryVisible[key] !== false}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  onGraphCategoryChange(key, e.target.checked)
                }
              />
              {capitalizeLabel(key)}
            </label>
          ))}
        </div>
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
