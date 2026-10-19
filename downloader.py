import os
import time
import queue
import threading
import urllib.parse
import urllib.request
import logging
from typing import Dict, Any, Optional, Tuple, List
import yt_dlp

import database

logger = logging.getLogger("downloader")
logging.basicConfig(level=logging.INFO)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOADS_DIR = os.path.join(BASE_DIR, "downloads")
AUDIO_DIR = os.path.join(DOWNLOADS_DIR, "audio")
THUMBNAILS_DIR = os.path.join(DOWNLOADS_DIR, "thumbnails")

os.makedirs(AUDIO_DIR, exist_ok=True)
os.makedirs(THUMBNAILS_DIR, exist_ok=True)

import shutil
NODE_PATH = shutil.which("node")

def format_duration(seconds: Optional[int]) -> str:
    if not seconds or seconds <= 0:
        return "0:00"
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"

def normalize_playlist_url(url_or_id: str) -> Tuple[str, str]:
    url_or_id = url_or_id.strip()
    if url_or_id.startswith("PL") or url_or_id.startswith("OLAK5uy_") or url_or_id.startswith("UU") or url_or_id.startswith("FL"):
        return url_or_id, f"https://www.youtube.com/playlist?list={url_or_id}"

    parsed = urllib.parse.urlparse(url_or_id)
    query = urllib.parse.parse_qs(parsed.query)

    if "list" in query:
        playlist_id = query["list"][0]
        return playlist_id, f"https://www.youtube.com/playlist?list={playlist_id}"

    if "youtu.be" in parsed.netloc:
        video_id = parsed.path.strip("/")
        return f"video_{video_id}", url_or_id

    if "v" in query:
        return f"video_{query['v'][0]}", url_or_id

    safe_id = "".join(c for c in url_or_id if c.isalnum() or c in "-_")[:40]
    return safe_id or "playlist_default", url_or_id

def download_thumbnail(video_id: str) -> Optional[str]:
    target_path = os.path.join(THUMBNAILS_DIR, f"{video_id}.jpg")
    rel_path = f"/thumbnail/{video_id}.jpg"

    if os.path.exists(target_path) and os.path.getsize(target_path) > 0:
        return rel_path

    urls = [
        f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
        f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
    ]

    headers = {"User-Agent": "Mozilla/5.0"}
    for u in urls:
        try:
            req = urllib.request.Request(u, headers=headers)
            with urllib.request.urlopen(req, timeout=5) as response:
                if response.status == 200:
                    data = response.read()
                    if len(data) > 1000:
                        with open(target_path, "wb") as f:
                            f.write(data)
                        return rel_path
        except Exception:
            continue

    return None

class DownloadManager:
    def __init__(self):
        self.queue = queue.Queue()
        self.active_download: Dict[str, Any] = {
            "active": False,
            "track_id": None,
            "video_id": None,
            "title": "",
            "percent": 0,
            "speed": "",
            "eta": "",
            "status_text": "Idle"
        }
        self.lock = threading.Lock()
        self.enqueued_track_ids = set()
        self.worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
        self.worker_thread.start()

    def get_status(self) -> Dict[str, Any]:
        with self.lock:
            status = dict(self.active_download)
            status["queue_count"] = self.queue.qsize()
            return status

    def enqueue_track(self, track_id: int):
        with self.lock:
            if track_id not in self.enqueued_track_ids:
                self.enqueued_track_ids.add(track_id)
                self.queue.put(track_id)

    def enqueue_pending_tracks(self):
        pending = database.get_pending_tracks()
        for t in pending:
            self.enqueue_track(t["id"])

    def _worker_loop(self):
        while True:
            try:
                track_id = self.queue.get()
                with self.lock:
                    if track_id in self.enqueued_track_ids:
                        self.enqueued_track_ids.remove(track_id)

                self._process_track(track_id)
            except Exception as e:
                logger.error(f"Error in worker loop: {e}", exc_info=True)
            finally:
                with self.lock:
                    self.active_download = {
                        "active": False,
                        "track_id": None,
                        "video_id": None,
                        "title": "",
                        "percent": 0,
                        "speed": "",
                        "eta": "",
                        "status_text": "Idle"
                    }
                time.sleep(0.5)

    def _process_track(self, track_id: int):
        track = database.get_track(track_id)
        if not track:
            return

        video_id = track["video_id"]
        title = track["title"]
        expected_mp3 = os.path.join(AUDIO_DIR, f"{video_id}.mp3")

        with self.lock:
            self.active_download = {
                "active": True,
                "track_id": track_id,
                "video_id": video_id,
                "title": title,
                "percent": 0,
                "speed": "",
                "eta": "",
                "status_text": "Checking local cache..."
            }

        if os.path.exists(expected_mp3) and os.path.getsize(expected_mp3) > 10000:
            thumb_path = download_thumbnail(video_id)
            database.update_track_status(
                track_id=track_id,
                status="completed",
                file_path=expected_mp3,
                thumbnail_path=thumb_path
            )
            return

        database.update_track_status(track_id=track_id, status="downloading")

        thumb_path = download_thumbnail(video_id)
        if thumb_path:
            database.update_track_status(track_id=track_id, status="downloading", thumbnail_path=thumb_path)

        def progress_hook(d):
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes") or 0
                percent = int((downloaded / total) * 100) if total > 0 else 0
                speed_str = d.get("_speed_str", "").strip()
                eta_str = d.get("_eta_str", "").strip()

                with self.lock:
                    self.active_download["percent"] = min(percent, 99)
                    self.active_download["speed"] = speed_str
                    self.active_download["eta"] = eta_str
                    self.active_download["status_text"] = f"Downloading audio ({percent}%)"
            elif d.get("status") == "finished":
                with self.lock:
                    self.active_download["percent"] = 99
                    self.active_download["status_text"] = "Converting to MP3..."

        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": os.path.join(AUDIO_DIR, f"{video_id}.%(ext)s"),
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "progress_hooks": [progress_hook],
        }

        if NODE_PATH:
            ydl_opts["js_runtimes"] = {"node": {}}

        video_url = f"https://www.youtube.com/watch?v={video_id}"

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_url, download=True)
                duration = info.get("duration")
                final_title = info.get("title") or title
                artist = info.get("artist") or info.get("uploader") or track.get("artist") or "Unknown Artist"

                dur_formatted = format_duration(duration) if duration else track.get("duration_formatted")

                if os.path.exists(expected_mp3) and os.path.getsize(expected_mp3) > 1000:
                    database.update_track_status(
                        track_id=track_id,
                        status="completed",
                        file_path=expected_mp3,
                        duration=duration,
                        duration_formatted=dur_formatted,
                        thumbnail_path=thumb_path
                    )
                    logger.info(f"Successfully downloaded: {final_title} ({video_id})")
                else:
                    raise Exception("Output MP3 file not found or empty after conversion")

        except Exception as e:
            logger.error(f"Failed downloading {video_id}: {e}")
            database.update_track_status(
                track_id=track_id,
                status="error",
                error_message=str(e)[:250]
            )

download_manager = DownloadManager()

def import_youtube_playlist(url_or_id: str) -> Dict[str, Any]:
    playlist_id, normalized_url = normalize_playlist_url(url_or_id)

    ydl_opts = {
        "extract_flat": True,
        "quiet": True,
        "no_warnings": True,
    }
    if NODE_PATH:
        ydl_opts["js_runtimes"] = {"node": {}}

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(normalized_url, download=False)
    except Exception as e:
        raise ValueError(f"Could not load YouTube playlist: {str(e)}")

    if not info:
        raise ValueError("No playlist data returned from YouTube.")

    if "entries" not in info or info.get("entries") is None:
        title = info.get("title") or "YouTube Music"
        playlist = database.add_playlist(
            playlist_id=playlist_id,
            title=title,
            youtube_url=normalized_url,
            thumbnail_url=info.get("thumbnail")
        )

        vid_id = info.get("id") or playlist_id.replace("video_", "")
        tid = database.add_track(
            playlist_id=playlist_id,
            video_id=vid_id,
            title=title,
            artist=info.get("uploader") or "Unknown Artist",
            duration=info.get("duration") or 0,
            duration_formatted=format_duration(info.get("duration")),
            thumbnail_path=f"/thumbnail/{vid_id}.jpg",
            track_order=1
        )
        if tid:
            download_manager.enqueue_track(tid)

        return {
            "playlist": playlist,
            "total_tracks": 1,
            "new_tracks": 1
        }

    playlist_title = info.get("title") or "YouTube Playlist"
    entries = list(info.get("entries", []))

    first_thumb = None
    if entries and entries[0]:
        first_id = entries[0].get("id")
        if first_id:
            first_thumb = f"/thumbnail/{first_id}.jpg"

    playlist = database.add_playlist(
        playlist_id=playlist_id,
        title=playlist_title,
        youtube_url=normalized_url,
        thumbnail_url=first_thumb
    )

    new_count = 0
    order = 1
    for entry in entries:
        if not entry:
            continue
        vid_id = entry.get("id")
        if not vid_id:
            continue
        v_title = entry.get("title") or f"Track {order}"
        v_artist = entry.get("uploader") or entry.get("channel") or "Unknown Artist"
        v_duration = entry.get("duration") or 0
        v_dur_fmt = format_duration(v_duration)

        track_id = database.add_track(
            playlist_id=playlist_id,
            video_id=vid_id,
            title=v_title,
            artist=v_artist,
            duration=v_duration,
            duration_formatted=v_dur_fmt,
            thumbnail_path=f"/thumbnail/{vid_id}.jpg",
            track_order=order
        )
        if track_id:
            track_data = database.get_track(track_id)
            if track_data and track_data["status"] != "completed":
                download_manager.enqueue_track(track_id)
            new_count += 1
        order += 1

    return {
        "playlist": playlist,
        "total_tracks": len(entries),
        "new_tracks": new_count
    }

def sync_playlist_now(playlist_id: str) -> Dict[str, Any]:
    playlist = database.get_playlist(playlist_id)
    if not playlist:
        raise ValueError(f"Playlist {playlist_id} not found.")

    youtube_url = playlist["youtube_url"]

    ydl_opts = {
        "extract_flat": True,
        "quiet": True,
        "no_warnings": True,
    }
    if NODE_PATH:
        ydl_opts["js_runtimes"] = {"node": {}}

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(youtube_url, download=False)
    except Exception as e:
        logger.warning(f"Could not sync playlist {playlist_id} from YouTube: {e}")
        download_manager.enqueue_pending_tracks()
        return {
            "status": "network_error",
            "message": str(e),
            "new_tracks_count": 0
        }

    if not info:
        return {"status": "no_data", "new_tracks_count": 0}

    entries = list(info.get("entries", [])) if "entries" in info else [info]
    existing_tracks = database.get_playlist_tracks(playlist_id)
    existing_video_ids = {t["video_id"] for t in existing_tracks}

    new_tracks_added = 0
    current_max_order = max([t.get("track_order", 0) for t in existing_tracks], default=0)

    for entry in entries:
        if not entry:
            continue
        vid_id = entry.get("id")
        if not vid_id:
            continue

        if vid_id not in existing_video_ids:
            current_max_order += 1
            v_title = entry.get("title") or f"Track {current_max_order}"
            v_artist = entry.get("uploader") or entry.get("channel") or "Unknown Artist"
            v_duration = entry.get("duration") or 0
            v_dur_fmt = format_duration(v_duration)

            track_id = database.add_track(
                playlist_id=playlist_id,
                video_id=vid_id,
                title=v_title,
                artist=v_artist,
                duration=v_duration,
                duration_formatted=v_dur_fmt,
                thumbnail_path=f"/thumbnail/{vid_id}.jpg",
                track_order=current_max_order
            )
            if track_id:
                track_data = database.get_track(track_id)
                if track_data and track_data["status"] != "completed":
                    download_manager.enqueue_track(track_id)
                new_tracks_added += 1
                existing_video_ids.add(vid_id)

    for t in existing_tracks:
        if t["status"] in ("pending", "error"):
            download_manager.enqueue_track(t["id"])

    database.update_playlist_sync(playlist_id)

    return {
        "status": "success",
        "new_tracks_count": new_tracks_added,
        "total_tracks": len(entries)
    }
