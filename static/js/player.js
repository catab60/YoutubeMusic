class AudioPlayer {
  constructor() {
    this.audio = document.getElementById("audio-engine");
    this.currentTrack = null;
    this.currentPlaylist = null;
    this.queue = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isShuffle = false;
    this.repeatMode = "all";
    this.volume = 0.9;
    this.isMuted = false;

    this.loadSettings();

    this.initElements();

    this.initAudioEvents();
    this.initMediaSession();
  }

  loadSettings() {
    try {
      const savedVol = localStorage.getItem("tunestream_volume");
      if (savedVol !== null) this.volume = parseFloat(savedVol);
      const savedRepeat = localStorage.getItem("tunestream_repeat");
      if (savedRepeat) this.repeatMode = savedRepeat;
      const savedShuffle = localStorage.getItem("tunestream_shuffle");
      if (savedShuffle !== null) this.isShuffle = savedShuffle === "true";
    } catch (e) {
      console.warn("Could not load stored audio settings:", e);
    }
  }

  saveSettings() {
    try {
      localStorage.setItem("tunestream_volume", this.volume);
      localStorage.setItem("tunestream_repeat", this.repeatMode);
      localStorage.setItem("tunestream_shuffle", this.isShuffle);
    } catch (e) {}
  }

  initElements() {

    this.nowPlayingArt = document.getElementById("now-playing-art");
    this.nowPlayingTitle = document.getElementById("now-playing-title");
    this.nowPlayingArtist = document.getElementById("now-playing-artist");
    this.btnPlayPause = document.getElementById("btn-play-pause");
    this.iconPlay = document.getElementById("icon-play");
    this.iconPause = document.getElementById("icon-pause");
    this.btnShuffle = document.getElementById("btn-shuffle");
    this.btnRepeat = document.getElementById("btn-repeat");
    this.repeatOneBadge = document.getElementById("repeat-one-badge");
    this.timeCurrent = document.getElementById("time-current");
    this.timeTotal = document.getElementById("time-total");
    this.scrubProgress = document.getElementById("scrub-progress");
    this.scrubBuffered = document.getElementById("scrub-buffered");
    this.scrubThumb = document.getElementById("scrub-thumb");
    this.volumeSlider = document.getElementById("volume-slider");
    this.btnMute = document.getElementById("btn-mute");
    this.iconVolHigh = document.getElementById("icon-vol-high");
    this.iconVolMute = document.getElementById("icon-vol-mute");

    this.fsPlayer = document.getElementById("fullscreen-player");
    this.fsArt = document.getElementById("fs-art");
    this.fsTitle = document.getElementById("fs-title");
    this.fsArtist = document.getElementById("fs-artist");
    this.fsPlaylistName = document.getElementById("fs-playlist-name");
    this.fsTimeCurrent = document.getElementById("fs-time-current");
    this.fsTimeTotal = document.getElementById("fs-time-total");
    this.fsScrubProgress = document.getElementById("fs-scrub-progress");
    this.fsIconPlay = document.getElementById("fs-icon-play");
    this.fsIconPause = document.getElementById("fs-icon-pause");
    this.fsBtnShuffle = document.getElementById("fs-btn-shuffle");
    this.fsBtnRepeat = document.getElementById("fs-btn-repeat");
    this.fsRepeatOneBadge = document.getElementById("fs-repeat-one-badge");

    this.queueDrawer = document.getElementById("queue-drawer");
    this.queueTracksList = document.getElementById("queue-tracks-list");

    if (this.volumeSlider) this.volumeSlider.value = this.volume;
    if (this.audio) this.audio.volume = this.volume;
    this.updateShuffleUI();
    this.updateRepeatUI();
  }

  initAudioEvents() {
    if (!this.audio) return;

    this.audio.addEventListener("timeupdate", () => this.handleTimeUpdate());
    this.audio.addEventListener("progress", () => this.handleBufferProgress());
    this.audio.addEventListener("play", () => this.handlePlayStateChange(true));
    this.audio.addEventListener("pause", () => this.handlePlayStateChange(false));
    this.audio.addEventListener("ended", () => this.handleTrackEnded());
    this.audio.addEventListener("error", (e) => this.handleAudioError(e));
  }

  initMediaSession() {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.setActionHandler("play", () => this.play());
    navigator.mediaSession.setActionHandler("pause", () => this.pause());
    navigator.mediaSession.setActionHandler("previoustrack", () => this.prev());
    navigator.mediaSession.setActionHandler("nexttrack", () => this.next());
    navigator.mediaSession.setActionHandler("seekbackward", (details) => {
      const skip = details.seekOffset || 10;
      this.seek(Math.max(this.audio.currentTime - skip, 0));
    });
    navigator.mediaSession.setActionHandler("seekforward", (details) => {
      const skip = details.seekOffset || 10;
      this.seek(Math.min(this.audio.currentTime + skip, this.audio.duration || 0));
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined) {
        this.seek(details.seekTime);
      }
    });
  }

  updateMediaSessionMetadata() {
    if (!("mediaSession" in navigator) || !this.currentTrack) return;

    const artworkUrl = this.currentTrack.thumbnail_path || "/static/default-art.png";
    const fullArtworkUrl = artworkUrl.startsWith("http") ? artworkUrl : window.location.origin + artworkUrl;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.currentTrack.title,
      artist: this.currentTrack.artist || "YouTube Music",
      album: this.currentPlaylist ? this.currentPlaylist.title : "TuneStream",
      artwork: [
        { src: fullArtworkUrl, sizes: "96x96", type: "image/jpeg" },
        { src: fullArtworkUrl, sizes: "128x128", type: "image/jpeg" },
        { src: fullArtworkUrl, sizes: "192x192", type: "image/jpeg" },
        { src: fullArtworkUrl, sizes: "256x256", type: "image/jpeg" },
        { src: fullArtworkUrl, sizes: "384x384", type: "image/jpeg" },
        { src: fullArtworkUrl, sizes: "512x512", type: "image/jpeg" }
      ]
    });

    navigator.mediaSession.playbackState = this.isPlaying ? "playing" : "paused";
    this.updatePositionState();
  }

  updatePositionState() {
    if (!("mediaSession" in navigator) || !("setPositionState" in navigator.mediaSession)) return;
    if (this.audio.duration && !isNaN(this.audio.duration) && isFinite(this.audio.duration)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: this.audio.duration,
          playbackRate: this.audio.playbackRate,
          position: Math.min(this.audio.currentTime, this.audio.duration)
        });
      } catch (e) {}
    }
  }

  playTrack(track, playlist = null, newQueue = null) {
    if (!track) return;

    if (playlist) this.currentPlaylist = playlist;
    if (newQueue) {
      this.queue = [...newQueue];
      this.currentIndex = this.queue.findIndex(t => t.id === track.id);
    } else {
      if (this.currentIndex === -1 || !this.queue.some(t => t.id === track.id)) {
        this.queue = [track];
        this.currentIndex = 0;
      } else {
        this.currentIndex = this.queue.findIndex(t => t.id === track.id);
      }
    }

    this.currentTrack = track;
    this.updateTrackUI();

    this.audio.src = `/stream/${track.id}`;
    this.audio.load();

    const playPromise = this.audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          this.isPlaying = true;
          this.updateMediaSessionMetadata();
          this.updatePlayStateUI();
        })
        .catch(err => {
          console.warn("Auto-play prevented or stream error:", err);
          if (track.status !== "completed") {
            app.showToast("This track is still downloading. Skipping...", "error");
            setTimeout(() => this.next(), 1000);
          }
        });
    }

    this.renderQueue();
    if (typeof app !== "undefined" && app.updateActiveTrackInList) {
      app.updateActiveTrackInList(track.id, true);
    }
  }

  playAllFromCurrentPlaylist() {
    if (!app.currentTracks || app.currentTracks.length === 0) {
      app.showToast("No tracks in this playlist yet.", "error");
      return;
    }
    const playable = app.currentTracks.filter(t => t.status === "completed");
    if (playable.length === 0) {
      app.showToast("Tracks are still downloading. Please wait a moment...", "error");
      return;
    }
    this.playTrack(playable[0], app.currentPlaylist, playable);
  }

  shuffleAllFromCurrentPlaylist() {
    if (!app.currentTracks || app.currentTracks.length === 0) return;
    const playable = app.currentTracks.filter(t => t.status === "completed");
    if (playable.length === 0) {
      app.showToast("Tracks are still downloading.", "error");
      return;
    }
    const shuffled = [...playable].sort(() => Math.random() - 0.5);
    this.isShuffle = true;
    this.updateShuffleUI();
    this.playTrack(shuffled[0], app.currentPlaylist, shuffled);
  }

  play() {
    if (!this.currentTrack && this.queue.length > 0) {
      this.playTrack(this.queue[0]);
      return;
    }
    if (this.audio.src) {
      this.audio.play().catch(e => console.error("Play error:", e));
    }
  }

  pause() {
    this.audio.pause();
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  next() {
    if (this.queue.length === 0) return;

    if (this.isShuffle) {
      let randIdx = Math.floor(Math.random() * this.queue.length);
      if (this.queue.length > 1 && randIdx === this.currentIndex) {
        randIdx = (randIdx + 1) % this.queue.length;
      }
      this.currentIndex = randIdx;
    } else {
      this.currentIndex++;
      if (this.currentIndex >= this.queue.length) {
        if (this.repeatMode === "all") {
          this.currentIndex = 0;
        } else {
          this.currentIndex = this.queue.length - 1;
          this.pause();
          return;
        }
      }
    }

    const nextTrack = this.queue[this.currentIndex];
    this.playTrack(nextTrack, this.currentPlaylist);
  }

  prev() {
    if (this.queue.length === 0) return;

    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }

    this.currentIndex--;
    if (this.currentIndex < 0) {
      this.currentIndex = this.queue.length - 1;
    }

    const prevTrack = this.queue[this.currentIndex];
    this.playTrack(prevTrack, this.currentPlaylist);
  }

  handleTrackEnded() {
    if (this.repeatMode === "one") {
      this.audio.currentTime = 0;
      this.audio.play();
      return;
    }

    this.next();
  }

  seek(seconds) {
    if (this.audio.duration && !isNaN(this.audio.duration)) {
      this.audio.currentTime = seconds;
      this.updatePositionState();
    }
  }

  handleScrubClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    if (this.audio.duration && !isNaN(this.audio.duration)) {
      this.seek(pos * this.audio.duration);
    }
  }

  setVolume(val) {
    this.volume = parseFloat(val);
    this.audio.volume = this.volume;
    this.isMuted = this.volume === 0;
    this.updateVolumeUI();
    this.saveSettings();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.audio.muted = this.isMuted;
    this.updateVolumeUI();
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    this.updateShuffleUI();
    this.saveSettings();
    app.showToast(this.isShuffle ? "Shuffle On" : "Shuffle Off");
  }

  toggleRepeat() {
    if (this.repeatMode === "all") {
      this.repeatMode = "one";
      app.showToast("Repeat One Track");
    } else if (this.repeatMode === "one") {
      this.repeatMode = "off";
      app.showToast("Repeat Off");
    } else {
      this.repeatMode = "all";
      app.showToast("Repeat All Tracks");
    }
    this.updateRepeatUI();
    this.saveSettings();
  }

  handleTimeUpdate() {
    const cur = this.audio.currentTime || 0;
    const dur = this.audio.duration || 0;
    const percent = dur > 0 ? (cur / dur) * 100 : 0;

    const formattedCur = this.formatTime(cur);
    const formattedDur = this.formatTime(dur);

    if (this.timeCurrent) this.timeCurrent.textContent = formattedCur;
    if (this.timeTotal) this.timeTotal.textContent = formattedDur;
    if (this.scrubProgress) this.scrubProgress.style.width = `${percent}%`;
    if (this.scrubThumb) this.scrubThumb.style.left = `${percent}%`;

    if (this.fsTimeCurrent) this.fsTimeCurrent.textContent = formattedCur;
    if (this.fsTimeTotal) this.fsTimeTotal.textContent = formattedDur;
    if (this.fsScrubProgress) this.fsScrubProgress.style.width = `${percent}%`;

    if (Math.floor(cur) % 5 === 0) {
      this.updatePositionState();
    }
  }

  handleBufferProgress() {
    if (this.audio.buffered.length > 0 && this.audio.duration) {
      const bufferedEnd = this.audio.buffered.end(this.audio.buffered.length - 1);
      const percent = (bufferedEnd / this.audio.duration) * 100;
      if (this.scrubBuffered) this.scrubBuffered.style.width = `${percent}%`;
    }
  }

  handlePlayStateChange(playing) {
    this.isPlaying = playing;
    this.updatePlayStateUI();

    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }

    if (typeof app !== "undefined" && app.updateActiveTrackInList && this.currentTrack) {
      app.updateActiveTrackInList(this.currentTrack.id, playing);
    }
  }

  handleAudioError(e) {
    console.error("Audio error encountered:", e);
    if (this.currentTrack) {
      app.showToast(`Error playing ${this.currentTrack.title}. Trying next track...`, "error");
      setTimeout(() => this.next(), 1200);
    }
  }

  updateTrackUI() {
    if (!this.currentTrack) return;

    const art = this.currentTrack.thumbnail_path || "/static/default-art.png";
    const title = this.currentTrack.title;
    const artist = this.currentTrack.artist || "Unknown Artist";
    const playlistName = this.currentPlaylist ? this.currentPlaylist.title : "TuneStream";

    if (this.nowPlayingArt) this.nowPlayingArt.src = art;
    if (this.nowPlayingTitle) this.nowPlayingTitle.textContent = title;
    if (this.nowPlayingArtist) this.nowPlayingArtist.textContent = artist;

    if (this.fsArt) this.fsArt.src = art;
    if (this.fsTitle) this.fsTitle.textContent = title;
    if (this.fsArtist) this.fsArtist.textContent = artist;
    if (this.fsPlaylistName) this.fsPlaylistName.textContent = playlistName;
  }

  updatePlayStateUI() {
    if (this.isPlaying) {
      this.iconPlay.classList.add("hidden");
      this.iconPause.classList.remove("hidden");
      this.fsIconPlay.classList.add("hidden");
      this.fsIconPause.classList.remove("hidden");
    } else {
      this.iconPlay.classList.remove("hidden");
      this.iconPause.classList.add("hidden");
      this.fsIconPlay.classList.remove("hidden");
      this.fsIconPause.classList.add("hidden");
    }
  }

  updateShuffleUI() {
    if (this.isShuffle) {
      this.btnShuffle.classList.add("active");
      this.fsBtnShuffle.classList.add("active");
    } else {
      this.btnShuffle.classList.remove("active");
      this.fsBtnShuffle.classList.remove("active");
    }
  }

  updateRepeatUI() {
    this.btnRepeat.classList.remove("active");
    this.fsBtnRepeat.classList.remove("active");
    this.repeatOneBadge.classList.add("hidden");
    this.fsRepeatOneBadge.classList.add("hidden");

    if (this.repeatMode === "all") {
      this.btnRepeat.classList.add("active");
      this.fsBtnRepeat.classList.add("active");
    } else if (this.repeatMode === "one") {
      this.btnRepeat.classList.add("active");
      this.fsBtnRepeat.classList.add("active");
      this.repeatOneBadge.classList.remove("hidden");
      this.fsRepeatOneBadge.classList.remove("hidden");
    }
  }

  updateVolumeUI() {
    if (this.isMuted || this.volume === 0) {
      this.iconVolHigh.classList.add("hidden");
      this.iconVolMute.classList.remove("hidden");
    } else {
      this.iconVolHigh.classList.remove("hidden");
      this.iconVolMute.classList.add("hidden");
    }
  }

  openFullscreenPlayer() {
    if (!this.currentTrack) return;
    this.fsPlayer.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  closeFullscreenPlayer() {
    this.fsPlayer.classList.remove("active");
    document.body.style.overflow = "";
  }

  toggleQueueDrawer() {
    this.queueDrawer.classList.toggle("active");
  }

  renderQueue() {
    if (!this.queueTracksList) return;
    if (this.queue.length === 0) {
      this.queueTracksList.innerHTML = `<div style="padding:20px; text-align:center; color:#64748b; font-size:0.85rem">Queue is empty</div>`;
      return;
    }

    this.queueTracksList.innerHTML = this.queue.map((t, idx) => `
      <div class="queue-item ${idx === this.currentIndex ? 'active' : ''}" onclick="player.playTrack(player.queue[${idx}])">
        <img class="queue-thumb" src="${t.thumbnail_path || '/static/default-art.png'}" onerror="this.src='/static/default-art.png'" />
        <div class="queue-details">
          <div class="queue-title">${app.escapeHtml(t.title)}</div>
          <div class="queue-artist">${app.escapeHtml(t.artist || 'Unknown')}</div>
        </div>
      </div>
    `).join("");
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }
}

const player = new AudioPlayer();
