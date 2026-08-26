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
  const detectBtn = $('detectBtn'), clearBtn = $('clearBtn'), regridBtn = $('regridBtn');
  const chooseFolderBtn = $('chooseFolderBtn'), folderLabel = $('folderLabel');
  const renderBtn = $('renderBtn');
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
  };

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
      renderBtn.disabled = !state.folderHandle;
      drawWaveform();
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

  // ---------- Waveform ----------
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', () => { resizeCanvas(); drawWaveform(); });

  function drawWaveform(playheadT = null) {
    resizeCanvas();
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#171b22';
    ctx.fillRect(0, 0, w, h);
    if (!state.audioBuffer) return;
    const buf = state.audioBuffer;
    const data = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    const mid = h / 2;
    ctx.strokeStyle = '#4a5566';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      const start = x * step;
      const end = Math.min(start + step, data.length);
      for (let i = start; i < end; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      ctx.moveTo(x + 0.5, mid + min * mid * 0.9);
      ctx.lineTo(x + 0.5, mid + max * mid * 0.9);
    }
    ctx.stroke();

    // Raw peaks (small marks)
    if (showRawPeaksChk.checked && state.rawPeaks.length) {
      ctx.fillStyle = '#3a4658';
      for (const t of state.rawPeaks) {
        const x = (t / buf.duration) * w;
        ctx.fillRect(x - 0.5, h - 8, 1.5, 6);
      }
    }

    // Beats (grid marks)
    const beatOne = state.beatOneIdx;
    const sig = state.timeSig;
    for (let i = 0; i < state.beats.length; i++) {
      const t = state.beats[i];
      const x = (t / buf.duration) * w;
      const beatInMeasure = ((i - beatOne) % sig + sig) % sig + 1;
      const isDownbeat = beatInMeasure === 1;
      ctx.strokeStyle = isDownbeat ? '#4fc3f7' : '#ff7a45';
      ctx.lineWidth = isDownbeat ? 2 : 1;
      if (i === state.selectedBeat) { ctx.strokeStyle = '#ffca4b'; ctx.lineWidth = 3; }
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
      if (isDownbeat) {
        ctx.fillStyle = '#4fc3f7';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(String(Math.floor((i - beatOne) / sig) + 1), x + 3, 12);
      }
    }

    // Playhead
    if (playheadT != null) {
      const x = (playheadT / buf.duration) * w;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
  }

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
  showRawPeaksChk.addEventListener('change', drawWaveform);

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
    drawWaveform(t);
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
      log('This browser lacks the File System Access API. Use Chrome or Edge.', 'err');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      state.folderHandle = handle;
      folderLabel.textContent = handle.name + '/';
      renderBtn.disabled = !state.audioBuffer;
      log(`Output folder: ${handle.name}/`, 'ok');
    } catch (err) {
      if (err.name !== 'AbortError') log('Folder pick failed: ' + err.message, 'err');
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

  async function writeFileToFolder(name, blobOrText) {
    const fh = await state.folderHandle.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    if (blobOrText instanceof Blob) await w.write(blobOrText);
    else await w.write(new Blob([blobOrText], { type: 'text/plain' }));
    await w.close();
  }

  renderBtn.addEventListener('click', async () => {
    if (!state.audioBuffer || !state.audioBlob || !state.folderHandle) return;
    renderBtn.disabled = true;
    detectBtn.disabled = true;
    const meta = buildBeatsMeta();
    log(`Rendering ${meta.beats.length} beats at ${meta.fps}fps ${meta.width}×${meta.height}…`);
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
      const base = state.audioName || 'beats';
      await writeFileToFolder(`${base}.mp4`, mp4Blob);
      await writeFileToFolder(`${base}.beats.json`, JSON.stringify({
        source: state.audioBlob.name,
        duration: state.audioBuffer.duration,
        bpm: state.bpm,
        timeSignature: `${state.timeSig}/4`,
        fps: meta.fps,
        resolution: `${meta.width}x${meta.height}`,
        beats: meta.beats
      }, null, 2));
      await writeFileToFolder(`${base}.beats.srt`, beatsToSrt(meta.beats));
      log(`Saved ${base}.mp4, ${base}.beats.json, ${base}.beats.srt to ${state.folderHandle.name}/`, 'ok');
    } catch (err) {
      log('Render error: ' + err.message, 'err');
    } finally {
      renderBtn.disabled = false;
      detectBtn.disabled = false;
    }
  });
})();
