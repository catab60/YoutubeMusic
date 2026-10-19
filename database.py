import sqlite3
import os
import contextlib
from typing import List, Dict, Any, Optional

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "music.db")

@contextlib.contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS playlists (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                youtube_url TEXT NOT NULL,
                thumbnail_url TEXT,
                track_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id TEXT NOT NULL,
                video_id TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT DEFAULT 'Unknown Artist',
                duration INTEGER DEFAULT 0,
                duration_formatted TEXT DEFAULT '0:00',
                file_path TEXT,
                thumbnail_path TEXT,
                status TEXT DEFAULT 'pending',
                error_message TEXT,
                track_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE,
                UNIQUE (playlist_id, video_id)
            )
        """)

        conn.execute("CREATE INDEX IF NOT EXISTS idx_tracks_playlist ON tracks(playlist_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tracks_video ON tracks(video_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(status)")

def add_playlist(playlist_id: str, title: str, youtube_url: str, thumbnail_url: Optional[str] = None) -> Dict[str, Any]:
    with get_db() as conn:
        conn.execute("""
            INSERT INTO playlists (id, title, youtube_url, thumbnail_url, last_synced_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                youtube_url = excluded.youtube_url,
                thumbnail_url = COALESCE(excluded.thumbnail_url, playlists.thumbnail_url),
                last_synced_at = CURRENT_TIMESTAMP
        """, (playlist_id, title, youtube_url, thumbnail_url))
    return get_playlist(playlist_id)

def get_playlists() -> List[Dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute("""
            SELECT p.*,
                   COUNT(t.id) as total_tracks,
                   SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tracks,
                   SUM(CASE WHEN t.status = 'downloading' THEN 1 ELSE 0 END) as downloading_tracks,
                   SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) as pending_tracks
            FROM playlists p
            LEFT JOIN tracks t ON p.id = t.playlist_id
            GROUP BY p.id
            ORDER BY p.created_at DESC
        """).fetchall()
        return [dict(r) for r in rows]

def get_playlist(playlist_id: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        row = conn.execute("""
            SELECT p.*,
                   COUNT(t.id) as total_tracks,
                   SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tracks,
                   SUM(CASE WHEN t.status = 'downloading' THEN 1 ELSE 0 END) as downloading_tracks,
                   SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) as pending_tracks
            FROM playlists p
            LEFT JOIN tracks t ON p.id = t.playlist_id
            WHERE p.id = ?
            GROUP BY p.id
        """, (playlist_id,)).fetchone()
        return dict(row) if row else None

def update_playlist_sync(playlist_id: str):
    with get_db() as conn:
        conn.execute("""
            UPDATE playlists
            SET last_synced_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (playlist_id,))

def delete_playlist(playlist_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))

def add_track(playlist_id: str, video_id: str, title: str, artist: str = "Unknown Artist",
              duration: int = 0, duration_formatted: str = "0:00",
              thumbnail_path: Optional[str] = None, track_order: int = 0) -> Optional[int]:
    with get_db() as conn:
        existing_file = conn.execute("""
            SELECT file_path, thumbnail_path, duration, duration_formatted
            FROM tracks
            WHERE video_id = ? AND status = 'completed' AND file_path IS NOT NULL
            LIMIT 1
        """, (video_id,)).fetchone()

        status = 'completed' if existing_file and os.path.exists(existing_file['file_path']) else 'pending'
        file_path = existing_file['file_path'] if status == 'completed' else None
        if existing_file:
            duration = existing_file['duration'] or duration
            duration_formatted = existing_file['duration_formatted'] or duration_formatted
            thumbnail_path = existing_file['thumbnail_path'] or thumbnail_path

        try:
            cursor = conn.execute("""
                INSERT INTO tracks (playlist_id, video_id, title, artist, duration, duration_formatted,
                                   file_path, thumbnail_path, status, track_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(playlist_id, video_id) DO UPDATE SET
                    title = excluded.title,
                    artist = excluded.artist,
                    track_order = excluded.track_order
            """, (playlist_id, video_id, title, artist, duration, duration_formatted,
                  file_path, thumbnail_path, status, track_order))
            return cursor.lastrowid
        except Exception:
            return None

def get_playlist_tracks(playlist_id: str) -> List[Dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute("""
            SELECT * FROM tracks
            WHERE playlist_id = ?
            ORDER BY track_order ASC, id ASC
        """, (playlist_id,)).fetchall()
        return [dict(r) for r in rows]

def get_track(track_id: int) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()
        return dict(row) if row else None

def get_track_by_video_id(video_id: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM tracks WHERE video_id = ? LIMIT 1", (video_id,)).fetchone()
        return dict(row) if row else None

def update_track_status(track_id: int, status: str, file_path: Optional[str] = None,
                        duration: Optional[int] = None, duration_formatted: Optional[str] = None,
                        thumbnail_path: Optional[str] = None, error_message: Optional[str] = None):
    with get_db() as conn:
        updates = ["status = ?"]
        params = [status]

        if file_path is not None:
            updates.append("file_path = ?")
            params.append(file_path)
        if duration is not None:
            updates.append("duration = ?")
            params.append(duration)
        if duration_formatted is not None:
            updates.append("duration_formatted = ?")
            params.append(duration_formatted)
        if thumbnail_path is not None:
            updates.append("thumbnail_path = ?")
            params.append(thumbnail_path)
        if error_message is not None:
            updates.append("error_message = ?")
            params.append(error_message)

        params.append(track_id)
        conn.execute(f"UPDATE tracks SET {', '.join(updates)} WHERE id = ?", params)

        if status == 'completed' and file_path:
            track = conn.execute("SELECT video_id FROM tracks WHERE id = ?", (track_id,)).fetchone()
            if track:
                conn.execute("""
                    UPDATE tracks
                    SET status = 'completed',
                        file_path = ?,
                        duration = COALESCE(?, duration),
                        duration_formatted = COALESCE(?, duration_formatted),
                        thumbnail_path = COALESCE(?, thumbnail_path)
                    WHERE video_id = ? AND status != 'completed'
                """, (file_path, duration, duration_formatted, thumbnail_path, track['video_id']))

def get_pending_tracks() -> List[Dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute("""
            SELECT * FROM tracks
            WHERE status = 'pending'
            ORDER BY id ASC
        """).fetchall()
        return [dict(r) for r in rows]
