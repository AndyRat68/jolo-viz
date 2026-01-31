"""
FastAPI backend: upload MP4, run YOLO track, return per-frame results, serve video.
Job-based tracking with progress and result endpoints.
"""
import os
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiofiles
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from tracking import run_track

app = FastAPI(title="Jolo Video Tracker API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# In-memory job store: job_id -> { status, current_frame, total_frames, message, result?, error? }
_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_lock = threading.Lock()


class TrackParams(BaseModel):
    conf: float = Field(0.25, ge=0.0, le=1.0)
    iou: float = Field(0.7, ge=0.0, le=1.0)
    tracker: str = Field("BoT-SORT")
    persist: bool = Field(True)
    model: str = Field("yolo11n")
    classes: Optional[List[int]] = Field(None)
    include_saliency: bool = Field(True)
    include_audio_levels: bool = Field(True)


class TrackRequest(BaseModel):
    video_id: str
    params: TrackParams = Field(default_factory=TrackParams)


@app.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".mp4"):
        raise HTTPException(400, "Only MP4 files are accepted")
    video_id = str(uuid.uuid4())
    ext = Path(file.filename).suffix
    path = UPLOAD_DIR / f"{video_id}{ext}"
    async with aiofiles.open(path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            await f.write(chunk)
    return {"video_id": video_id, "filename": file.filename}


@app.get("/video/{video_id}")
async def get_video(video_id: str):
    safe_id = video_id.strip().replace("..", "")
    for ext in (".mp4", ".MP4"):
        path = UPLOAD_DIR / f"{safe_id}{ext}"
        if path.is_file():
            return FileResponse(path, media_type="video/mp4")
    raise HTTPException(404, "Video not found")


def _run_track_job(job_id: str, path: Path, params: "TrackParams") -> None:
    include_saliency = getattr(params, "include_saliency", False)
    include_audio_levels = getattr(params, "include_audio_levels", True)
    saliency_label = " + saliency" if include_saliency else ""
    audio_label = " + audio scan" if include_audio_levels else ""

    def progress_callback(current_frame: int, total_frames: int) -> None:
        with _jobs_lock:
            if job_id in _jobs:
                _jobs[job_id]["current_frame"] = current_frame
                _jobs[job_id]["total_frames"] = total_frames
                _jobs[job_id]["message"] = f"Frame {current_frame}/{total_frames}{saliency_label}{audio_label}"

    with _jobs_lock:
        _jobs[job_id]["status"] = "running"
        _jobs[job_id]["message"] = f"Starting…{saliency_label}{audio_label}" if (saliency_label or audio_label) else "Starting…"

    try:
        p = params
        result = run_track(
            path,
            conf=p.conf,
            iou=p.iou,
            tracker=p.tracker,
            persist=p.persist,
            model=p.model,
            classes=p.classes,
            progress_callback=progress_callback,
            include_saliency=p.include_saliency,
            include_audio_levels=p.include_audio_levels,
        )
        with _jobs_lock:
            if job_id in _jobs:
                _jobs[job_id]["status"] = "done"
                _jobs[job_id]["result"] = result
                _jobs[job_id]["message"] = "Done"
                _jobs[job_id]["current_frame"] = result.get("frame_count", 0)
                _jobs[job_id]["total_frames"] = result.get("frame_count", 0)
    except Exception as e:
        with _jobs_lock:
            if job_id in _jobs:
                _jobs[job_id]["status"] = "error"
                _jobs[job_id]["error"] = str(e)
                _jobs[job_id]["message"] = str(e)


@app.post("/track")
async def track_video(req: TrackRequest):
    safe_id = req.video_id.strip().replace("..", "")
    path = None
    for ext in (".mp4", ".MP4"):
        p = UPLOAD_DIR / f"{safe_id}{ext}"
        if p.is_file():
            path = p
            break
    if path is None:
        raise HTTPException(404, "Video not found")

    job_id = str(uuid.uuid4())
    with _jobs_lock:
        _jobs[job_id] = {
            "status": "running",
            "current_frame": 0,
            "total_frames": 1,
            "message": "Starting…",
            "result": None,
            "error": None,
        }

    def run_in_thread() -> None:
        _run_track_job(job_id, path, req.params)

    thread = threading.Thread(target=run_in_thread)
    thread.start()
    return {"job_id": job_id}


@app.get("/track/{job_id}/progress")
async def track_progress(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return {
        "status": job["status"],
        "current_frame": job["current_frame"],
        "total_frames": job["total_frames"],
        "message": job["message"],
    }


@app.get("/track/{job_id}/result")
async def track_result(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job["status"] == "error":
        raise HTTPException(500, job.get("error", "Unknown error"))
    if job["status"] != "done":
        raise HTTPException(202, "Job not finished")
    return job["result"]


@app.get("/health")
async def health():
    return {"status": "ok"}
