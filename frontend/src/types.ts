export interface TrackParams {
  conf: number;
  iou: number;
  tracker: string;
  persist: boolean;
  model: string;
  classes?: number[] | null;
  include_saliency?: boolean;
  include_audio_levels?: boolean;
  include_masks?: boolean;
}

export interface FrameResult {
  boxes: number[][];
  track_ids: (number | null)[];
  classes: number[];
  scores: number[];
  names: string[];
  /** Optional saliency heatmap (2D grid 0–1), e.g. 64×64 */
  saliency?: number[][];
  /** Optional segmentation mask polygons; one per box, each polygon list of [x, y] points (pixel coords). */
  masks?: number[][][];
}

export interface TrackResult {
  fps: number;
  frame_count: number;
  frames: Record<number, FrameResult>;
  /** Pre-scanned RMS level per frame (0–1), all channels. When present, used for audio graph instead of live. */
  audio_levels?: number[];
}

/** COCO 80 class names in YOLO order (for per-class graph series). */
export const COCO_CLASS_NAMES = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
  "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog",
  "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
  "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
  "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
  "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich",
  "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
  "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote",
  "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book",
  "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
] as const;

/** Keys for graph category toggles: each COCO class + Other + Audio. */
export const GRAPH_CATEGORY_KEYS = [...COCO_CLASS_NAMES, "Other", "Audio"] as const;
export type GraphCategoryKey = (typeof GRAPH_CATEGORY_KEYS)[number];
export type GraphCategoryVisible = Record<string, boolean>;

/** Default: all categories visible. */
export const DEFAULT_GRAPH_CATEGORY_VISIBLE: GraphCategoryVisible = Object.fromEntries(
  GRAPH_CATEGORY_KEYS.map((k) => [k, true])
) as GraphCategoryVisible;

export const DEFAULT_TRACK_PARAMS: TrackParams = {
  conf: 0.25,
  iou: 0.7,
  tracker: "BoT-SORT",
  persist: true,
  model: "yolo11n",
  include_saliency: true,
  include_audio_levels: true,
  include_masks: true,
};
