# Master Beater

BPM detector, beat editor, and beat-overlay video renderer.

Load an MP3 or WAV, auto-detect beats and BPM, hand-edit the beat grid on the waveform, watch a beat indicator flash in time (with optional metronome), and render an MP4 the full length of the song with a `Beat: N   Measure: M   Frame: F` overlay drawn on the frame each beat lands on.

## Features

- **In-browser BPM & beat detection** — energy-based onset detection on a low-passed copy of the audio.
- **Rubberband Tempo Lab** — pitch-preserving time-stretch to conform a track from one BPM to another (e.g. 119 → 120). Runs ffmpeg's `rubberband` filter server-side, saves `<name>_<toBPM>bpm.wav`, and can load the result straight back in for beat detection and rendering.
- **Editable beat grid on the waveform** — click empty area to add, click a beat to select, drag to move, Delete to remove.
- **Snap-to-BPM grid** button — replace irregular detected beats with a regular grid at the current BPM.
- **Beat-1 offset + time signature** (4/4, 3/4, 6/8, 5/4, 7/8, 2/4) — controls how beats cycle inside each measure.
- **Live indicator** flashes on every beat (blue on downbeats, orange on other beats) with the beat-in-measure number.
- **Metronome click** — audible click during playback; downbeats are higher-pitched.
- **FPS dropdown**: 12 / 24 / 30 / 60.
- **Resolution dropdown**: 640×360 / 1280×720 / 1920×1080.
- **Native folder picker** (File System Access API — Chrome/Edge) writes MP4 + JSON + SRT directly to a folder you choose.
- **SRT output** doubles as a marker file — drag onto a DaVinci Resolve timeline to get one marker per beat.

## Requirements

- Node.js 18+
- FFmpeg on `PATH` (or set `FFMPEG=C:\ffmpeg\bin\ffmpeg.exe`)
- FFmpeg built with `--enable-librubberband` for the Tempo Lab (the app checks at startup and disables that panel if the filter is missing)
- Chrome or Edge for the folder picker (Firefox works for everything except direct-to-folder saving)

## Run

```bash
npm install
npm start
```

Then open `http://localhost:8461`.

## Files it writes

For an input `mysong.mp3` it produces in the folder you pick:

- `mysong.mp4` — black video at your chosen FPS/resolution, the song as audio, and one text overlay per beat frame
- `mysong.beats.json` — every beat with `time`, `frame`, `beatInMeasure`, `measure`
- `mysong.beats.srt` — same info as subtitle cues; drop onto a Resolve timeline as markers

## Overlay format

Each beat frame shows:

```
Beat: <1-N>   Measure: <M>   Frame: <F>
```

Where `1-N` cycles through the time signature and `M` counts up from 1.

## Rubberband Tempo Lab

Load a track, set **From BPM** (auto-filled from detection) and **To BPM**, and hit
**Conform Tempo → WAV**. The server runs:

```
ffmpeg -i in -af "aresample=48000:resampler=soxr:precision=28,rubberband=tempo=<to/from>:pitch=1" -c:a pcm_s16le out.wav
```

Pitch is preserved. Output defaults to 48 kHz — `rubberband` drifts a few tens of
milliseconds at 44.1 kHz, and resampling to 48 kHz first makes the stretch
sample-exact (and keeps multiple stems phase-locked when conformed with the same
ratio). "Match source" skips the resample if you need the original rate.

With **Load result back in** checked, the conformed audio replaces the loaded
track so you can immediately re-detect and render against the new tempo.

## Configuration

- `PORT` env var — server port (default 8461)
- `FFMPEG` env var — path to `ffmpeg` binary (default: `ffmpeg` on `PATH`)
