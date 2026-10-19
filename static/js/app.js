class App {
  constructor() {
    this.playlists = [];
    this.currentPlaylist = null;
    this.currentTracks = [];
    this.isPollingDownloads = false;
    this.downloadPollInterval = null;

    this.playlistsView = document.getElementById("playlists-view");
    this.playlistDetailView = document.getElementById("playlist-detail-view");
    this.playlistsGrid = document.getElementById("playlists-grid");
    this.playlistsEmpty = document.getElementById("playlists-empty");
    this.playlistsCount = document.getElementById("playlists-count");

    this.detailArtwork = document.getElementById("detail-artwork");
    this.detailTitle = document.getElementById("detail-title");
    this.detailTrackCount = document.getElementById("detail-track-count");
    this.detailCompletedCount = document.getElementById("detail-completed-count");
    this.detailYoutubeLink = document.getElementById("detail-youtube-link");
    this.detailSyncStatus = document.getElementById("detail-sync-status");
    this.syncStatusText = document.getElementById("sync-status-text");
    this.tracksList = document.getElementById("tracks-list");
    this.syncIcon = document.getElementById("sync-icon");

    this.downloadPill = document.getElementById("download-pill");
    this.downloadPillText = document.getElementById("download-pill-text");
    this.downloadModal = document.getElementById("download-modal");
    this.activeDlTitle = document.getElementById("active-dl-title");
    this.activeDlStatus = document.getElementById("active-dl-status");
    this.activeDlBar = document.getElementById("active-dl-bar");
    this.activeDlSpeed = document.getElementById("active-dl-speed");
    this.activeDlQueue = document.getElementById("active-dl-queue");

    this.importForm = document.getElementById("import-form");
    this.urlInput = document.getElementById("playlist-url-input");
    this.btnImportSubmit = document.getElementById("btn-import-submit");

    this.init();
  }

  init() {
    this.loadPlaylists();
    this.startDownloadPolling();
    this.registerServiceWorker();
  }

  registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(err => {
          console.log("ServiceWorker registration skipped:", err);
        });
      });
    }
  }

  async pasteClipboard() {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          this.urlInput.value = text.trim();
          this.showToast("Pasted playlist link!");
        }
      } else {
        this.urlInput.focus();
        this.showToast("Please paste directly into the box.", "info");
      }
    } catch (e) {
      this.urlInput.focus();
    }
  }

  async loadPlaylists() {
    try {
      const res = await fetch("/api/playlists");
      const data = await res.json();
      this.playlists = data.playlists || [];
      this.renderPlaylistsGrid();
    } catch (e) {
      console.error("Error loading playlists:", e);
    }
  }

  renderPlaylistsGrid() {
    if (!this.playlistsGrid) return;

    this.playlistsCount.textContent = `${this.playlists.length} Playlist${this.playlists.length === 1 ? '' : 's'}`;

    if (this.playlists.length === 0) {
      this.playlistsGrid.innerHTML = "";
      this.playlistsEmpty.classList.remove("hidden");
      return;
    }

    this.playlistsEmpty.classList.add("hidden");
    this.playlistsGrid.innerHTML = this.playlists.map(p => {
      const art = p.thumbnail_url || "/static/default-art.png";
      const total = p.total_tracks || 0;
      const completed = p.completed_tracks || 0;
      const downloading = p.downloading_tracks || 0;
      const pending = p.pending_tracks || 0;

      let statusPill = "";
      if (downloading > 0 || pending > 0) {
        statusPill = `<span class="card-sync-pill">Downloading (${completed}/${total})</span>`;
      } else {
        statusPill = `<span>${total} songs</span>`;
      }

      return `
        <div class="playlist-card" onclick="app.openPlaylist('${p.id}')">
          <div class="card-art-wrap">
            <img class="card-art" src="${art}" alt="${this.escapeHtml(p.title)}" onerror="this.src='/static/default-art.png'" />
            <div class="card-play-overlay">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            </div>
          </div>
          <div class="card-title" title="${this.escapeHtml(p.title)}">${this.escapeHtml(p.title)}</div>
          <div class="card-meta">
            ${statusPill}
            <span style="font-size:0.75rem; color:#64748b">Auto-syncs</span>
          </div>
        </div>
      `;
    }).join("");
  }

  showPlaylistsView() {
    this.currentPlaylist = null;
    this.playlistDetailView.classList.remove("active");
    this.playlistsView.classList.add("active");
    this.loadPlaylists();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async openPlaylist(playlistId) {
    try {

      const res = await fetch(`/api/playlists/${playlistId}`);
      if (!res.ok) throw new Error("Could not load playlist");
      const data = await res.json();

      this.currentPlaylist = data.playlist;
      this.currentTracks = data.tracks || [];

      this.renderPlaylistHero();
      this.renderTracksList();

      this.playlistsView.classList.remove("active");
      this.playlistDetailView.classList.add("active");
      window.scrollTo({ top: 0, behavior: "smooth" });

      this.autoSyncPlaylist(playlistId);

    } catch (e) {
      console.error("Error opening playlist:", e);
      this.showToast("Could not load playlist: " + e.message, "error");
    }
  }

  renderPlaylistHero() {
    if (!this.currentPlaylist) return;

    this.detailTitle.textContent = this.currentPlaylist.title;
    this.detailArtwork.src = this.currentPlaylist.thumbnail_url || "/static/default-art.png";
    this.detailYoutubeLink.href = this.currentPlaylist.youtube_url || "#";

    const total = this.currentTracks.length;
    const completed = this.currentTracks.filter(t => t.status === "completed").length;

    this.detailTrackCount.textContent = `${total} track${total === 1 ? '' : 's'}`;
    this.detailCompletedCount.textContent = `${completed} downloaded`;
  }

  renderTracksList() {
    if (!this.tracksList) return;

    if (this.currentTracks.length === 0) {
      this.tracksList.innerHTML = `
        <div style="padding: 40px 20px; text-align: center; color: var(--text-muted);">
          No tracks found in this playlist.
        </div>
      `;
      return;
    }

    const currentPlayingId = player.currentTrack ? player.currentTrack.id : null;
    const isPlaying = player.isPlaying;

    this.tracksList.innerHTML = this.currentTracks.map((t, idx) => {
      const isCur = t.id === currentPlayingId;
      const activeClass = isCur ? `active ${isPlaying ? 'is-playing' : ''}` : '';
      const thumb = t.thumbnail_path || "/static/default-art.png";

      let statusBadge = "";
      if (t.status === "completed") {
        statusBadge = `<span class="status-badge status-completed">Ready</span>`;
      } else if (t.status === "downloading") {
        statusBadge = `<span class="status-badge status-downloading">Downloading</span>`;
      } else if (t.status === "pending") {
        statusBadge = `<span class="status-badge status-pending">Queued</span>`;
      } else if (t.status === "error") {
        statusBadge = `<button class="status-badge status-error" onclick="event.stopPropagation(); app.retryTrack(${t.id})">Retry</button>`;
      }

      return `
        <div class="track-row ${activeClass}" id="track-row-${t.id}" onclick="app.handleTrackRowClick(${t.id})">
          <div class="col-num">
            <span class="track-index-num">${idx + 1}</span>
            <svg class="track-playing-icon" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </div>
          <div class="col-main">
            <img class="track-thumb" src="${thumb}" alt="art" onerror="this.src='/static/default-art.png'" />
            <div class="track-details">
              <div class="col-title" title="${this.escapeHtml(t.title)}">${this.escapeHtml(t.title)}</div>
              <div class="col-artist">${this.escapeHtml(t.artist || 'Unknown Artist')}</div>
            </div>
          </div>
          <div class="col-status">
            ${statusBadge}
          </div>
          <div class="col-duration">
            ${t.duration_formatted || '0:00'}
          </div>
        </div>
      `;
    }).join("");
  }

  handleTrackRowClick(trackId) {
    const track = this.currentTracks.find(t => t.id === trackId);
    if (!track) return;

    if (track.status === "error") {
      this.retryTrack(trackId);
      return;
    }

    if (track.status === "pending" || track.status === "downloading") {
      this.showToast("Song is still downloading. It will play automatically when ready.", "info");
    }

    player.playTrack(track, this.currentPlaylist, this.currentTracks);
  }

  updateActiveTrackInList(trackId, isPlaying) {
    document.querySelectorAll(".track-row").forEach(el => {
      el.classList.remove("active", "is-playing");
    });
    const row = document.getElementById(`track-row-${trackId}`);
    if (row) {
      row.classList.add("active");
      if (isPlaying) row.classList.add("is-playing");
    }
  }

  async autoSyncPlaylist(playlistId) {
    this.detailSyncStatus.classList.remove("up-to-date", "hidden");
    this.syncStatusText.textContent = "Checking YouTube for new songs...";
    if (this.syncIcon) this.syncIcon.style.animation = "spin 1s linear infinite";

    try {
      const res = await fetch(`/api/playlists/${playlistId}/sync`, { method: "POST" });
      const data = await res.json();

      if (this.syncIcon) this.syncIcon.style.animation = "";

      if (data.success) {
        if (this.currentPlaylist && this.currentPlaylist.id === playlistId) {
          this.currentTracks = data.tracks || [];
          this.renderPlaylistHero();
          this.renderTracksList();

          this.detailSyncStatus.classList.add("up-to-date");
          if (data.new_tracks_count > 0) {
            this.syncStatusText.textContent = `Found ${data.new_tracks_count} new song${data.new_tracks_count === 1 ? '' : 's'}! Downloading now.`;
            this.showToast(`Auto-updated: ${data.new_tracks_count} new songs added to download queue!`, "success");
          } else {
            this.syncStatusText.textContent = "Playlist is up to date with YouTube.";
          }
        }
      } else {
        this.syncStatusText.textContent = "Sync offline (playing local songs).";
      }
    } catch (e) {
      if (this.syncIcon) this.syncIcon.style.animation = "";
      this.syncStatusText.textContent = "Offline mode active.";
      console.warn("Auto-sync error (offline or unreachable):", e);
    }
  }

  async triggerCurrentPlaylistSync() {
    if (!this.currentPlaylist) return;
    this.showToast("Checking YouTube playlist...", "info");
    await this.autoSyncPlaylist(this.currentPlaylist.id);
  }

  async deleteCurrentPlaylist() {
    if (!this.currentPlaylist) return;
    const confirmDelete = confirm(`Are you sure you want to delete "${this.currentPlaylist.title}"?`);
    if (!confirmDelete) return;

    try {
      await fetch(`/api/playlists/${this.currentPlaylist.id}`, { method: "DELETE" });
      this.showToast("Playlist deleted");
      this.showPlaylistsView();
    } catch (e) {
      this.showToast("Error deleting playlist", "error");
    }
  }

  async retryTrack(trackId) {
    try {
      await fetch(`/api/tracks/${trackId}/retry`, { method: "POST" });
      this.showToast("Track queued for download");
      if (this.currentPlaylist) {
        this.openPlaylist(this.currentPlaylist.id);
      }
    } catch (e) {
      this.showToast("Failed to retry track", "error");
    }
  }

  async handleImport(e) {
    e.preventDefault();
    const url = this.urlInput.value.trim();
    if (!url) return;

    const btn = this.btnImportSubmit;
    const spinner = btn.querySelector(".spinner");
    const content = btn.querySelector(".btn-content");

    btn.disabled = true;
    spinner.classList.remove("hidden");
    content.classList.add("hidden");

    this.showToast("Reading YouTube playlist metadata...", "info");

    try {
      const res = await fetch("/api/playlists/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      this.showToast(data.message || "Playlist imported! Starting background downloads.", "success");
      this.urlInput.value = "";

      await this.openPlaylist(data.playlist.id);

    } catch (err) {
      console.error("Import error:", err);
      this.showToast(err.message, "error");
    } finally {
      btn.disabled = false;
      spinner.classList.add("hidden");
      content.classList.remove("hidden");
    }
  }

  startDownloadPolling() {
    this.downloadPollInterval = setInterval(async () => {
      try {
        const res = await fetch("/api/downloads/status");
        const status = await res.json();
        this.updateDownloadUI(status);
      } catch (e) {}
    }, 2000);
  }

  updateDownloadUI(status) {
    if (status.active || (status.queue_count && status.queue_count > 0)) {
      this.downloadPill.classList.remove("hidden");
      const percentStr = status.percent ? `${status.percent}%` : "";
      this.downloadPillText.textContent = `${status.status_text || "Downloading"} ${percentStr}`;

      this.activeDlTitle.textContent = status.title || "Downloading track...";
      this.activeDlStatus.textContent = `${status.status_text || "Downloading"} ${status.percent || 0}%`;
      this.activeDlBar.style.width = `${status.percent || 0}%`;
      this.activeDlSpeed.textContent = status.speed ? `Speed: ${status.speed}` : "";
      this.activeDlQueue.textContent = `Queued: ${status.queue_count} remaining`;

      if (this.currentPlaylist && status.percent === 0) {
        this.refreshCurrentPlaylistTracksSilently();
      }
    } else {
      this.downloadPill.classList.add("hidden");
      this.activeDlTitle.textContent = "Idle";
      this.activeDlStatus.textContent = "All downloads complete";
      this.activeDlBar.style.width = "0%";
      this.activeDlSpeed.textContent = "";
      this.activeDlQueue.textContent = "";
    }
  }

  async refreshCurrentPlaylistTracksSilently() {
    if (!this.currentPlaylist) return;
    try {
      const res = await fetch(`/api/playlists/${this.currentPlaylist.id}`);
      const data = await res.json();
      if (data && data.tracks) {
        this.currentTracks = data.tracks;
        this.renderPlaylistHero();
        this.renderTracksList();
      }
    } catch (e) {}
  }

  showDownloadModal() {
    this.downloadModal.classList.remove("hidden");
  }

  hideDownloadModal() {
    this.downloadModal.classList.add("hidden");
  }

  showToast(message, type = "normal") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
    toast.textContent = message;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

const app = new App();
