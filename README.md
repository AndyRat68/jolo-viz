# Jolo Video Tracker

MP4 video with YOLO object tracking overlay. **React + FastAPI** (web app).

- **Upload MP4** – file is sent to the backend; upload progress (%). Then tracking runs; status and progress bar show while it runs.
- **Playback** – video with overlay, speed control (0.25x–2x).
- **Tuning** – confidence, IoU, tracker (BoT-SORT / ByteTrack), model, persist, show labels/IDs. **Apply & re-run tracking** to update.

## Setup

### Backend (Python)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
```

First run will download the YOLO model (~6MB) when you run tracking.

### Frontend (React)

```bash
cd frontend
npm install
```

## Run

1. **Start backend** (in a terminal):

```bash
cd backend
.venv\Scripts\activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

2. **Start frontend** (in another terminal):

```bash
cd frontend
npm run dev
```

3. Open the dev URL (e.g. http://localhost:5173). Use **Select MP4** to upload; you’ll see upload % then “Running tracking…” with a progress bar. When done, video plays with overlay; use **Speed** and the tuning panel.

The frontend proxies `/api` to the backend in dev, so no CORS issues.
