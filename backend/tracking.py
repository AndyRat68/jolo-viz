"""
YOLO tracking for FastAPI backend. Model cache per process; optional progress callback.
"""
import subprocess
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


def _rms_levels_from_float_audio(
    audio: "np.ndarray", n_samples: int, sample_rate: float, fps: float, frame_count: int
) -> List[float]:
    """Convert float audio array (samples x channels) to RMS per frame (0-1)."""
    import numpy as np

    if audio.ndim == 1:
        audio = audio[:, np.newaxis]
    samples_per_frame = sample_rate / fps if fps > 0 else 0
    if samples_per_frame <= 0:
        return [0.0] * frame_count
    n_frames = min(frame_count, int(n_samples / samples_per_frame) + 1)
    levels = []
    for i in range(n_frames):
        start = int(i * samples_per_frame)
        end = min(int((i + 1) * samples_per_frame), n_samples)
        if start >= end:
            levels.append(0.0)
            continue
        chunk = audio[start:end].astype(np.float64)
        rms = float(np.sqrt(np.mean(chunk ** 2)))
        # Gain ~3x so typical speech/music fills the graph; cap at 1
        levels.append(min(1.0, rms * 3.0))
    while len(levels) < frame_count:
        levels.append(levels[-1] if levels else 0.0)
    return levels[:frame_count]


def _compute_audio_levels_ffmpeg(video_path: Path, fps: float, frame_count: int) -> Optional[List[float]]:
    """Extract audio via ffmpeg (raw s16le), return RMS per frame (0-1). Returns None on failure."""
    try:
        import numpy as np
    except ImportError:
        return None
    sample_rate = 44100
    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(video_path),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ac", "1",
        "-ar", str(sample_rate),
        "-f", "s16le",
        "-",
    ]
    try:
        raw = subprocess.run(
            cmd,
            capture_output=True,
            timeout=300,
            check=False,
        )
        if raw.returncode != 0 or not raw.stdout:
            return None
        data = np.frombuffer(raw.stdout, dtype=np.int16)
        n_samples = len(data)
        if n_samples == 0:
            return None
        # s16 to float in [-1, 1]
        audio_float = data.astype(np.float64) / 32768.0
        return _rms_levels_from_float_audio(
            audio_float, n_samples, float(sample_rate), fps, frame_count
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None


def _compute_audio_levels(video_path: Path, fps: float, frame_count: int) -> Optional[List[float]]:
    """Pre-scan video audio and return RMS level per frame (0-1). Tries moviepy, then ffmpeg. Returns None only if both fail."""
    # 1) Try moviepy
    try:
        import numpy as np
        from moviepy.editor import VideoFileClip
        clip = VideoFileClip(str(video_path))
        if clip.audio is None:
            clip.close()
            return _compute_audio_levels_ffmpeg(video_path, fps, frame_count)
        sample_rate = clip.audio.fps
        audio = clip.audio.to_soundarray()
        clip.close()
        if audio is None or audio.size == 0:
            return _compute_audio_levels_ffmpeg(video_path, fps, frame_count)
        n_samples = audio.shape[0]
        levels = _rms_levels_from_float_audio(audio, n_samples, sample_rate, fps, frame_count)
        return levels
    except Exception:
        pass
    # 2) Fallback: ffmpeg
    return _compute_audio_levels_ffmpeg(video_path, fps, frame_count)


SALIENCY_MAP_SIZE = 64
_saliency_detector = None


def _get_saliency_detector():
    global _saliency_detector
    if _saliency_detector is None:
        try:
            import cv2
            if hasattr(cv2, "saliency") and hasattr(cv2.saliency, "StaticSaliencySpectralResidual_create"):
                _saliency_detector = cv2.saliency.StaticSaliencySpectralResidual_create()
            else:
                _saliency_detector = False
        except Exception:
            _saliency_detector = False
    return _saliency_detector if _saliency_detector else None


def _compute_saliency_map(orig_img) -> Optional[List[List[float]]]:
    import cv2
    import numpy as np
    if orig_img is None:
        return None
    try:
        saliency_map = None
        det = _get_saliency_detector()
        if det is not None:
            success, saliency_map = det.computeSaliency(orig_img)
            if not success or saliency_map is None:
                saliency_map = None
        if saliency_map is None:
            gray = cv2.cvtColor(orig_img, cv2.COLOR_BGR2GRAY) if orig_img.ndim >= 3 else orig_img
            lap = cv2.Laplacian(gray.astype(np.float32), cv2.CV_32F, ksize=3)
            saliency_map = np.abs(lap)
        h, w = saliency_map.shape[:2]
        if h == 0 or w == 0:
            return None
        small = cv2.resize(
            saliency_map.astype(np.float32),
            (SALIENCY_MAP_SIZE, SALIENCY_MAP_SIZE),
            interpolation=cv2.INTER_AREA,
        )
        if small.ndim > 2:
            small = small.mean(axis=2)
        min_val, max_val = float(small.min()), float(small.max())
        if max_val > min_val:
            small = (small - min_val) / (max_val - min_val)
        else:
            small = np.zeros_like(small, dtype=np.float32)
        return small.tolist()
    except Exception:
        return None


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
    include_saliency: bool = True,
    include_audio_levels: bool = True,
):
    video_path = Path(video_path)
    if not video_path.is_file():
        raise FileNotFoundError(f"Video not found: {video_path}")

    fps, total_frames = _get_video_info(video_path)
    if progress_callback and total_frames <= 0:
        progress_callback(0, 1)

    # Pre-scan audio so the graph is reliable; on failure use zeros so we never fall back to live Web Audio
    audio_levels: Optional[List[float]] = None
    if include_audio_levels and total_frames > 0:
        audio_levels = _compute_audio_levels(video_path, fps, total_frames)
        if audio_levels is None:
            audio_levels = [0.0] * total_frames

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

        frame_data = {
            "boxes": boxes_list,
            "track_ids": track_ids_list,
            "classes": classes_list,
            "scores": scores_list,
            "names": names_list,
        }
        if include_saliency and hasattr(r, "orig_img") and r.orig_img is not None:
            saliency = _compute_saliency_map(r.orig_img)
            if saliency is not None:
                frame_data["saliency"] = saliency
        frames[frame_idx] = frame_data

    result = {
        "fps": fps,
        "frame_count": frame_count,
        "frames": frames,
    }
    if audio_levels is not None:
        result["audio_levels"] = audio_levels
    return result
