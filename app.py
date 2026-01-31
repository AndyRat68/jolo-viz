"""
Jolo Video Tracker – local Python app. No server.
Open an MP4, run YOLO tracking, play video with overlay. Tuning panel to re-run with new params.
Models download on first use and are cached for reuse.
Uses VLC for playback when available (faster); otherwise OpenCV + Tkinter.
"""
import colorsys
import queue
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import cv2
import numpy as np
from PIL import Image, ImageTk

from tracking import run_track

try:
    import vlc
    USE_VLC = True
except Exception:
    USE_VLC = False

# Display size cap so the window isn't huge
MAX_DISPLAY_WIDTH = 1280
MAX_DISPLAY_HEIGHT = 720

TRAIL_LEN = 20
SPEEDS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]
MODELS = ["yolo11n", "yolo11s", "yolo8n", "yolo8s"]
TRACKERS = ["BoT-SORT", "ByteTrack"]


def track_id_to_hue(tid):
    if tid is None:
        return 0
    return (tid * 137.508) % 360


def draw_overlay(frame_bgr, frame_data, show_labels, show_ids):
    """Draw boxes and optional trails on frame. frame_data = track_result['frames'][idx]."""
    if not frame_data or not frame_data.get("boxes"):
        return frame_bgr
    h, w = frame_bgr.shape[:2]
    boxes = frame_data["boxes"]
    track_ids = frame_data.get("track_ids", [])
    names = frame_data.get("names", [])
    scores = frame_data.get("scores", [])

    for i in range(len(boxes)):
        x1, y1, x2, y2 = [int(round(x)) for x in boxes[i]]
        tid = track_ids[i] if i < len(track_ids) else None
        hue = track_id_to_hue(tid)
        # OpenCV HSV: H 0-180, S/V 0-255
        hsv = np.uint8([[[int(hue / 360 * 179), 220, 220]]])
        bgr = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
        color = tuple(int(c) for c in bgr[0, 0])
        cv2.rectangle(frame_bgr, (x1, y1), (x2, y2), color, 2)
        if show_labels or show_ids:
            parts = []
            if show_ids and tid is not None:
                parts.append(f"#{tid}")
            if show_labels and i < len(names) and i < len(scores):
                parts.append(f"{names[i]} {scores[i]*100:.0f}%")
            if parts:
                label = " ".join(parts)
                (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                cv2.rectangle(frame_bgr, (x1, y1 - th - 4), (x1 + tw + 2, y1), color, -1)
                cv2.putText(
                    frame_bgr, label, (x1 + 1, y1 - 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1,
                )
    return frame_bgr


def fit_size(w, h, max_w, max_h):
    if w <= max_w and h <= max_h:
        return w, h
    r = min(max_w / w, max_h / h)
    return int(w * r), int(h * r)


def draw_overlay_on_canvas(canvas, frame_data, video_w, video_h, show_labels, show_ids):
    """Draw tracking overlay on a Tk canvas. Coords scaled from video (video_w, video_h) to canvas size."""
    canvas.delete("overlay")
    cw = canvas.winfo_width()
    ch = canvas.winfo_height()
    if cw <= 1 or ch <= 1 or not frame_data or not frame_data.get("boxes"):
        return
    scale_x = cw / video_w if video_w else 1
    scale_y = ch / video_h if video_h else 1
    boxes = frame_data["boxes"]
    track_ids = frame_data.get("track_ids", [])
    names = frame_data.get("names", [])
    scores = frame_data.get("scores", [])
    for i in range(len(boxes)):
        x1, y1, x2, y2 = boxes[i]
        sx1, sy1 = x1 * scale_x, y1 * scale_y
        sx2, sy2 = x2 * scale_x, y2 * scale_y
        tid = track_ids[i] if i < len(track_ids) else None
        hue = track_id_to_hue(tid)
        rgb = _hue_to_rgb(hue)
        hex_color = "#%02x%02x%02x" % rgb
        canvas.create_rectangle(sx1, sy1, sx2, sy2, outline=hex_color, width=2, tags="overlay")
        if (show_labels or show_ids) and (show_labels or tid is not None):
            parts = []
            if show_ids and tid is not None:
                parts.append("#%d" % tid)
            if show_labels and i < len(names) and i < len(scores):
                parts.append("%s %d%%" % (names[i], int(scores[i] * 100)))
            if parts:
                label = " ".join(parts)
                canvas.create_rectangle(sx1, sy1 - 18, sx1 + len(label) * 7, sy1, fill=hex_color, outline=hex_color, tags="overlay")
                canvas.create_text(sx1 + 2, sy1 - 9, text=label, fill="white", anchor=tk.W, font=("TkDefaultFont", 9), tags="overlay")


def _hue_to_rgb(hue_deg):
    """Convert hue (0-360) to RGB tuple (0-255). Simple HSV with S=V=1."""
    h = hue_deg / 360.0
    r, g, b = colorsys.hsv_to_rgb(h, 0.85, 0.9)
    return int(r * 255), int(g * 255), int(b * 255)


class App:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Jolo Video Tracker")
        self.root.minsize(800, 500)

        self.video_path = None
        self.cap = None
        self.track_result = None
        self.fps = 30.0
        self.frame_count = 0
        self.video_width = 0
        self.video_height = 0
        self.current_time = 0.0
        self.playing = False
        self.use_vlc = USE_VLC
        self.vlc_instance = None
        self.vlc_player = None
        self._vlc_overlay_after_id = None
        self.track_queue = queue.Queue()
        self._photo_ref = None
        self._after_id = None
        # Avoid seeking every frame: sequential read when playing forward.
        self._cap_frame_index = -1
        self._cached_frame = None  # (index, frame) so we don't re-seek when paused on same frame
        # Time-based playback so speed is correct even when _draw_frame is slow.
        self._play_start_time = None
        self._play_start_current_time = None
        self._last_speed = None
        # Cache display size so we don't recompute fit_size every frame.
        self._display_size = None  # (dw, dh) for last draw

        self._build_ui()
        self._poll_track_result()

    def _build_ui(self):
        top = ttk.Frame(self.root, padding=4)
        top.pack(fill=tk.X)
        ttk.Button(top, text="Open MP4…", command=self._open_file).pack(side=tk.LEFT, padx=2)
        ttk.Label(top, text="Speed:").pack(side=tk.LEFT, padx=(8, 2))
        self.speed_var = tk.StringVar(value="1.0")
        self.speed_combo = ttk.Combobox(
            top, textvariable=self.speed_var, values=[str(s) for s in SPEEDS],
            width=6, state="readonly",
        )
        self.speed_combo.pack(side=tk.LEFT, padx=2)
        def _on_speed_select(event):
            i = self.speed_combo.current()
            if 0 <= i < len(SPEEDS):
                self.speed_var.set(str(SPEEDS[i]))
        self.speed_combo.bind("<<ComboboxSelected>>", _on_speed_select)
        ttk.Button(top, text="Play", command=self._play).pack(side=tk.LEFT, padx=2)
        ttk.Button(top, text="Pause", command=self._pause).pack(side=tk.LEFT, padx=2)
        self.show_overlay_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(top, text="Show overlay", variable=self.show_overlay_var, command=self._on_overlay_toggle).pack(side=tk.LEFT, padx=(12, 2))
        if USE_VLC:
            ttk.Label(top, text="(VLC)", foreground="gray").pack(side=tk.LEFT, padx=2)

        self.video_container = ttk.Frame(self.root, padding=4)
        self.video_container.pack(fill=tk.BOTH, expand=True)
        if self.use_vlc:
            self.vlc_frame = tk.Frame(self.video_container, bg="black", width=MAX_DISPLAY_WIDTH, height=MAX_DISPLAY_HEIGHT)
            self.vlc_frame.pack(fill=tk.BOTH, expand=True)
            self._overlay_transparent = "#010102"
            self.overlay_canvas = tk.Canvas(self.video_container, bg=self._overlay_transparent, highlightthickness=0)
            self.overlay_canvas.pack(fill=tk.BOTH, expand=True)
            try:
                self.root.attributes("-transparentcolor", self._overlay_transparent)
            except tk.TclError:
                pass
            self.video_label = None
        else:
            self.video_label = ttk.Label(self.video_container, text="Open an MP4 file to start.", anchor=tk.CENTER)
            self.video_label.pack(fill=tk.BOTH, expand=True)
            self.vlc_frame = None
            self.overlay_canvas = None

        # Status and progress (shown during tracking)
        status_frame = ttk.Frame(self.root, padding=(4, 0))
        status_frame.pack(fill=tk.X, padx=4)
        self.status_var = tk.StringVar(value="")
        self.status_label = ttk.Label(status_frame, textvariable=self.status_var, wraplength=500)
        self.status_label.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self.progress_var = tk.DoubleVar(value=0.0)
        self.progress_bar = ttk.Progressbar(status_frame, variable=self.progress_var, maximum=100, length=200, mode="determinate")
        self.progress_bar.pack(side=tk.RIGHT, padx=(8, 0))

        panel = ttk.LabelFrame(self.root, text="Tuning", padding=8)
        panel.pack(fill=tk.X, padx=4, pady=4)

        row1 = ttk.Frame(panel)
        row1.pack(fill=tk.X, pady=2)
        ttk.Label(row1, text="Conf:").pack(side=tk.LEFT, padx=(0, 4))
        self.conf_var = tk.DoubleVar(value=0.25)
        self.conf_label_var = tk.StringVar(value="0.25")
        ttk.Scale(row1, from_=0.05, to=0.95, variable=self.conf_var, orient=tk.HORIZONTAL, length=120, command=lambda v: self.conf_label_var.set(f"{float(v):.2f}")).pack(side=tk.LEFT, padx=2)
        ttk.Label(row1, textvariable=self.conf_label_var, width=4).pack(side=tk.LEFT, padx=2)

        ttk.Label(row1, text="IoU:").pack(side=tk.LEFT, padx=(12, 4))
        self.iou_var = tk.DoubleVar(value=0.7)
        self.iou_label_var = tk.StringVar(value="0.70")
        ttk.Scale(row1, from_=0.1, to=0.95, variable=self.iou_var, orient=tk.HORIZONTAL, length=120, command=lambda v: self.iou_label_var.set(f"{float(v):.2f}")).pack(side=tk.LEFT, padx=2)
        ttk.Label(row1, textvariable=self.iou_label_var, width=4).pack(side=tk.LEFT, padx=2)

        row2 = ttk.Frame(panel)
        row2.pack(fill=tk.X, pady=2)
        ttk.Label(row2, text="Tracker:").pack(side=tk.LEFT, padx=(0, 4))
        self.tracker_var = tk.StringVar(value="BoT-SORT")
        ttk.Combobox(row2, textvariable=self.tracker_var, values=TRACKERS, width=12, state="readonly").pack(side=tk.LEFT, padx=2)
        ttk.Label(row2, text="Model:").pack(side=tk.LEFT, padx=(8, 4))
        self.model_var = tk.StringVar(value="yolo11n")
        ttk.Combobox(row2, textvariable=self.model_var, values=MODELS, width=10, state="readonly").pack(side=tk.LEFT, padx=2)

        row3 = ttk.Frame(panel)
        row3.pack(fill=tk.X, pady=2)
        self.persist_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(row3, text="Persist tracks", variable=self.persist_var).pack(side=tk.LEFT, padx=2)
        self.show_labels_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(row3, text="Show labels", variable=self.show_labels_var).pack(side=tk.LEFT, padx=2)
        self.show_ids_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(row3, text="Show track IDs", variable=self.show_ids_var).pack(side=tk.LEFT, padx=2)

        ttk.Button(panel, text="Apply & re-run tracking", command=self._apply).pack(pady=4)

    def _on_overlay_toggle(self):
        if self.use_vlc and self.vlc_player and self.track_result:
            self._vlc_draw_overlay()
        elif self.track_result and self.cap:
            self._draw_frame()

    def _stop_vlc(self):
        if self._vlc_overlay_after_id:
            self.root.after_cancel(self._vlc_overlay_after_id)
            self._vlc_overlay_after_id = None
        if self.vlc_player:
            try:
                self.vlc_player.stop()
            except Exception:
                pass
            self.vlc_player = None
        if self.vlc_instance:
            try:
                self.vlc_instance.release()
            except Exception:
                pass
            self.vlc_instance = None

    def _start_vlc(self):
        self._stop_vlc()
        if not self.video_path or not self.track_result:
            return
        try:
            self.vlc_instance = vlc.Instance("--no-xlib" if sys.platform.startswith("linux") else "")
            self.vlc_player = self.vlc_instance.media_player_new()
            media = self.vlc_instance.media_new(self.video_path)
            self.vlc_player.set_media(media)
            self.root.update_idletasks()
            hwnd = self.vlc_frame.winfo_id()
            if sys.platform.startswith("win"):
                self.vlc_player.set_hwnd(hwnd)
            elif sys.platform.startswith("linux"):
                self.vlc_player.set_xwindow(hwnd)
            else:
                self.vlc_player.set_hwnd(hwnd)
        except Exception as e:
            messagebox.showerror("VLC", "VLC failed: %s\n\nInstall VLC from https://www.videolan.org/ and restart the app." % e)
            self.use_vlc = False
            return

    def _vlc_draw_overlay(self):
        if not self.overlay_canvas or not self.track_result or not self.show_overlay_var.get():
            return
        try:
            t_ms = self.vlc_player.get_time()
        except Exception:
            return
        if t_ms < 0:
            return
        frame_idx = int((t_ms / 1000.0) * self.fps)
        if frame_idx >= self.frame_count:
            frame_idx = max(0, self.frame_count - 1)
        frame_data = self.track_result.get("frames", {}).get(frame_idx)
        draw_overlay_on_canvas(
            self.overlay_canvas,
            frame_data or {},
            self.video_width,
            self.video_height,
            self.show_labels_var.get(),
            self.show_ids_var.get(),
        )

    def _vlc_overlay_tick(self):
        if not self.use_vlc or not self.vlc_player or not self.track_result:
            self._vlc_overlay_after_id = self.root.after(50, self._vlc_overlay_tick)
            return
        self._vlc_draw_overlay()
        self._vlc_overlay_after_id = self.root.after(50, self._vlc_overlay_tick)

    def _get_params(self):
        return {
            "conf": self.conf_var.get(),
            "iou": self.iou_var.get(),
            "tracker": self.tracker_var.get(),
            "model": self.model_var.get(),
            "persist": self.persist_var.get(),
        }

    def _open_file(self):
        path = filedialog.askopenfilename(
            filetypes=[("MP4 video", "*.mp4"), ("All files", "*.*")]
        )
        if not path:
            return
        self.video_path = path
        self._pause()
        self._stop_vlc()
        self.track_result = None
        if self.cap:
            self.cap.release()
            self.cap = None
        if self.video_label:
            self.video_label.config(text="")
        if self.overlay_canvas:
            self.overlay_canvas.delete("overlay")
        self.status_var.set("Starting… (first run may download the model)")
        self.progress_var.set(0.0)
        self.progress_bar.config(mode="indeterminate")
        self.progress_bar.start(8)
        self.root.update()
        self._run_track_in_thread()

    def _run_track_in_thread(self):
        params = self._get_params()

        def progress_callback(phase, current, total, message):
            self.track_queue.put(("progress", phase, current, total, message))

        def work():
            try:
                out = run_track(self.video_path, progress_callback=progress_callback, **params)
                self.track_queue.put(("ok", out))
            except Exception as e:
                self.track_queue.put(("err", str(e)))

        threading.Thread(target=work, daemon=True).start()

    def _poll_track_result(self):
        try:
            while True:
                msg = self.track_queue.get_nowait()
                status = msg[0]
                if status == "progress":
                    _, phase, current, total, message = msg
                    self.status_var.set(message)
                    if total and total > 0:
                        self.progress_bar.stop()
                        self.progress_bar.config(mode="determinate")
                        self.progress_var.set(100.0 * current / total)
                    else:
                        self.progress_bar.config(mode="indeterminate")
                        self.progress_bar.start(8)
                    self.root.update_idletasks()
                elif status == "ok":
                    data = msg[1]
                    self.track_result = data
                    self.fps = data["fps"]
                    self.frame_count = data["frame_count"]
                    self.video_width = data.get("video_width") or 0
                    self.video_height = data.get("video_height") or 0
                    self.current_time = 0.0
                    self.status_var.set("")
                    self.progress_var.set(0.0)
                    self.progress_bar.stop()
                    self.progress_bar.config(mode="determinate")
                    if self.use_vlc:
                        self._start_vlc()
                        self._vlc_overlay_tick()
                    else:
                        if self.cap:
                            self.cap.release()
                        self.cap = cv2.VideoCapture(self.video_path)
                        self._cap_frame_index = -1
                        self._cached_frame = None
                        self._display_size = None
                        if self.video_label:
                            self.video_label.config(text="")
                        self._draw_frame()
                else:
                    err = msg[1] if len(msg) > 1 else "Unknown error"
                    self.status_var.set("")
                    self.progress_bar.stop()
                    self.progress_bar.config(mode="determinate")
                    messagebox.showerror("Tracking failed", err)
                    self.video_label.config(text="Tracking failed. See dialog.")
        except queue.Empty:
            pass
        self.root.after(100, self._poll_track_result)

    def _apply(self):
        if not self.video_path or not Path(self.video_path).is_file():
            messagebox.showinfo("No video", "Open an MP4 first.")
            return
        self._pause()
        self.video_label.config(text="")
        self.status_var.set("Starting tracking…")
        self.progress_var.set(0.0)
        self.progress_bar.config(mode="indeterminate")
        self.progress_bar.start(8)
        self.root.update()
        self._run_track_in_thread()

    def _draw_frame(self):
        if not self.cap or not self.track_result:
            return
        frame_idx = int(self.current_time * self.fps)
        if frame_idx >= self.frame_count:
            frame_idx = max(0, self.frame_count - 1)

        # Use cached frame if we're still on the same frame (e.g. paused).
        if self._cached_frame is not None and self._cached_frame[0] == frame_idx:
            frame = self._cached_frame[1].copy()
        else:
            # Sequential read when playing forward; seek only when jumping back or starting.
            if frame_idx != self._cap_frame_index + 1:
                self.cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = self.cap.read()
            if not ret or frame is None:
                return
            self._cap_frame_index = frame_idx
            self._cached_frame = (frame_idx, frame.copy())
        if self.show_overlay_var.get():
            frame_data = self.track_result.get("frames", {}).get(frame_idx)
            if frame_data:
                frame = draw_overlay(
                    frame.copy(),
                    frame_data,
                    self.show_labels_var.get(),
                    self.show_ids_var.get(),
                )
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        h, w = frame_rgb.shape[:2]
        if self._display_size is None:
            self._display_size = fit_size(w, h, MAX_DISPLAY_WIDTH, MAX_DISPLAY_HEIGHT)
        dw, dh = self._display_size
        if (dw, dh) != (w, h):
            frame_rgb = cv2.resize(frame_rgb, (dw, dh), interpolation=cv2.INTER_AREA)
        img = Image.fromarray(frame_rgb)
        photo = ImageTk.PhotoImage(image=img)
        self._photo_ref = photo
        self.video_label.config(image=photo, text="")
        self.video_label.image = photo

    def _tick(self):
        if self.use_vlc:
            self._after_id = self.root.after(33, self._tick)
            return
        if not self.playing or not self.track_result or not self.cap:
            self._after_id = self.root.after(33, self._tick)
            return
        try:
            speed = float(self.speed_var.get())
        except (ValueError, tk.TclError):
            speed = 1.0
        now = time.time()
        if self._play_start_time is None or self._last_speed != speed:
            self._play_start_time = now
            self._play_start_current_time = self.current_time
            self._last_speed = speed
        self.current_time = self._play_start_current_time + (now - self._play_start_time) * speed
        end_time = (self.frame_count - 1) / self.fps if self.frame_count else 0
        if self.current_time >= end_time:
            self.current_time = max(0.0, end_time)
            self.playing = False
            self._play_start_time = None
        self._draw_frame()
        self._after_id = self.root.after(33, self._tick)

    def _play(self):
        if self.use_vlc and self.vlc_player:
            try:
                speed = float(self.speed_var.get())
            except (ValueError, tk.TclError):
                speed = 1.0
            self.vlc_player.set_rate(speed)
            self.vlc_player.play()
            self.playing = True
            return
        self.playing = True
        self._play_start_time = None
        if self._after_id is None:
            self._tick()

    def _pause(self):
        if self.use_vlc and self.vlc_player:
            self.vlc_player.pause()
        self.playing = False
        self._play_start_time = None

    def run(self):
        self._tick()
        if self.use_vlc:
            self._vlc_overlay_tick()
        self.root.mainloop()
        if self._after_id:
            self.root.after_cancel(self._after_id)
        if self._vlc_overlay_after_id:
            self.root.after_cancel(self._vlc_overlay_after_id)
        self._stop_vlc()
        if self.cap:
            self.cap.release()


if __name__ == "__main__":
    App().run()
