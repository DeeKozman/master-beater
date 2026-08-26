const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = 8461;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(os.tmpdir(), 'master-beater');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const id = crypto.randomBytes(6).toString('hex');
      const ext = path.extname(file.originalname) || '.audio';
      cb(null, `${id}${ext}`);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 }
});

function pad(n, w = 2) { return String(n).padStart(w, '0'); }
function centis(t) { return pad(Math.floor((t % 1) * 100)); }
function assTime(t) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return `${h}:${pad(m)}:${pad(s)}.${centis(t)}`;
}

function buildAss(beats, fps, width, height, durationSec) {
  const frameDur = 1 / fps;
  const showDur = Math.max(frameDur * 1.5, 0.04);
  const fontSize = Math.round(height * 0.09);
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,3,5,10,10,10,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];
  const events = beats.map(b => {
    const start = Math.min(Math.max(b.time, 0), durationSec - frameDur);
    const end = Math.min(start + showDur, durationSec);
    const text = `Beat: ${b.beatInMeasure}   Measure: ${b.measure}   Frame: ${b.frame}`;
    return `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`;
  });
  return header.concat(events).join('\n') + '\n';
}

app.post('/render', upload.single('audio'), async (req, res) => {
  const audioPath = req.file?.path;
  if (!audioPath) return res.status(400).json({ error: 'no audio' });

  let beats, fps, width, height, duration;
  try {
    beats = JSON.parse(req.body.beats);
    fps = parseInt(req.body.fps, 10);
    width = parseInt(req.body.width, 10) || 1280;
    height = parseInt(req.body.height, 10) || 720;
    duration = parseFloat(req.body.duration);
  } catch (e) {
    return res.status(400).json({ error: 'bad params: ' + e.message });
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    return res.status(400).json({ error: 'bad duration' });
  }
  if (![12, 24, 30, 60].includes(fps)) {
    return res.status(400).json({ error: 'fps must be 12/24/30/60' });
  }

  const workDir = path.dirname(audioPath);
  const stem = path.basename(audioPath, path.extname(audioPath));
  const assPath = path.join(workDir, `${stem}.ass`);
  const outPath = path.join(workDir, `${stem}.mp4`);
  fs.writeFileSync(assPath, buildAss(beats, fps, width, height, duration));

  const args = [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${duration.toFixed(3)}`,
    '-i', path.basename(audioPath),
    '-vf', `ass=${path.basename(assPath)}`,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    path.basename(outPath)
  ];

  const ff = spawn(FFMPEG, args, { cwd: workDir });
  let stderr = '';
  ff.stderr.on('data', d => { stderr += d.toString(); });
  ff.on('error', err => {
    cleanup([audioPath, assPath, outPath]);
    res.status(500).json({ error: 'ffmpeg spawn failed: ' + err.message });
  });
  ff.on('close', code => {
    if (code !== 0) {
      cleanup([audioPath, assPath, outPath]);
      return res.status(500).json({ error: 'ffmpeg exit ' + code, stderr: stderr.slice(-4000) });
    }
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="beats.mp4"`);
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('close', () => cleanup([audioPath, assPath, outPath]));
  });
});

function cleanup(paths) {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch {}
  }
}

app.listen(PORT, () => {
  console.log(`Master Beater running: http://localhost:${PORT}`);
});
