import os
import mimetypes
from flask import Flask, render_template, request, jsonify, send_file, abort, Response
import database
import downloader

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False

database.init_db()
downloader.download_manager.enqueue_pending_tracks()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
THUMBNAILS_DIR = os.path.join(BASE_DIR, "downloads", "thumbnails")
AUDIO_DIR = os.path.join(BASE_DIR, "downloads", "audio")

DEFAULT_ART_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500" height="500">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#a855f7;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#grad)" />
  <circle cx="250" cy="250" r="140" fill="#111827" opacity="0.8" />
  <circle cx="250" cy="250" r="40" fill="#6366f1" />
  <path d="M225 180 v120 c-6 -4 -15 -6 -25 -6 -22 0 -40 13 -40 30 s18 30 40 30 40 -13 40 -30 v-94 l80 -20 v84 c-6 -4 -15 -6 -25 -6 -22 0 -40 13 -40 30 s18 30 40 30 40 -13 40 -30 v-134 z" fill="#ffffff" />
</svg>"""

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/manifest.json")
def manifest():
    return send_file(os.path.join(BASE_DIR, "static", "manifest.json"), mimetype="application/manifest+json")

@app.route("/sw.js")
def service_worker():
    response = send_file(os.path.join(BASE_DIR, "static", "sw.js"), mimetype="application/javascript")
    response.headers["Service-Worker-Allowed"] = "/"
    return response

@app.route("/api/playlists", methods=["GET"])
def get_playlists():
    playlists = database.get_playlists()
    return jsonify({"playlists": playlists})

@app.route("/api/playlists/import", methods=["POST"])
def import_playlist():
    data = request.get_json() or {}
    url = data.get("url", "").strip()

    if not url:
        return jsonify({"error": "Please provide a valid YouTube playlist or video link."}), 400

    try:
        result = downloader.import_youtube_playlist(url)
        return jsonify({
            "success": True,
            "message": f"Successfully imported '{result['playlist']['title']}'!",
            "playlist": result["playlist"],
            "total_tracks": result["total_tracks"],
            "new_tracks": result["new_tracks"]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/playlists/<playlist_id>", methods=["GET"])
def get_playlist_details(playlist_id):
    playlist = database.get_playlist(playlist_id)
    if not playlist:
        return jsonify({"error": "Playlist not found"}), 404

    tracks = database.get_playlist_tracks(playlist_id)
    return jsonify({
        "playlist": playlist,
        "tracks": tracks
    })

@app.route("/api/playlists/<playlist_id>/sync", methods=["POST"])
def sync_playlist(playlist_id):
    try:
        res = downloader.sync_playlist_now(playlist_id)
        tracks = database.get_playlist_tracks(playlist_id)
        playlist = database.get_playlist(playlist_id)
        return jsonify({
            "success": True,
            "status": res["status"],
            "new_tracks_count": res.get("new_tracks_count", 0),
            "playlist": playlist,
            "tracks": tracks
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/playlists/<playlist_id>", methods=["DELETE"])
def delete_playlist(playlist_id):
    database.delete_playlist(playlist_id)
    return jsonify({"success": True})

@app.route("/api/downloads/status", methods=["GET"])
def download_status():
    status = downloader.download_manager.get_status()
    return jsonify(status)

@app.route("/api/tracks/<int:track_id>/retry", methods=["POST"])
def retry_track(track_id):
    track = database.get_track(track_id)
    if not track:
        return jsonify({"error": "Track not found"}), 404

    database.update_track_status(track_id, status="pending", error_message=None)
    downloader.download_manager.enqueue_track(track_id)
    return jsonify({"success": True, "message": "Queued for download"})

@app.route("/stream/<int:track_id>")
def stream_audio(track_id):
    track = database.get_track(track_id)
    if not track:
        abort(404, description="Track not found")

    file_path = track["file_path"]
    if not file_path or not os.path.exists(file_path):
        expected = os.path.join(AUDIO_DIR, f"{track['video_id']}.mp3")
        if os.path.exists(expected) and os.path.getsize(expected) > 0:
            file_path = expected
            database.update_track_status(track_id, status="completed", file_path=expected)
        else:
            abort(404, description="Audio file is still downloading or not available yet.")

    response = send_file(
        file_path,
        mimetype="audio/mpeg",
        as_attachment=False,
        conditional=True
    )
    response.headers["Accept-Ranges"] = "bytes"
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response

@app.route("/thumbnail/<path:filename>")
def serve_thumbnail(filename):
    file_path = os.path.join(THUMBNAILS_DIR, filename)
    if os.path.exists(file_path) and os.path.getsize(file_path) > 0:
        return send_file(file_path, mimetype="image/jpeg", conditional=True)

    return Response(DEFAULT_ART_SVG, mimetype="image/svg+xml")

@app.route("/static/default-art.png")
def default_art():
    return Response(DEFAULT_ART_SVG, mimetype="image/svg+xml")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
