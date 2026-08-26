// Master Beater — client
(() => {
  const $ = (id) => document.getElementById(id);
  const fileInput = $('fileInput'), fileLabel = $('fileLabel');
  const statsSection = $('statsSection'), indicatorRow = $('indicatorRow');
  const waveformWrap = $('waveformWrap'), actionsSection = $('actionsSection');
  const logSection = $('logSection'), logEl = $('log');
  const bpmInput = $('bpmInput'), beatCountEl = $('beatCount'), durationEl = $('duration');
  const timeSigSel = $('timeSig'), beatOneIdxInp = $('beatOneIdx');
  const fpsSel = $('fps'), resSel = $('resolution');
  const indicator = $('indicator'), indicatorNum = $('indicatorNum');
  const playBtn = $('playBtn'), stopBtn = $('stopBtn');
  const metronomeChk = $('metronome'), showRawPeaksChk = $('showRawPeaks');
  const tCurEl = $('tCur'), tTotEl = $('tTot');
  const canvas = $('waveform'), ctx = canvas.getContext('2d');
  const wfScroll = $('wfScroll');
  const zoomIn = $('zoomIn'), zoomOut = $('zoomOut'), zoomFit = $('zoomFit'), zoomLabel = $('zoomLabel');
  const detectBtn = $('detectBtn'), clearBtn = $('clearBtn'), regridBtn = $('regridBtn');
  const chooseFolderBtn = $('chooseFolderBtn'), folderLabel = $('folderLabel');
  const renderBtn = $('renderBtn');
  const outNameInp = $('outNameInp');
  const halfBpm = $('halfBpm'), doubleBpm = $('doubleBpm');
  const prevOne = $('prevOne'), nextOne = $('nextOne');

  const state = {
    audioBuffer: null, audioBlob: null, audioName: '',
    beats: [], rawPeaks: [], bpm: 120,
    timeSig: 4, beatOneIdx: 0,
    folderHandle: null,
    selectedBeat: -1, dragging: false, dragStartX: 0, dragMoved: false,
    playCtx: null, source: null, gainNode: null, startCtxTime: 0, startOffset: 0,
    playing: false, rafId: 0, lastPulsedIdx: -1, scheduledClicks: [],
    zoom: 1, wfCache: null,
  };
  const RULER_H = 20;

  const log = (msg, cls = '') => {
    logSection.hidden = false;
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  };

  // ---------- File load ----------
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileLabel.textContent = file.name;
    state.audioBlob = file;
    state.audioName = file.name.replace(/\.[^.]+$/, '');
    log(`Loading ${file.name} (${(file.size/1024/1024).toFixed(1)} MB)…`);
    try {
      const arrBuf = await file.arrayBuffer();
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const buf = await ac.decodeAudioData(arrBuf);
      state.audioBuffer = buf;
      log(`Decoded: ${buf.numberOfChannels}ch, ${buf.sampleRate}Hz, ${buf.duration.toFixed(2)}s`, 'ok');
      durationEl.textContent = buf.duration.toFixed(2) + ' s';
      tTotEl.textContent = buf.duration.toFixed(2);
      statsSection.hidden = false;
      indicatorRow.hidden = false;
      waveformWrap.hidden = false;
      actionsSection.hidden = false;
      playBtn.disabled = false;
      stopBtn.disabled = false;
      renderBtn.disabled = false;
      if (!outNameInp.value) outNameInp.value = state.audioName || 'beats';
      state.zoom = 1;
      wfScroll.scrollLeft = 0;
      buildWaveformCache();
      await detectBeats();
    } catch (err) {
      log('Decode failed: ' + err.message, 'err');
    }
  });

  // ---------- Beat detection ----------
  async function detectBeats() {
    if (!state.audioBuffer) return;
    log('Detecting beats…');
    const buf = state.audioBuffer;
    const offline = new OfflineAudioContext(1, buf.length, buf.sampleRate);
    const src = offline.createBufferSource();
    src.buffer = buf;
    const lp = offline.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 150; lp.Q.value = 1;
    const hp = offline.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 40; hp.Q.value = 1;
    src.connect(lp); lp.connect(hp); hp.connect(offline.destination);
    src.start();
    const filtered = await offline.startRendering();
    const data = filtered.getChannelData(0);
    const sr = filtered.sampleRate;

    // Peak amplitude
    let peakAmp = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peakAmp) peakAmp = v;
    }
    const threshold = peakAmp * 0.55;
    const minGap = Math.floor(sr * 0.22); // 220 ms
    const peaks = [];
    let lastPeakSample = -minGap;
    let lastVal = 0, rising = false;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > threshold) {
        if (v > lastVal) { rising = true; }
        else if (rising && i - lastPeakSample > minGap) {
          peaks.push((i - 1) / sr);
          lastPeakSample = i;
          rising = false;
        }
      } else {
        rising = false;
      }
      lastVal = v;
    }
    state.rawPeaks = peaks;

    // BPM from intervals (histogram)
    const intervals = [];
    for (let i = 1; i < peaks.length; i++) intervals.push(peaks[i] - peaks[i-1]);
    const bpmCounts = new Map();
    for (const iv of intervals) {
      if (iv <= 0) continue;
      let bpm = 60 / iv;
      while (bpm < 70) bpm *= 2;
      while (bpm > 180) bpm /= 2;
      const k = Math.round(bpm * 2) / 2;
      bpmCounts.set(k, (bpmCounts.get(k) || 0) + 1);
    }
    let best = 120, bestCount = 0;
    for (const [k, c] of bpmCounts) if (c > bestCount) { bestCount = c; best = k; }
    state.bpm = best;
    bpmInput.value = best;

    // Use detected peaks directly as beats (user can snap-to-grid later)
    state.beats = peaks.slice();
    state.beatOneIdx = 0;
    beatOneIdxInp.value = 0;
    beatCountEl.textContent = state.beats.length;
    log(`BPM ≈ ${best}  ·  ${peaks.length} peaks detected`, 'ok');
    drawWaveform();
  }

  detectBtn.addEventListener('click', detectBeats);
  clearBtn.addEventListener('click', () => {
    state.beats = [];
    state.selectedBeat = -1;
    beatCountEl.textContent = 0;
    drawWaveform();
  });

  regridBtn.addEventListener('click', () => {
    if (!state.audioBuffer) return;
    const bpm = parseFloat(bpmInput.value);
    if (!bpm || bpm <= 0) return;
    const spacing = 60 / bpm;
    // Anchor on the current Beat 1 position (or first beat, or 0)
    let anchor = 0;
    if (state.beats.length) {
      const idx = Math.min(state.beatOneIdx, state.beats.length - 1);
      anchor = state.beats[idx];
      // shift anchor to fall on the grid closest to it
      const preRoll = anchor - Math.floor(anchor / spacing) * spacing;
      anchor = preRoll;
    }
    const grid = [];
    for (let t = anchor; t < state.audioBuffer.duration; t += spacing) {
      if (t >= 0) grid.push(t);
    }
    state.beats = grid;
    state.beatOneIdx = 0;
    beatOneIdxInp.value = 0;
    beatCountEl.textContent = grid.length;
    log(`Grid: ${grid.length} beats at ${bpm} BPM`, 'ok');
    drawWaveform();
  });

  bpmInput.addEventListener('change', () => { state.bpm = parseFloat(bpmInput.value); });
  halfBpm.addEventListener('click', () => {
    state.bpm = Math.max(20, state.bpm / 2);
    bpmInput.value = state.bpm;
  });
  doubleBpm.addEventListener('click', () => {
    state.bpm = Math.min(400, state.bpm * 2);
    bpmInput.value = state.bpm;
  });
  timeSigSel.addEventListener('change', () => { state.timeSig = parseInt(timeSigSel.value, 10); drawWaveform(); });
  beatOneIdxInp.addEventListener('change', () => {
    state.beatOneIdx = Math.max(0, Math.min(state.beats.length - 1, parseInt(beatOneIdxInp.value, 10) || 0));
    beatOneIdxInp.value = state.beatOneIdx;
    drawWaveform();
  });
  prevOne.addEventListener('click', () => { beatOneIdxInp.value = Math.max(0, (parseInt(beatOneIdxInp.value,10)||0) - 1); beatOneIdxInp.dispatchEvent(new Event('change')); });
  nextOne.addEventListener('click', () => { beatOneIdxInp.value = (parseInt(beatOneIdxInp.value,10)||0) + 1; beatOneIdxInp.dispatchEvent(new Event('change')); });

  // ---------- Waveform (with zoom + scroll) ----------
  function maxZoom() {
    const dpr = window.devicePixelRatio || 1;
    return Math.max(1, Math.floor(16000 / Math.max(300, wfScroll.clientWidth * dpr)));
  }
  function fmtTime(t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    if (t < 10) return t.toFixed(2) + 's';
    if (t < 60) return s + 's';
    return m + ':' + String(s).padStart(2, '0');
  }
  function pickTickSec(pxPerSec) {
    const targets = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    for (const t of targets) if (pxPerSec * t >= 70) return t;
    return 120;
  }

  function buildWaveformCache() {
    if (!state.audioBuffer) return;
    const dpr = window.devicePixelRatio || 1;
    const baseW = Math.max(300, wfScroll.clientWidth);
    const cssW = Math.round(baseW * state.zoom);
    const cssH = 240;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cache = document.createElement('canvas');
    cache.width = canvas.width;
    cache.height = canvas.height;
    const c = cache.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    c.fillStyle = '#171b22';
    c.fillRect(0, 0, cssW, cssH);

    // Ruler
    c.fillStyle = '#1f242d';
    c.fillRect(0, 0, cssW, RULER_H);
    const dur = state.audioBuffer.duration;
    const pxPerSec = cssW / dur;
    const tickSec = pickTickSec(pxPerSec);
    c.strokeStyle = '#3a4658';
    c.fillStyle = '#8b95a5';
    c.font = '10px "Segoe UI", sans-serif';
    for (let t = 0; t <= dur + 0.0001; t += tickSec) {
      const x = t * pxPerSec;
      c.beginPath(); c.moveTo(x + 0.5, RULER_H - 7); c.lineTo(x + 0.5, RULER_H); c.stroke();
      c.fillText(fmtTime(t), x + 3, RULER_H - 7);
    }
    // Subdivision ticks
    const subTick = tickSec / 5;
    if (subTick * pxPerSec >= 8) {
      c.strokeStyle = '#2a3140';
      for (let t = 0; t <= dur; t += subTick) {
        const x = t * pxPerSec;
        c.beginPath(); c.moveTo(x + 0.5, RULER_H - 3); c.lineTo(x + 0.5, RULER_H); c.stroke();
      }
    }
    // Baseline separator
    c.strokeStyle = '#2a3140';
    c.beginPath(); c.moveTo(0, RULER_H + 0.5); c.lineTo(cssW, RULER_H + 0.5); c.stroke();

    // Waveform
    const data = state.audioBuffer.getChannelData(0);
    const wfTop = RULER_H;
    const wfH = cssH - RULER_H;
    const mid = wfTop + wfH / 2;
    const amp = (wfH / 2) * 0.92;
    const step = Math.max(1, Math.floor(data.length / cssW));
    c.strokeStyle = '#4a5566';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x < cssW; x++) {
      let mn = 1, mx = -1;
      const start = x * step;
      const end = Math.min(start + step, data.length);
      for (let i = start; i < end; i++) {
        const v = data[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      c.moveTo(x + 0.5, mid + mn * amp);
      c.lineTo(x + 0.5, mid + mx * amp);
    }
    c.stroke();

    state.wfCache = cache;
    zoomLabel.textContent = state.zoom.toFixed(2) + '×';
    drawFrame();
  }

  function drawFrame(playheadT = null) {
    if (!state.audioBuffer || !state.wfCache) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.drawImage(state.wfCache, 0, 0, cssW, cssH);

    const dur = state.audioBuffer.duration;
    const pxPerSec = cssW / dur;

    // Raw peaks
    if (showRawPeaksChk.checked && state.rawPeaks.length) {
      ctx.fillStyle = '#3a4658';
      for (const t of state.rawPeaks) {
        const x = t * pxPerSec;
        ctx.fillRect(x - 0.5, cssH - 8, 1.5, 6);
      }
    }

    // Beats
    const beatOne = state.beatOneIdx;
    const sig = state.timeSig;
    for (let i = 0; i < state.beats.length; i++) {
      const t = state.beats[i];
      const x = t * pxPerSec;
      const bim = ((i - beatOne) % sig + sig) % sig + 1;
      const isDown = bim === 1;
      ctx.strokeStyle = isDown ? '#4fc3f7' : '#ff7a45';
      ctx.lineWidth = isDown ? 2 : 1;
      if (i === state.selectedBeat) { ctx.strokeStyle = '#ffca4b'; ctx.lineWidth = 3; }
      ctx.beginPath();
      ctx.moveTo(x + 0.5, RULER_H);
      ctx.lineTo(x + 0.5, cssH);
      ctx.stroke();
      // Labels — measure number on downbeats, beat-in-measure number when zoomed enough
      if (isDown) {
        const meas = Math.floor((i - beatOne) / sig) + 1;
        ctx.fillStyle = '#4fc3f7';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('m' + meas, x + 3, RULER_H + 12);
      }
      if (pxPerSec > 40) {
        ctx.fillStyle = isDown ? '#4fc3f7' : '#ff7a45';
        ctx.font = '10px sans-serif';
        ctx.fillText(String(bim), x + 3, cssH - 4);
      }
    }

    // Playhead
    if (playheadT != null) {
      const x = playheadT * pxPerSec;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, cssH);
      ctx.stroke();
    }
  }

  // Compat wrapper — old callsites still use drawWaveform
  const drawWaveform = drawFrame;

  window.addEventListener('resize', () => { buildWaveformCache(); });

  // Zoom controls
  function setZoom(newZoom, anchorClientX = null) {
    const cap = maxZoom();
    newZoom = Math.max(1, Math.min(cap, newZoom));
    if (newZoom === state.zoom) return;
    // Preserve the time under an anchor pixel (defaults to viewport center)
    const scrollRect = wfScroll.getBoundingClientRect();
    const screenX = (anchorClientX ?? scrollRect.left + scrollRect.width / 2) - scrollRect.left;
    const beforeCanvasX = wfScroll.scrollLeft + screenX;
    const beforeCssW = canvas.getBoundingClientRect().width;
    const anchorT = state.audioBuffer ? (beforeCanvasX / beforeCssW) * state.audioBuffer.duration : 0;

    state.zoom = newZoom;
    buildWaveformCache();

    const afterCssW = canvas.getBoundingClientRect().width;
    const afterCanvasX = state.audioBuffer ? (anchorT / state.audioBuffer.duration) * afterCssW : 0;
    wfScroll.scrollLeft = afterCanvasX - screenX;
  }
  zoomIn.addEventListener('click', () => setZoom(state.zoom * 1.5));
  zoomOut.addEventListener('click', () => setZoom(state.zoom / 1.5));
  zoomFit.addEventListener('click', () => { setZoom(1); wfScroll.scrollLeft = 0; });

  wfScroll.addEventListener('wheel', (e) => {
    if (!state.audioBuffer) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    setZoom(state.zoom * factor, e.clientX);
  }, { passive: false });

  // ---------- Canvas interaction ----------
  const pxToTime = (x) => {
    const rect = canvas.getBoundingClientRect();
    return (x / rect.width) * state.audioBuffer.duration;
  };
  const timeToPx = (t) => {
    const rect = canvas.getBoundingClientRect();
    return (t / state.audioBuffer.duration) * rect.width;
  };
  const findBeatNearX = (x) => {
    let best = -1, bestDist = 8;
    for (let i = 0; i < state.beats.length; i++) {
      const d = Math.abs(timeToPx(state.beats[i]) - x);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  };

  canvas.addEventListener('mousedown', (e) => {
    if (!state.audioBuffer) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = findBeatNearX(x);
    state.dragMoved = false;
    if (idx >= 0) {
      state.selectedBeat = idx;
      state.dragging = true;
      state.dragStartX = x;
    } else {
      state.selectedBeat = -1;
    }
    drawWaveform();
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!state.dragging || state.selectedBeat < 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (Math.abs(x - state.dragStartX) > 2) state.dragMoved = true;
    state.beats[state.selectedBeat] = Math.max(0, Math.min(state.audioBuffer.duration, pxToTime(x)));
    drawWaveform();
  });
  canvas.addEventListener('mouseup', (e) => {
    if (!state.audioBuffer) return;
    if (state.dragging && !state.dragMoved) {
      // Simple click on existing beat — no-op, keep selection
    } else if (!state.dragging) {
      // Click on empty area — add a beat
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const t = pxToTime(x);
      state.beats.push(t);
      state.beats.sort((a, b) => a - b);
      state.selectedBeat = state.beats.indexOf(t);
    } else {
      // Was dragging — re-sort
      state.beats.sort((a, b) => a - b);
      state.selectedBeat = state.beats.indexOf(state.beats[state.selectedBeat]);
    }
    state.dragging = false;
    beatCountEl.textContent = state.beats.length;
    drawWaveform();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedBeat >= 0) {
        state.beats.splice(state.selectedBeat, 1);
        state.selectedBeat = -1;
        beatCountEl.textContent = state.beats.length;
        drawWaveform();
        e.preventDefault();
      }
    } else if (e.key === ' ') {
      if (state.playing) stopPlayback(); else startPlayback();
      e.preventDefault();
    }
  });

  // ---------- Playback + indicator + metronome ----------
  function startPlayback() {
    if (!state.audioBuffer || state.playing) return;
    state.playCtx = new (window.AudioContext || window.webkitAudioContext)();
    state.source = state.playCtx.createBufferSource();
    state.source.buffer = state.audioBuffer;
    state.gainNode = state.playCtx.createGain();
    state.source.connect(state.gainNode);
    state.gainNode.connect(state.playCtx.destination);
    state.startCtxTime = state.playCtx.currentTime;
    state.startOffset = 0;
    state.source.start(0, 0);
    state.playing = true;
    state.lastPulsedIdx = -1;
    scheduleMetronome();
    tick();
    playBtn.textContent = '⏸ Pause';
  }
  function stopPlayback() {
    if (!state.playing) return;
    try { state.source.stop(); } catch {}
    try { state.playCtx.close(); } catch {}
    state.playing = false;
    cancelAnimationFrame(state.rafId);
    indicator.classList.remove('pulse', 'downbeat');
    indicatorNum.textContent = '–';
    playBtn.textContent = '▶ Play';
    drawWaveform();
  }
  playBtn.addEventListener('click', () => state.playing ? stopPlayback() : startPlayback());
  stopBtn.addEventListener('click', stopPlayback);
  metronomeChk.addEventListener('change', () => { if (state.playing) scheduleMetronome(); });
  showRawPeaksChk.addEventListener('change', () => drawFrame());

  function scheduleMetronome() {
    if (!state.playCtx) return;
    // Cancel previously scheduled clicks by disposing their oscillators isn't strictly necessary;
    // just don't schedule if metronome is off.
    if (!metronomeChk.checked) return;
    const now = state.playCtx.currentTime;
    for (let i = 0; i < state.beats.length; i++) {
      const beatT = state.beats[i];
      const when = state.startCtxTime + beatT;
      if (when < now) continue;
      const bim = ((i - state.beatOneIdx) % state.timeSig + state.timeSig) % state.timeSig + 1;
      scheduleClick(when, bim === 1 ? 1500 : 900);
    }
  }
  function scheduleClick(when, freq) {
    const osc = state.playCtx.createOscillator();
    const g = state.playCtx.createGain();
    osc.frequency.value = freq;
    osc.connect(g); g.connect(state.playCtx.destination);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.3, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  function tick() {
    if (!state.playing) return;
    const t = state.playCtx.currentTime - state.startCtxTime;
    if (t >= state.audioBuffer.duration) { stopPlayback(); return; }
    tCurEl.textContent = t.toFixed(2);
    // Find current beat index
    let idx = -1;
    for (let i = 0; i < state.beats.length; i++) {
      if (t >= state.beats[i] - 0.02 && t < state.beats[i] + 0.12) { idx = i; break; }
    }
    if (idx >= 0 && idx !== state.lastPulsedIdx) {
      state.lastPulsedIdx = idx;
      const bim = ((idx - state.beatOneIdx) % state.timeSig + state.timeSig) % state.timeSig + 1;
      pulseIndicator(bim === 1, bim);
    }
    drawFrame(t);
    if (state.zoom > 1) {
      const cssW = canvas.getBoundingClientRect().width;
      const playX = (t / state.audioBuffer.duration) * cssW;
      const view = wfScroll.scrollLeft;
      const w = wfScroll.clientWidth;
      if (playX < view + w * 0.1 || playX > view + w * 0.85) {
        wfScroll.scrollLeft = playX - w * 0.4;
      }
    }
    state.rafId = requestAnimationFrame(tick);
  }
  function pulseIndicator(down, num) {
    indicator.classList.remove('pulse', 'downbeat');
    // reflow to restart animation
    void indicator.offsetWidth;
    indicator.classList.add('pulse');
    if (down) indicator.classList.add('downbeat');
    indicatorNum.textContent = num;
    setTimeout(() => indicator.classList.remove('pulse', 'downbeat'), 120);
  }

  // ---------- Folder + render + save ----------
  chooseFolderBtn.addEventListener('click', async () => {
    if (!window.showDirectoryPicker) {
      log('Folder picker not available here — files will save to the browser Downloads folder.', 'err');
      state.folderHandle = null;
      folderLabel.textContent = 'Downloads (default)';
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      state.folderHandle = handle;
      folderLabel.textContent = handle.name + '/';
      log(`Output folder: ${handle.name}/`, 'ok');
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (err.name === 'SecurityError' || /iframe|embed/i.test(err.message)) {
        log('Folder picker blocked in this window. Falling back to browser Downloads.', 'err');
      } else {
        log('Folder pick failed: ' + err.message + ' — falling back to Downloads.', 'err');
      }
      state.folderHandle = null;
      folderLabel.textContent = 'Downloads (default)';
    }
  });

  function buildBeatsMeta() {
    const fps = parseInt(fpsSel.value, 10);
    const [w, h] = resSel.value.split('x').map(Number);
    const sig = state.timeSig;
    const beats = state.beats.map((t, i) => {
      const rel = i - state.beatOneIdx;
      const beatInMeasure = ((rel % sig) + sig) % sig + 1;
      const measure = Math.floor(rel / sig) + 1;
      const frame = Math.round(t * fps);
      return { index: i, time: +t.toFixed(4), frame, beatInMeasure, measure };
    });
    return { beats, fps, width: w, height: h, sig };
  }

  function beatsToSrt(beats) {
    const fmt = (t) => {
      const h = Math.floor(t / 3600);
      const m = Math.floor((t % 3600) / 60);
      const s = Math.floor(t % 60);
      const ms = Math.round((t - Math.floor(t)) * 1000);
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
    };
    return beats.map((b, i) => {
      const start = b.time, end = Math.min(b.time + 0.25, start + 0.25);
      return `${i+1}\n${fmt(start)} --> ${fmt(end)}\nBeat: ${b.beatInMeasure}  Measure: ${b.measure}  Frame: ${b.frame}\n`;
    }).join('\n');
  }

  async function saveOne(name, blobOrText, mime) {
    const blob = blobOrText instanceof Blob
      ? blobOrText
      : new Blob([blobOrText], { type: mime || 'text/plain' });
    if (state.folderHandle) {
      const fh = await state.folderHandle.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }

  renderBtn.addEventListener('click', async () => {
    if (!state.audioBuffer || !state.audioBlob) {
      log('Load an audio file first.', 'err');
      return;
    }
    const rawName = (outNameInp.value || state.audioName || 'beats').trim();
    const safe = rawName.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_') || 'beats';
    outNameInp.value = safe;
    const dest = state.folderHandle ? state.folderHandle.name + '/' : 'Downloads/';
    renderBtn.disabled = true;
    renderBtn.classList.add('busy');
    renderBtn.textContent = 'Rendering…';
    detectBtn.disabled = true;
    chooseFolderBtn.disabled = true;
    const meta = buildBeatsMeta();
    log(`Rendering ${meta.beats.length} beats at ${meta.fps}fps ${meta.width}×${meta.height} → ${dest}${safe}.mp4 …`);
    try {
      const fd = new FormData();
      fd.append('audio', state.audioBlob, state.audioBlob.name);
      fd.append('beats', JSON.stringify(meta.beats));
      fd.append('fps', String(meta.fps));
      fd.append('width', String(meta.width));
      fd.append('height', String(meta.height));
      fd.append('duration', String(state.audioBuffer.duration));

      const res = await fetch('/render', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'render failed' }));
        throw new Error(err.error + (err.stderr ? '\n' + err.stderr : ''));
      }
      const mp4Blob = await res.blob();
      const base = safe;
      await saveOne(`${base}.mp4`, mp4Blob);
      await saveOne(`${base}.beats.json`, JSON.stringify({
        source: state.audioBlob.name,
        duration: state.audioBuffer.duration,
        bpm: state.bpm,
        timeSignature: `${state.timeSig}/4`,
        fps: meta.fps,
        resolution: `${meta.width}x${meta.height}`,
        beats: meta.beats
      }, null, 2), 'application/json');
      await saveOne(`${base}.beats.srt`, beatsToSrt(meta.beats), 'application/x-subrip');
      log(`Saved ${base}.mp4, ${base}.beats.json, ${base}.beats.srt to ${dest}`, 'ok');
    } catch (err) {
      log('Render error: ' + err.message, 'err');
    } finally {
      renderBtn.disabled = false;
      renderBtn.classList.remove('busy');
      renderBtn.textContent = 'Render MP4';
      detectBtn.disabled = false;
      chooseFolderBtn.disabled = false;
    }
  });
})();
