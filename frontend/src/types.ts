export interface TrackParams {
  conf: number;
  iou: number;
  tracker: string;
  persist: boolean;
  model: string;
  classes?: number[] | null;
  include_saliency?: boolean;
  include_audio_levels?: boolean;
}

export interface FrameResult {
  boxes: number[][];
  track_ids: (number | null)[];
  classes: number[];
  scores: number[];
  names: string[];
  /** Optional saliency heatmap (2D grid 0–1), e.g. 64×64 */
  saliency?: number[][];
}

export interface TrackResult {
  fps: number;
  frame_count: number;
  frames: Record<number, FrameResult>;
  /** Pre-scanned RMS level per frame (0–1), all channels. When present, used for audio graph instead of live. */
  audio_levels?: number[];
}

export const DEFAULT_TRACK_PARAMS: TrackParams = {
  conf: 0.25,
  iou: 0.7,
  tracker: "BoT-SORT",
  persist: true,
  model: "yolo11n",
  include_saliency: true,
  include_audio_levels: true,
};
