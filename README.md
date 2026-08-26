# Master Beater

BPM detector, beat editor, and beat-overlay video renderer.

Load an MP3 or WAV, auto-detect beats and BPM, hand-edit the beat grid on the waveform, watch a beat indicator flash in time (with optional metronome), and render an MP4 the full length of the song with a `Beat: N   Measure: M   Frame: F` overlay drawn on the frame each beat lands on.

## Features

- **In-browser BPM & beat detection** — energy-based onset detection on a low-passed copy of the audio.
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

## Configuration

- `PORT` env var — server port (default 8461)
- `FFMPEG` env var — path to `ffmpeg` binary (default: `ffmpeg` on `PATH`)
