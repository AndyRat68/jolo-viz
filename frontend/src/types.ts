export interface TrackParams {
  conf: number;
  iou: number;
  tracker: string;
  persist: boolean;
  model: string;
  classes?: number[] | null;
}

export interface FrameResult {
  boxes: number[][];
  track_ids: (number | null)[];
  classes: number[];
  scores: number[];
  names: string[];
}

export interface TrackResult {
  fps: number;
  frame_count: number;
  frames: Record<number, FrameResult>;
}

export const DEFAULT_TRACK_PARAMS: TrackParams = {
  conf: 0.25,
  iou: 0.7,
  tracker: "BoT-SORT",
  persist: true,
  model: "yolo11n",
};
