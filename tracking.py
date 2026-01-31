"""
Local YOLO tracking: run_track() and model cache. No server.
Models are loaded once per name and reused; new models download on first use and stay cached.
"""
import re
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

_yolo_class = None
_model_cache: Dict[str, Any] = {}

def _get_yolo():
    global _yolo_class
    if _yolo_class is None:
        from ultralytics import YOLO as _YOLO
        _yolo_class = _YOLO
    return _yolo_class


class _DownloadProgressWriter:
    """Wraps stdout and parses Ultralytics download progress (e.g. "45%") to call callback."""
    def __init__(self, real_stdout, callback):
        self._real = real_stdout
        self._callback = callback
        self._buf = ""
        self._last_pct = -1

    def write(self, s):
        self._real.write(s)
        self._buf += s
        m = re.search(r"(\d{1,3})%", self._buf)
        if m and self._callback:
            pct = min(100, int(m.group(1)))
            if pct != self._last_pct:
                self._last_pct = pct
                self._callback("model", pct, 100, "Downloading model... %d%%" % pct)
        if len(self._buf) > 200:
            self._buf = self._buf[-200:]

    def flush(self):
        self._real.flush()


def _get_model(model_name: str, progress_callback: Optional[Callable] = None):
    """Load model once per name; download on first use, then reuse."""
    if model_name not in _model_cache:
        YOLO = _get_yolo()
        if progress_callback:
            old_stdout = sys.stdout
            try:
                sys.stdout = _DownloadProgressWriter(old_stdout, progress_callback)
                _model_cache[model_name] = YOLO(model_name)
            finally:
                sys.stdout = old_stdout
        else:
            _model_cache[model_name] = YOLO(model_name)
    return _model_cache[model_name]


MODEL_ALIASES = {
    "yolo11n": "yolo11n.pt",
    "yolo11s": "yolo11s.pt",
    "yolo11m": "yolo11m.pt",
    "yolo8n": "yolov8n.pt",
    "yolo8s": "yolov8s.pt",
}

TRACKER_ALIASES = {
    "bytetrack": "bytetrack.yaml",
    "botsort": "botsort.yaml",
    "BoT-SORT": "botsort.yaml",
    "ByteTrack": "bytetrack.yaml",
}


def run_track(
    video_path,
    *,
    conf: float = 0.25,
    iou: float = 0.7,
    tracker: str = "botsort",
    persist: bool = True,
    model: str = "yolo11n",
    classes: Optional[List[int]] = None,
    progress_callback=None,
):
    """
    Run YOLO track on a video. Returns dict with fps, frame_count, frames.
    Uses cached model for this name; downloads model on first use.
    progress_callback(phase, current, total, message) is called for UI updates.
    """
    video_path = Path(video_path)
    if not video_path.is_file():
        raise FileNotFoundError(f"Video not found: {video_path}")

    model_name = MODEL_ALIASES.get(model.lower(), model)
    if not model_name.endswith(".pt"):
        model_name = model_name + ".pt"
    tracker_cfg = TRACKER_ALIASES.get(tracker, tracker)

    # Get total frame count for progress
    total_frames = 0
    try:
        import cv2
        cap = cv2.VideoCapture(str(video_path))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        cap.release()
    except Exception:
        pass

    def report(phase, current, total, message):
        if progress_callback:
            progress_callback(phase, current, total, message)

    # Model load (may download on first use); progress_callback gets download % from stdout
    report("model", 0, 0, "Loading model (downloading if needed)...")
    def model_progress(phase, current, total, msg):
        if progress_callback:
            progress_callback(phase, current, total, msg)
    model_obj = _get_model(model_name, progress_callback=model_progress)
    report("model", 1, 1, "Model ready")
    results = model_obj.track(
        source=str(video_path),
        conf=conf,
        iou=iou,
        tracker=tracker_cfg,
        persist=persist,
        classes=classes,
        stream=True,
        verbose=False,
    )

    frames = {}
    fps = 30.0
    frame_count = 0

    for frame_idx, r in enumerate(results):
        frame_count = frame_idx + 1
        if total_frames and (frame_idx % 5 == 0 or frame_idx == total_frames - 1):
            report("track", frame_idx + 1, total_frames, "Frame %d / %d" % (frame_idx + 1, total_frames))
        boxes_list = []
        track_ids_list = []
        classes_list = []
        scores_list = []
        names_list = []

        if r.boxes is not None:
            for i in range(len(r.boxes)):
                xyxy = r.boxes.xyxy[i]
                boxes_list.append(xyxy.cpu().tolist())
                tid = r.boxes.id
                if tid is not None:
                    track_ids_list.append(int(tid[i].cpu().item()))
                else:
                    track_ids_list.append(None)
                cls = int(r.boxes.cls[i].cpu().item())
                classes_list.append(cls)
                scores_list.append(float(r.boxes.conf[i].cpu().item()))
                names_list.append(r.names[cls] if r.names else str(cls))

        frames[frame_idx] = {
            "boxes": boxes_list,
            "track_ids": track_ids_list,
            "classes": classes_list,
            "scores": scores_list,
            "names": names_list,
        }

    video_width = 0
    video_height = 0
    try:
        import cv2
        cap = cv2.VideoCapture(str(video_path))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        video_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        video_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        cap.release()
    except Exception:
        fps = 30.0

    return {
        "fps": fps,
        "frame_count": frame_count,
        "frames": frames,
        "video_width": video_width,
        "video_height": video_height,
    }
