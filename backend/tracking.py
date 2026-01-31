"""
YOLO tracking for FastAPI backend. Model cache per process; optional progress callback.
"""
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


def _get_model(model_name: str):
    if model_name not in _model_cache:
        YOLO = _get_yolo()
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


def _get_video_info(video_path: Path) -> tuple:
    try:
        import cv2
        cap = cv2.VideoCapture(str(video_path))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        cap.release()
        return fps, total_frames
    except Exception:
        return 30.0, 0


def run_track(
    video_path,
    *,
    conf: float = 0.25,
    iou: float = 0.7,
    tracker: str = "botsort",
    persist: bool = True,
    model: str = "yolo11n",
    classes: Optional[List[int]] = None,
    progress_callback: Optional[Callable[[int, int], None]] = None,
):
    video_path = Path(video_path)
    if not video_path.is_file():
        raise FileNotFoundError(f"Video not found: {video_path}")

    fps, total_frames = _get_video_info(video_path)
    if progress_callback and total_frames <= 0:
        progress_callback(0, 1)

    model_name = MODEL_ALIASES.get(model.lower(), model)
    if not model_name.endswith(".pt"):
        model_name = model_name + ".pt"
    tracker_cfg = TRACKER_ALIASES.get(tracker, tracker)

    model_obj = _get_model(model_name)
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
    frame_count = 0
    total = max(1, total_frames)

    for frame_idx, r in enumerate(results):
        if progress_callback:
            progress_callback(frame_idx + 1, total)
        frame_count = frame_idx + 1
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

    return {
        "fps": fps,
        "frame_count": frame_count,
        "frames": frames,
    }
