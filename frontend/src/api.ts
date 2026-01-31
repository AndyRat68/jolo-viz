import type { TrackParams, TrackResult } from "./types";

// In dev, use /api so Vite proxies to backend (avoids CORS and wrong host).
const API_BASE =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "" : "http://localhost:8000");
const API = API_BASE ? API_BASE : "/api";

export async function uploadVideo(
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ video_id: string; filename: string }> {
  const form = new FormData();
  form.append("file", file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const timeoutMs = 15000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const clearUploadTimeout = () => {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    xhr.upload.addEventListener("progress", (e) => {
      clearUploadTimeout();
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      clearUploadTimeout();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Invalid server response"));
        }
      } else {
        reject(new Error(xhr.responseText || `Upload failed: ${xhr.status}`));
      }
    });
    xhr.addEventListener("error", () => {
      clearUploadTimeout();
      reject(
        new Error(
          "Network error. Start the backend: cd backend && py -3.11 -m uvicorn main:app --reload --port 8000"
        )
      );
    });
    xhr.addEventListener("abort", () => {
      clearUploadTimeout();
      reject(new Error("Upload cancelled"));
    });

    timeoutId = setTimeout(() => {
      xhr.abort();
      reject(
        new Error(
          "Upload timed out. Is the backend running on port 8000? Start it with: cd backend && py -3.11 -m uvicorn main:app --reload --port 8000"
        )
      );
    }, timeoutMs);

    xhr.open("POST", `${API}/upload`);
    xhr.send(form);
  });
}

export interface TrackProgress {
  status: "running" | "done" | "error";
  current_frame: number;
  total_frames: number;
  message: string;
}

const TRACK_POLL_INTERVAL_MS = 500;
const TRACK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** Start tracking; returns job_id. */
export async function startTrack(
  videoId: string,
  params: TrackParams
): Promise<{ job_id: string }> {
  const res = await fetch(`${API}/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_id: videoId, params }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text || `Track failed: ${res.status}`;
    try {
      const j = JSON.parse(text);
      if (j.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* use msg as-is */
    }
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : { job_id: "" };
}

/** Poll until job is done or error; returns progress for UI. */
export async function runTrack(
  videoId: string,
  params: TrackParams,
  onProgress?: (p: TrackProgress) => void
): Promise<TrackResult> {
  const { job_id } = await startTrack(videoId, params);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRACK_TIMEOUT_MS);

  const poll = (): Promise<TrackProgress> =>
    fetch(`${API}/track/${job_id}/progress`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Progress: ${r.status}`))));

  const getResult = (): Promise<TrackResult> =>
    fetch(`${API}/track/${job_id}/result`, { signal: controller.signal }).then((r) => {
      if (!r.ok) {
        if (r.status === 202) return Promise.reject(new Error("Job not finished"));
        return r.text().then((t) => Promise.reject(new Error(t || `Result: ${r.status}`)));
      }
      return r.json();
    });

  try {
    for (;;) {
      const progress = await poll();
      onProgress?.(progress);
      if (progress.status === "done") {
        clearTimeout(timeoutId);
        return getResult();
      }
      if (progress.status === "error") {
        clearTimeout(timeoutId);
        throw new Error(progress.message || "Tracking failed");
      }
      await new Promise((r) => setTimeout(r, TRACK_POLL_INTERVAL_MS));
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error) {
      if (err.name === "AbortError") {
        throw new Error(
          "Tracking timed out after 10 minutes. Try a shorter video or check the backend terminal for errors."
        );
      }
      throw err;
    }
    throw err;
  }
}

export function videoUrl(videoId: string): string {
  return `${API}/video/${videoId}`;
}
