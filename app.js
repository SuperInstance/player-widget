/* ============================================
   Channel 42 — LucidDreamer.AI Player Logic
   HLS streaming · Web Audio API visualizer
   Now-playing polling · Feedback submission
   ============================================ */

(function () {
  'use strict';

  /* ---- Config ---- */
  const CONFIG = {
    streamUrl: 'https://stream.luciddreamer.ai/live/index.m3u8',
    nowPlayingEndpoint: 'https://now-playing.luciddreamer.ai/api/now-playing',
    feedbackEndpoint: 'https://feedback.luciddreamer.ai/api/feedback',
    pollInterval: 10000, // 10 seconds
    pollRetries: 3,
  };

  /* ---- DOM refs ---- */
  const els = {
    playBtn: document.getElementById('playBtn'),
    prevBtn: document.getElementById('prevBtn'),
    nextBtn: document.getElementById('nextBtn'),
    iconPlay: document.querySelector('.icon-play'),
    iconPause: document.querySelector('.icon-pause'),
    trackTitle: document.getElementById('trackTitle'),
    trackMeta: document.getElementById('trackMeta'),
    trackDesc: document.getElementById('trackDesc'),
    currentTime: document.getElementById('currentTime'),
    totalTime: document.getElementById('totalTime'),
    progressBar: document.getElementById('progressBar'),
    progressFill: document.getElementById('progressFill'),
    progressHandle: document.getElementById('progressHandle'),
    volumeSlider: document.getElementById('volumeSlider'),
    visualizer: document.getElementById('visualizer'),
    vizWrap: document.querySelector('.visualizer-wrap'),
    upNextList: document.getElementById('upNextList'),
    feedbackInput: document.getElementById('feedbackInput'),
    feedbackSubmit: document.getElementById('feedbackSubmit'),
    feedbackStatus: document.getElementById('feedbackStatus'),
    liveIndicator: document.getElementById('liveIndicator'),
    liveText: document.querySelector('.live-text'),
    listenerCount: document.getElementById('listenerCount'),
    stars: document.getElementById('stars'),
  };

  /* ---- State ---- */
  const state = {
    hls: null,
    audio: null,
    audioContext: null,
    analyser: null,
    source: null,
    dataArray: null,
    isPlaying: false,
    isReady: false,
    nowPlaying: null,
    upNext: [],
    pollTimer: null,
    vizRaf: null,
    progressTimer: null,
    trackStartTime: 0,
    trackDuration: 0,
  };

  /* ---- Utils ---- */
  const utils = {
    fmtTime(seconds) {
      if (!seconds || seconds < 0 || isNaN(seconds)) return '--:--';
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    },

    fmtScheduleTime(iso) {
      try {
        const d = new Date(iso);
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      } catch {
        return '—';
      }
    },

    storage: {
      get(key, fallback) {
        try {
          const v = localStorage.getItem('ch42_' + key);
          return v !== null ? JSON.parse(v) : fallback;
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        try {
          localStorage.setItem('ch42_' + key, JSON.stringify(value));
        } catch { /* ignore quota */ }
      },
    },

    debounce(fn, ms) {
      let t;
      return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
      };
    },
  };

  /* ---- Stars background ---- */
  function createStars() {
    const container = els.stars;
    const count = window.innerWidth < 600 ? 40 : 70;
    const frag = document.createDocumentFragment();

    for (let i = 0; i < count; i++) {
      const star = document.createElement('div');
      star.className = 'star';
      const size = Math.random() * 2 + 0.5;
      star.style.width = size + 'px';
      star.style.height = size + 'px';
      star.style.left = Math.random() * 100 + '%';
      star.style.top = Math.random() * 60 + '%';
      star.style.setProperty('--twinkle-duration', (Math.random() * 4 + 2) + 's');
      star.style.setProperty('--twinkle-brightness', (Math.random() * 0.5 + 0.3).toFixed(2));
      star.style.animationDelay = (Math.random() * 5) + 's';
      frag.appendChild(star);
    }

    container.innerHTML = '';
    container.appendChild(frag);
  }

  /* ---- Audio setup ---- */
  function setupAudio() {
    state.audio = new Audio();
    state.audio.preload = 'auto';
    state.audio.crossOrigin = 'anonymous';

    // Restore volume
    const savedVol = utils.storage.get('volume', 75);
    state.audio.volume = savedVol / 100;
    els.volumeSlider.value = savedVol;

    // Try HLS, fallback to native
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }

    if (window.Hls && window.Hls.isSupported()) {
      state.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      });

      state.hls.loadSource(CONFIG.streamUrl);
      state.hls.attachMedia(state.audio);

      state.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        state.isReady = true;
        console.log('[Channel 42] HLS manifest loaded');
      });

      state.hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('[Channel 42] Network error, attempting recover…');
              state.hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('[Channel 42] Media error, attempting recover…');
              state.hls.recoverMediaError();
              break;
            default:
              console.error('[Channel 42] Fatal HLS error, destroying');
              state.hls.destroy();
              state.isReady = false;
              break;
          }
        }
      });
    } else if (state.audio.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari, iOS)
      state.audio.src = CONFIG.streamUrl;
      state.isReady = true;
    } else {
      console.warn('[Channel 42] HLS not supported in this browser');
    }

    // Audio events
    state.audio.addEventListener('playing', onAudioPlaying);
    state.audio.addEventListener('pause', onAudioPaused);
    state.audio.addEventListener('ended', onAudioEnded);
    state.audio.addEventListener('error', onAudioError);
  }

  function setupAudioContext() {
    if (state.audioContext) return;

    try {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 256;
      state.analyser.smoothingTimeConstant = 0.82;
      state.source = state.audioContext.createMediaElementSource(state.audio);
      state.source.connect(state.analyser);
      state.analyser.connect(state.audioContext.destination);
      state.dataArray = new Uint8Array(state.analyser.frequencyBinCount);
    } catch (e) {
      console.warn('[Channel 42] Web Audio API unavailable:', e);
    }
  }

  /* ---- Audio event handlers ---- */
  function onAudioPlaying() {
    state.isPlaying = true;
    els.iconPlay.style.display = 'none';
    els.iconPause.style.display = '';
    els.playBtn.classList.add('playing');
    els.vizWrap.classList.remove('idle');
    setLiveStatus(true, 'On Air');
    startVisualizer();
    startProgressTracking();
  }

  function onAudioPaused() {
    state.isPlaying = false;
    els.iconPlay.style.display = '';
    els.iconPause.style.display = 'none';
    els.playBtn.classList.remove('playing');
    els.vizWrap.classList.add('idle');
    stopVisualizer();
    stopProgressTracking();
  }

  function onAudioEnded() {
    // For live streams this rarely fires, but handle gracefully
    onAudioPaused();
  }

  function onAudioError(e) {
    console.error('[Channel 42] Audio error:', e);
    setLiveStatus(false, 'Stream Error');
    onAudioPaused();
  }

  /* ---- Playback controls ---- */
  function togglePlay() {
    if (!state.audio) return;

    // Audio context must be resumed after user gesture
    if (state.audioContext && state.audioContext.state === 'suspended') {
      state.audioContext.resume();
    }

    // Lazily set up audio context on first interaction
    if (!state.audioContext) {
      setupAudioContext();
    }

    if (state.isPlaying) {
      state.audio.pause();
    } else {
      state.audio.play().catch(err => {
        console.warn('[Channel 42] Play failed:', err);
        showFeedbackError('Could not start playback. Tap again.');
      });
    }
  }

  function seekToFraction(fraction) {
    if (!state.audio || !state.audio.duration || !isFinite(state.audio.duration)) return;
    const t = fraction * state.audio.duration;
    state.audio.currentTime = Math.max(0, Math.min(t, state.audio.duration));
  }

  /* ---- Visualizer ---- */
  function setupVisualizer() {
    const canvas = els.visualizer;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    els.vizWrap.classList.add('idle');
  }

  function startVisualizer() {
    if (state.vizRaf) cancelAnimationFrame(state.vizRaf);

    const canvas = els.visualizer;
    const ctx = canvas.getContext('2d');
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    const barCount = 48;
    const barWidth = width / barCount;
    const barGap = 2;

    function draw() {
      state.vizRaf = requestAnimationFrame(draw);

      ctx.clearRect(0, 0, width, height);

      if (!state.analyser || !state.dataArray) {
        // Fallback: draw gentle sine wave
        drawIdleWave(ctx, width, height);
        return;
      }

      state.analyser.getByteFrequencyData(state.dataArray);

      // Mirror bars from center
      const halfCount = barCount / 2;

      for (let i = 0; i < barCount; i++) {
        const idx = i < halfCount ? i : barCount - 1 - i;
        const dataIdx = Math.floor((idx / halfCount) * (state.dataArray.length * 0.6));
        const value = state.dataArray[dataIdx] || 0;
        const normalized = value / 255;

        const barHeight = Math.max(2, normalized * height * 0.9);
        const x = i * barWidth + barGap / 2;
        const y = (height - barHeight) / 2;

        // Gradient: orange bottom to gold top
        const grad = ctx.createLinearGradient(0, y + barHeight, 0, y);
        grad.addColorStop(0, 'rgba(255, 140, 66, 0.9)');
        grad.addColorStop(0.5, 'rgba(245, 194, 107, 0.8)');
        grad.addColorStop(1, 'rgba(252, 224, 184, 0.5)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        const r = Math.min(barWidth / 2 - barGap / 2, 3);
        roundRect(ctx, x, y, barWidth - barGap, barHeight, r);
        ctx.fill();

        // Glow
        if (normalized > 0.5) {
          ctx.shadowBlur = 12;
          ctx.shadowColor = 'rgba(255, 140, 66, 0.6)';
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }

    draw();
  }

  function drawIdleWave(ctx, width, height) {
    const time = Date.now() / 1000;
    const amplitude = height * 0.08;

    ctx.strokeStyle = 'rgba(255, 140, 66, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let x = 0; x <= width; x += 2) {
      const y = height / 2 +
        Math.sin(x * 0.02 + time * 1.5) * amplitude +
        Math.sin(x * 0.05 + time * 2) * amplitude * 0.3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.stroke();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }

  function stopVisualizer() {
    if (state.vizRaf) {
      cancelAnimationFrame(state.vizRaf);
      state.vizRaf = null;
    }
    // Draw idle wave
    const canvas = els.visualizer;
    const ctx = canvas.getContext('2d');
    const idleDraw = () => {
      if (state.isPlaying) return;
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      drawIdleWave(ctx, canvas.clientWidth, canvas.clientHeight);
      requestAnimationFrame(idleDraw);
    };
    idleDraw();
  }

  /* ---- Progress tracking ---- */
  function startProgressTracking() {
    stopProgressTracking();

    function update() {
      if (!state.audio) return;

      const current = state.audio.currentTime || 0;
      const duration = state.audio.duration || state.trackDuration || 0;
      const pct = duration > 0 ? (current / duration) * 100 : 0;

      els.progressFill.style.width = pct + '%';
      els.progressHandle.style.left = pct + '%';
      els.currentTime.textContent = utils.fmtTime(current);
      els.totalTime.textContent = utils.fmtTime(duration);
      els.progressBar.setAttribute('aria-valuenow', Math.round(pct));
    }

    update();
    state.progressTimer = setInterval(update, 500);
  }

  function stopProgressTracking() {
    if (state.progressTimer) {
      clearInterval(state.progressTimer);
      state.progressTimer = null;
    }
  }

  /* ---- Volume ---- */
  function setVolume(pct) {
    if (state.audio) {
      state.audio.volume = Math.max(0, Math.min(1, pct / 100));
    }
    utils.storage.set('volume', pct);
  }

  /* ---- Now Playing polling ---- */
  async function fetchNowPlaying(retryCount) {
    retryCount = retryCount || 0;

    try {
      const res = await fetch(CONFIG.nowPlayingEndpoint, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (!res.ok) throw new Error('HTTP ' + res.status);

      const data = await res.json();
      updateNowPlaying(data);
    } catch (err) {
      console.warn('[Channel 42] Now-playing fetch failed:', err.message);
      if (retryCount < CONFIG.pollRetries) {
        setTimeout(() => fetchNowPlaying(retryCount + 1), 3000);
      }
    }
  }

  function startPolling() {
    fetchNowPlaying();
    state.pollTimer = setInterval(fetchNowPlaying, CONFIG.pollInterval);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function updateNowPlaying(data) {
    if (!data) return;

    // Check if track changed
    const changed = !state.nowPlaying || state.nowPlaying.trackId !== data.trackId;

    state.nowPlaying = data;
    state.trackDuration = data.duration || 0;

    if (changed) {
      els.trackTitle.classList.add('fade');
      setTimeout(() => {
        els.trackTitle.textContent = data.title || 'Unknown Track';
        els.trackMeta.textContent = formatMeta(data);
        els.trackDesc.textContent = data.description || '';
        els.trackTitle.classList.remove('fade');
      }, 300);

      // Restore last feedback for this track
      const lastFb = utils.storage.get('lastFeedback', null);
      if (lastFb && lastFb.trackId === data.trackId) {
        els.feedbackInput.value = lastFb.text;
      } else {
        els.feedbackInput.value = '';
      }
    }

    // Update listener count
    if (data.listenerCount !== undefined) {
      els.listenerCount.textContent = data.listenerCount;
    }

    // Update up next
    if (data.upNext && data.upNext.length > 0) {
      renderUpNext(data.upNext);
    }

    // Update progress if we have timing info
    if (data.elapsedSeconds !== undefined && data.durationSeconds) {
      const pct = (data.elapsedSeconds / data.durationSeconds) * 100;
      els.progressFill.style.width = pct + '%';
      els.progressHandle.style.left = pct + '%';
      els.currentTime.textContent = utils.fmtTime(data.elapsedSeconds);
      els.totalTime.textContent = utils.fmtTime(data.durationSeconds);
    }
  }

  function formatMeta(data) {
    const parts = [];
    if (data.model) parts.push(data.model);
    if (data.mood) parts.push(data.mood);
    return parts.join(' · ') || '—';
  }

  function renderUpNext(items) {
    state.upNext = items;
    els.upNextList.innerHTML = '';

    items.slice(0, 3).forEach(item => {
      const li = document.createElement('li');
      li.className = 'up-next-item';

      const time = document.createElement('span');
      time.className = 'un-time';
      time.textContent = utils.fmtScheduleTime(item.scheduledAt);

      const info = document.createElement('div');
      info.className = 'un-info';

      const title = document.createElement('span');
      title.className = 'un-title';
      title.textContent = item.title || 'Untitled';

      const meta = document.createElement('span');
      meta.className = 'un-meta';
      meta.textContent = item.model || '—';

      info.appendChild(title);
      info.appendChild(meta);
      li.appendChild(time);
      li.appendChild(info);
      els.upNextList.appendChild(li);
    });
  }

  /* ---- Feedback ---- */
  async function submitFeedback() {
    const text = els.feedbackInput.value.trim();
    if (!text) {
      els.feedbackInput.focus();
      return;
    }

    els.feedbackSubmit.disabled = true;
    els.feedbackStatus.textContent = 'Sending…';
    els.feedbackStatus.className = 'feedback-status';

    const payload = {
      feedback: text,
      track: state.nowPlaying ? state.nowPlaying.title : 'Unknown',
      trackId: state.nowPlaying ? state.nowPlaying.trackId : null,
      timestamp: new Date().toISOString(),
    };

    try {
      const res = await fetch(CONFIG.feedbackEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('HTTP ' + res.status);

      els.feedbackStatus.textContent = '✈ Sent to the fleet. Thank you!';
      els.feedbackStatus.className = 'feedback-status success';

      // Save to local storage
      utils.storage.set('lastFeedback', {
        text,
        trackId: payload.trackId,
        submittedAt: payload.timestamp,
      });

      els.feedbackInput.value = '';

      setTimeout(() => {
        els.feedbackStatus.textContent = '';
        els.feedbackStatus.className = 'feedback-status';
      }, 4000);
    } catch (err) {
      console.error('[Channel 42] Feedback failed:', err);

      // Store locally for retry
      const pending = utils.storage.get('pendingFeedback', []);
      pending.push(payload);
      utils.storage.set('pendingFeedback', pending);

      els.feedbackStatus.textContent = 'Saved offline — will retry.';
      els.feedbackStatus.className = 'feedback-status error';
    } finally {
      els.feedbackSubmit.disabled = false;
    }
  }

  function showFeedbackError(msg) {
    els.feedbackStatus.textContent = msg;
    els.feedbackStatus.className = 'feedback-status error';
  }

  /* ---- Live status ---- */
  function setLiveStatus(isLive, text) {
    if (isLive) {
      els.liveIndicator.classList.add('live');
    } else {
      els.liveIndicator.classList.remove('live');
    }
    els.liveText.textContent = text;
  }

  /* ---- Retry pending feedback ---- */
  async function retryPendingFeedback() {
    const pending = utils.storage.get('pendingFeedback', []);
    if (pending.length === 0) return;

    const stillPending = [];

    for (const item of pending) {
      try {
        const res = await fetch(CONFIG.feedbackEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        });

        if (!res.ok) throw new Error('HTTP ' + res.status);
      } catch {
        stillPending.push(item);
      }
    }

    utils.storage.set('pendingFeedback', stillPending);
  }

  /* ---- Resize handler ---- */
  const handleResize = utils.debounce(() => {
    setupVisualizer();
    createStars();
  }, 200);

  /* ---- Progress bar interaction ---- */
  function handleProgressInteraction(e) {
    if (!state.audio) return;

    const rect = els.progressBar.getBoundingClientRect();
    let fraction;

    if (e.type === 'touchstart' || e.type === 'touchmove') {
      fraction = (e.touches[0].clientX - rect.left) / rect.width;
    } else {
      fraction = (e.clientX - rect.left) / rect.width;
    }

    fraction = Math.max(0, Math.min(1, fraction));
    els.progressFill.style.width = fraction * 100 + '%';
    els.progressHandle.style.left = fraction * 100 + '%';
  }

  let isDraggingProgress = false;

  els.progressBar.addEventListener('mousedown', (e) => {
    isDraggingProgress = true;
    handleProgressInteraction(e);
  });

  document.addEventListener('mousemove', (e) => {
    if (isDraggingProgress) handleProgressInteraction(e);
  });

  document.addEventListener('mouseup', (e) => {
    if (isDraggingProgress) {
      isDraggingProgress = false;
      const rect = els.progressBar.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seekToFraction(fraction);
    }
  });

  els.progressBar.addEventListener('touchstart', (e) => {
    isDraggingProgress = true;
    handleProgressInteraction(e);
  }, { passive: true });

  els.progressBar.addEventListener('touchmove', (e) => {
    if (isDraggingProgress) handleProgressInteraction(e);
  }, { passive: true });

  els.progressBar.addEventListener('touchend', () => {
    if (isDraggingProgress) {
      isDraggingProgress = false;
    }
  });

  // Keyboard support on progress bar
  els.progressBar.addEventListener('keydown', (e) => {
    if (!state.audio || !state.audio.duration) return;
    const step = state.audio.duration * 0.05;

    if (e.key === 'ArrowLeft') {
      state.audio.currentTime = Math.max(0, state.audio.currentTime - step);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      state.audio.currentTime = Math.min(state.audio.duration, state.audio.currentTime + step);
      e.preventDefault();
    }
  });

  /* ---- Media Session API ---- */
  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => togglePlay());
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      // Notify scheduler of skip request
      console.log('[Channel 42] Previous track requested');
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      console.log('[Channel 42] Next track requested');
    });

    updateMediaSessionMetadata();
  }

  function updateMediaSessionMetadata() {
    if (!('mediaSession' in navigator) || !state.nowPlaying) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: state.nowPlaying.title || 'Channel 42',
      artist: state.nowPlaying.model || 'LucidDreamer.AI',
      album: 'Channel 42 Dawn',
      artwork: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
  }

  /* ---- Event listeners ---- */
  els.playBtn.addEventListener('click', togglePlay);

  els.volumeSlider.addEventListener('input', (e) => {
    setVolume(parseInt(e.target.value, 10));
  });

  els.feedbackSubmit.addEventListener('click', submitFeedback);

  els.feedbackInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitFeedback();
    }
  });

  els.prevBtn.addEventListener('click', () => {
    console.log('[Channel 42] Previous track requested');
  });

  els.nextBtn.addEventListener('click', () => {
    console.log('[Channel 42] Next track requested');
  });

  window.addEventListener('resize', handleResize);

  // Visibility — pause polling when tab hidden, resume when visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      startPolling();
    }
  });

  // Page unload cleanup
  window.addEventListener('beforeunload', () => {
    stopPolling();
    stopVisualizer();
    stopProgressTracking();
    if (state.hls) state.hls.destroy();
    if (state.audioContext) state.audioContext.close();
  });

  /* ---- Init ---- */
  function init() {
    console.log('[Channel 42] Initializing player…');

    createStars();
    setupVisualizer();
    setupAudio();
    setupMediaSession();
    startPolling();
    retryPendingFeedback();

    // Draw idle visualizer
    stopVisualizer();

    // Set initial live status
    setLiveStatus(false, 'Connecting…');

    console.log('[Channel 42] Ready. Tap play to begin.');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
