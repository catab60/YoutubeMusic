# TuneStream

A web-based music player built with Flask that downloads YouTube playlists locally as MP3s for offline and background playback.

## Features

- **YouTube Playlist Import**: Paste a playlist link to download tracks locally as MP3s using yt-dlp and ffmpeg.
- **Background & Lock Screen Playback**: Full MediaSession API integration for lock screen controls, notification playback, and background audio continuity when the screen is locked or turned off.
- **Auto-Sync**: Checks YouTube for newly added songs each time you open a playlist and queues them for download automatically.
- **Offline Ready**: All downloaded songs and thumbnails are stored locally and playable without internet.
- **PWA Support**: Can be installed to the home screen on mobile browsers.

## Quick Start

```bash
./run.sh
```

Or run directly:

```bash
python3 app.py
```

### Accessing the Web App

- Local: `http://localhost:5000`
- On Wi-Fi: `http://<device-ip>:5000`

## Termux / Android Notes

- `run.sh` calls `termux-wake-lock` if available to keep the server running when the screen is off.
- In Chrome or Firefox on Android, tap "Add to Home Screen" or "Install App" to use it as a standalone app.

## Project Structure

```
youtube_p/
├── app.py
├── database.py
├── downloader.py
├── requirements.txt
├── run.sh
├── test_app.py
├── templates/
│   └── index.html
├── static/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── app.js
│   │   └── player.js
│   ├── manifest.json
│   └── sw.js
└── downloads/
    ├── audio/
    └── thumbnails/
```
