# Chi Mirror Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `chi-mirror.html` — a full-screen, always-on face-cam experience for Puzzle Acupuncture clinic that maps facial meridians, Five Element music frequencies, and head movement Yin/Yang tracking into a flowing neon particle canvas.

**Architecture:** Single self-contained HTML file. MediaPipe Face Mesh (CDN) for 468 facial landmarks. Web Audio API for microphone frequency analysis split into 5 bands (Five Elements). Canvas 2D for particle rendering at 60fps. No server, no build step, no dependencies to install.

**Tech Stack:** HTML/CSS/JS (vanilla), MediaPipe Face Mesh v0.4 (CDN), Web Audio API (built-in), Canvas 2D (built-in)

**Reference file:** `WalktheChat Dropbox/Jenny/vibecoding/visual/puzzle-cam.html` — match brand colors and font imports, but this is a NEW file not a modification.

---

### Task 1: HTML Shell + Camera Init

**Files:**
- Create: `WalktheChat Dropbox/Jenny/vibecoding/visual/chi-mirror.html`

**Step 1: Create the file with full-screen canvas + webcam bootstrap**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Puzzle Acupuncture — Chi Mirror</title>
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=IBM+Plex+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#0D0500;overflow:hidden;width:100vw;height:100vh}
canvas{position:fixed;inset:0;width:100%;height:100%}
#ui{position:fixed;inset:0;pointer-events:none;font-family:'IBM Plex Mono',monospace}
video{display:none;position:absolute}
</style>
</head>
<body>
<video id="vid" autoplay playsinline muted></video>
<canvas id="c"></canvas>
<div id="ui"></div>
<script>
const vid = document.getElementById('vid');
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
  vid.srcObject = stream;
  await new Promise(r => vid.onloadedmetadata = r);
  vid.play();
}

startCamera().catch(console.error);
</script>
</body>
</html>
```

**Step 2: Open in browser, verify camera permission prompt appears and video stream starts (even though nothing is drawn yet)**

Open: `chi-mirror.html` in Chrome. Accept camera permission. No errors in console.

**Step 3: Commit**

```bash
git add "WalktheChat Dropbox/Jenny/vibecoding/visual/chi-mirror.html"
git commit -m "feat: chi-mirror shell with webcam init"
```

---

### Task 2: MediaPipe Face Mesh + Draw Landmarks Debug View

**Files:**
- Modify: `chi-mirror.html` — add MediaPipe CDN scripts + face detection loop

**Step 1: Add MediaPipe imports (in `<head>` after fonts)**

```html
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js"></script>
```

**Step 2: Initialize Face Mesh after `startCamera()` call**

Replace the script block with:

```javascript
const vid = document.getElementById('vid');
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let landmarks = null; // 468 points [{x,y,z}] normalized 0-1

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// MediaPipe Face Mesh
const faceMesh = new FaceMesh({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}` });
faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
faceMesh.onResults(results => {
  landmarks = results.multiFaceLandmarks?.[0] || null;
});

const camera = new Camera(vid, {
  onFrame: async () => { await faceMesh.send({ image: vid }); },
  width: 640, height: 480
});
camera.start();

// Debug: draw dots at each landmark
function drawDebug() {
  ctx.fillStyle = '#0D0500';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (landmarks) {
    ctx.fillStyle = '#FF6B35';
    landmarks.forEach(p => {
      const x = p.x * canvas.width;
      const y = p.y * canvas.height;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  requestAnimationFrame(drawDebug);
}
drawDebug();
```

**Step 3: Verify in browser**

Open `chi-mirror.html`. You should see orange dots mapping your face in real time on a dark background. ~468 dots forming face contours, eyes, lips, nose.

**Step 4: Commit**

```bash
git commit -am "feat: add MediaPipe face mesh with debug landmark view"
```

---

### Task 3: Meridian Line Paths

**Files:**
- Modify: `chi-mirror.html` — define 6 meridian paths using MediaPipe landmark indices

**Step 1: Add meridian path definitions (after `let landmarks = null`)**

MediaPipe landmark index reference: https://developers.google.com/mediapipe/solutions/vision/face_landmarker
Key indices used here are approximate face-surface meridian routes.

```javascript
// Meridian paths: arrays of landmark indices tracing each meridian across the face
const MERIDIANS = {
  stomach:       { pts: [234, 93, 132, 58, 172, 136, 150, 149, 176, 148], color: '#FFB835', name: 'ST' },
  largeIntestine:{ pts: [2, 326, 327, 2, 97, 98, 60], color: '#FF6B35', name: 'LI' },
  tripleWarmer:  { pts: [234, 227, 137, 177, 215, 58], color: '#FF4D9D', name: 'TW' },
  bladder:       { pts: [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1], color: '#35AAFF', name: 'BL' },
  governing:     { pts: [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 2], color: '#C0C0FF', name: 'GV' },
  conception:    { pts: [152, 175, 14, 13, 12, 11, 0, 267, 269], color: '#FFD700', name: 'CV' },
};

// Helper: convert normalized landmark to canvas coords
function lmToCanvas(lm) {
  return { x: lm.x * canvas.width, y: lm.y * canvas.height };
}

// Draw meridian lines (debug — will replace with particles later)
function drawMeridians() {
  if (!landmarks) return;
  Object.values(MERIDIANS).forEach(m => {
    ctx.strokeStyle = m.color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    m.pts.forEach((idx, i) => {
      const pt = lmToCanvas(landmarks[idx]);
      i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}
```

**Step 2: Call `drawMeridians()` inside the render loop (after clearing canvas)**

**Step 3: Verify**

Faint colored lines should trace meridian paths across your face. They move with you.

**Step 4: Commit**

```bash
git commit -am "feat: add 6 facial meridian line paths with landmark tracking"
```

---

### Task 4: Web Audio API — Five Elements Frequency Analysis

**Files:**
- Modify: `chi-mirror.html` — add microphone + FFT frequency band analysis

**Step 1: Add audio init function (before `drawDebug`)**

```javascript
let audioCtx, analyser, freqData;
let elementLevels = { water: 0, wood: 0, fire: 0, earth: 0, metal: 0 };
let dominantElement = 'fire';

async function startAudio() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  freqData = new Uint8Array(analyser.frequencyBinCount);
}

// Five Elements: map FFT bins to elements
// At 44100Hz sample rate, fftSize 2048 → binCount 1024, each bin = ~43Hz
function updateElements() {
  if (!analyser) return;
  analyser.getByteFrequencyData(freqData);
  const sampleRate = audioCtx.sampleRate;
  const binHz = sampleRate / (analyser.fftSize);

  function bandAvg(loHz, hiHz) {
    const lo = Math.floor(loHz / binHz);
    const hi = Math.min(Math.floor(hiHz / binHz), freqData.length - 1);
    if (lo >= hi) return 0;
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += freqData[i];
    return sum / (hi - lo + 1) / 255; // normalize 0-1
  }

  elementLevels.water = bandAvg(20, 80);
  elementLevels.wood  = bandAvg(80, 250);
  elementLevels.fire  = bandAvg(250, 2000);
  elementLevels.earth = bandAvg(2000, 6000);
  elementLevels.metal = bandAvg(6000, 20000);

  dominantElement = Object.entries(elementLevels).sort((a,b) => b[1]-a[1])[0][0];
}
```

**Step 2: Call `startAudio()` alongside `camera.start()`**

**Step 3: Call `updateElements()` at the top of the render loop each frame**

**Step 4: Verify**

Add a temporary `console.log(dominantElement, elementLevels)` and play music. Watch the dominant element shift with the music in the console.

**Step 5: Remove the console.log, commit**

```bash
git commit -am "feat: add Web Audio Five Elements frequency analysis"
```

---

### Task 5: Particle System

**Files:**
- Modify: `chi-mirror.html` — replace debug drawing with a full particle system

**Step 1: Define element config + particle pool**

```javascript
const ELEMENT_CONFIG = {
  water: { color: '#6B35FF', glowColor: 'rgba(107,53,255,', name: 'Water', organ: 'Kidney' },
  wood:  { color: '#35FF6B', glowColor: 'rgba(53,255,107,', name: 'Wood',  organ: 'Liver'  },
  fire:  { color: '#FF4D1C', glowColor: 'rgba(255,77,28,',  name: 'Fire',  organ: 'Heart'  },
  earth: { color: '#FFB835', glowColor: 'rgba(255,184,53,', name: 'Earth', organ: 'Spleen' },
  metal: { color: '#F0F0FF', glowColor: 'rgba(240,240,255,',name: 'Metal', organ: 'Lung'   },
};

const particles = [];
const MAX_PARTICLES = 400;

class Particle {
  constructor(x, y, element, meridianDir) {
    this.x = x;
    this.y = y;
    this.element = element;
    const cfg = ELEMENT_CONFIG[element];
    this.color = cfg.color;
    this.glowColor = cfg.glowColor;
    // Flow along meridian direction with slight randomness
    const angle = meridianDir + (Math.random() - 0.5) * 0.6;
    const speed = 0.8 + Math.random() * 1.5;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.life = 1.0;
    this.decay = 0.008 + Math.random() * 0.012;
    this.size = 2 + Math.random() * 3;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= 0.98; // slight drag
    this.vy *= 0.98;
    this.life -= this.decay;
  }
  draw(ctx) {
    if (this.life <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.life * 0.85;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * this.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Spawn particles along meridian paths
function spawnMeridianParticles() {
  if (!landmarks) return;
  const element = dominantElement;
  const level = elementLevels[element];
  if (level < 0.03) return; // silence threshold

  // Pick a random meridian to spawn on
  const meridianKeys = Object.keys(MERIDIANS);
  const m = MERIDIANS[meridianKeys[Math.floor(Math.random() * meridianKeys.length)]];
  const pts = m.pts;

  // Pick a random segment along the meridian
  const segIdx = Math.floor(Math.random() * (pts.length - 1));
  const p0 = lmToCanvas(landmarks[pts[segIdx]]);
  const p1 = lmToCanvas(landmarks[pts[segIdx + 1]]);

  // Direction of this meridian segment
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const angle = Math.atan2(dy, dx);

  // Interpolate spawn point along segment
  const t = Math.random();
  const sx = p0.x + dx * t;
  const sy = p0.y + dy * t;

  const count = Math.floor(level * 3) + 1;
  for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
    particles.push(new Particle(sx, sy, element, angle));
  }
}

// Beat burst: spawn many particles from face center
function beatBurst() {
  if (!landmarks) return;
  const nose = lmToCanvas(landmarks[4]);
  const element = dominantElement;
  const count = 20;
  for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
    const angle = Math.random() * Math.PI * 2;
    particles.push(new Particle(nose.x, nose.y, element, angle));
  }
}
```

**Step 2: Replace `drawDebug` with the main render loop**

```javascript
let lastBeatTime = 0;
let prevFireLevel = 0;

function render() {
  // Fade trail effect instead of full clear
  ctx.fillStyle = 'rgba(13, 5, 0, 0.18)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  updateElements();

  // Beat detection: fire level spike
  const fireLevel = elementLevels.fire;
  if (fireLevel > prevFireLevel + 0.15 && Date.now() - lastBeatTime > 200) {
    beatBurst();
    lastBeatTime = Date.now();
  }
  prevFireLevel = fireLevel * 0.85 + prevFireLevel * 0.15; // smooth

  // Spawn particles along meridians
  if (Math.random() < 0.4) spawnMeridianParticles();

  // Update + draw particles
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    particles[i].draw(ctx);
    if (particles[i].life <= 0) particles.splice(i, 1);
  }

  requestAnimationFrame(render);
}
render();
```

**Step 3: Verify**

Play music. Neon orange/element-colored particles should flow along face meridian lines. Beat hits should cause bursts from the nose center.

**Step 4: Commit**

```bash
git commit -am "feat: particle system flowing along facial meridians, Five Elements color"
```

---

### Task 6: Acupoint Glow Nodes

**Files:**
- Modify: `chi-mirror.html` — add 6 pulsing acupoint markers with labels

**Step 1: Define acupoints with landmark indices**

```javascript
const ACUPOINTS = [
  { idx: 9,   name: 'Yintang',  code: 'EX-HN3', tip: 'Calms the Shen' },
  { idx: 50,  name: 'ST3',      code: 'ST3',     tip: 'Grounds earth chi' },
  { idx: 248, name: 'LI20',     code: 'LI20',    tip: 'Opens the lungs' },
  { idx: 55,  name: 'BL2',      code: 'BL2',     tip: 'Clears the head' },
  { idx: 352, name: 'TW23',     code: 'TW23',    tip: 'Harmonizes triple warmer' },
  { idx: 151, name: 'GV24',     code: 'GV24',    tip: 'Lifts the spirit' },
];
```

**Step 2: Add `drawAcupoints()` function**

```javascript
function drawAcupoints(time) {
  if (!landmarks) return;
  const pulse = (Math.sin(time / 400) + 1) / 2; // 0-1 slow pulse
  const audioBoost = (elementLevels.fire + elementLevels.earth) * 2;

  ACUPOINTS.forEach(ap => {
    const pt = lmToCanvas(landmarks[ap.idx]);
    const radius = 5 + pulse * 4 + audioBoost * 6;

    // Outer glow ring
    ctx.save();
    ctx.globalAlpha = 0.3 + pulse * 0.4;
    ctx.strokeStyle = '#FF6B35';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#FF6B35';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Inner dot
    ctx.globalAlpha = 0.8 + pulse * 0.2;
    ctx.fillStyle = '#FFD700';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
    ctx.fill();

    // Label (small, to the right)
    ctx.globalAlpha = 0.5 + pulse * 0.3;
    ctx.fillStyle = '#FFB88A';
    ctx.font = '7px IBM Plex Mono';
    ctx.fillText(ap.code, pt.x + 8, pt.y + 3);
    ctx.restore();
  });
}
```

**Step 3: Call `drawAcupoints(Date.now())` in the render loop after particles**

**Step 4: Verify**

6 glowing gold dots should appear on your face at acupoints with orange rings pulsing. Tiny code labels next to each.

**Step 5: Commit**

```bash
git commit -am "feat: add 6 pulsing acupoint glow nodes with labels"
```

---

### Task 7: Head Movement Yin/Yang Meter

**Files:**
- Modify: `chi-mirror.html` — track nose landmark position delta + draw arc meter

**Step 1: Add tracking state + update function**

```javascript
let prevNoseX = null, prevNoseY = null;
let yangScore = 50; // 0=full yin, 100=full yang
let stillFrames = 0;

function updateYinYang() {
  if (!landmarks) return;
  const nose = lmToCanvas(landmarks[4]);

  if (prevNoseX !== null) {
    const dx = nose.x - prevNoseX;
    const dy = nose.y - prevNoseY;
    const velocity = Math.sqrt(dx*dx + dy*dy);

    // velocity 0 = yin, velocity 10+ = full yang
    const targetYang = Math.min(100, velocity * 10);
    yangScore = yangScore * 0.92 + targetYang * 0.08; // smooth

    // Count still frames for Chi Scan trigger
    stillFrames = velocity < 0.5 ? stillFrames + 1 : 0;
  }

  prevNoseX = nose.x;
  prevNoseY = nose.y;
}
```

**Step 2: Add `drawYinYangMeter()` function**

```javascript
function drawYinYangMeter() {
  const cx = canvas.width / 2;
  const cy = canvas.height - 60;
  const r = 50;
  const startAngle = Math.PI + 0.3;
  const endAngle = -0.3; // arc across bottom
  const total = Math.PI * 2 - 0.6;

  // Background arc
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, startAngle + total);
  ctx.stroke();

  // Yang fill (orange)
  const fillEnd = startAngle + (yangScore / 100) * total;
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = yangScore > 70 ? '#FF4D1C' : yangScore < 30 ? '#6B35FF' : '#FFB835';
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, fillEnd);
  ctx.stroke();

  // Labels
  ctx.globalAlpha = 0.5;
  ctx.font = '7px IBM Plex Mono';
  ctx.fillStyle = '#6B35FF';
  ctx.fillText('YIN', cx - r - 20, cy + 5);
  ctx.fillStyle = '#FF4D1C';
  ctx.fillText('YANG', cx + r + 4, cy + 5);

  // Status text
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#FFB88A';
  ctx.font = '8px IBM Plex Mono';
  ctx.textAlign = 'center';
  const status = yangScore > 70 ? 'excess yang — breathe' : yangScore < 30 ? 'stagnant qi — move' : 'balanced chi';
  ctx.fillText(status, cx, cy + 20);
  ctx.textAlign = 'left';
  ctx.restore();
}
```

**Step 3: Call both functions in the render loop**

**Step 4: Verify**

Move your head quickly — arc should fill orange (Yang). Hold still — arc should shift toward blue/violet (Yin). Status text updates.

**Step 5: Commit**

```bash
git commit -am "feat: head movement Yin/Yang arc meter with status"
```

---

### Task 8: UI Overlay — Element Badge + Reading

**Files:**
- Modify: `chi-mirror.html` — HTML overlay for logo, active element badge, TCM reading

**Step 1: Add UI HTML inside `<div id="ui">`**

```html
<div id="ui">
  <!-- Logo top-left -->
  <div style="position:absolute;top:16px;left:20px;display:flex;align-items:center;gap:10px">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px;width:22px;height:22px">
      <div style="background:#FF6B35;border-radius:1px"></div>
      <div style="border:1px solid #FF8C5A;border-radius:1px"></div>
      <div style="background:#FF6B35;border-radius:1px"></div>
      <div style="border:1px solid #FF8C5A;border-radius:1px"></div>
      <div style="background:#FF6B35;border-radius:1px"></div>
      <div style="border:1px solid #FF8C5A;border-radius:1px"></div>
      <div style="background:#FF6B35;border-radius:1px"></div>
      <div style="border:1px solid #FF8C5A;border-radius:1px"></div>
      <div style="background:#FF6B35;border-radius:1px"></div>
    </div>
    <span style="font-family:'Press Start 2P',monospace;font-size:7px;color:#FF6B35;letter-spacing:.05em">PUZZLE ACUT.</span>
  </div>

  <!-- Element badge top-right -->
  <div id="element-badge" style="position:absolute;top:16px;right:20px;padding:6px 14px;border:1.5px solid #FF6B35;border-radius:2px;background:rgba(13,5,0,0.7)">
    <span id="element-icon" style="font-size:16px">🔥</span>
    <span id="element-name" style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:#FF6B35;margin-left:6px;letter-spacing:.08em">FIRE</span>
  </div>

  <!-- Reading bottom-center (above meter) -->
  <div id="reading" style="position:absolute;bottom:110px;left:50%;transform:translateX(-50%);text-align:center;max-width:360px">
    <p id="reading-text" style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:#FFB88A;letter-spacing:.06em;line-height:1.6"></p>
  </div>
</div>
```

**Step 2: Add element update function in JS**

```javascript
const ELEMENT_UI = {
  water: { icon: '💧', color: '#6B35FF', readings: [
    'Kidney chi flowing — rest is medicine',
    'Water nourishes Wood — trust the process',
    'Deep reserves within you — draw from them',
  ]},
  wood:  { icon: '🌿', color: '#35FF6B', readings: [
    'Liver awake — let the tension move through',
    'Wood energy rises — vision is clear today',
    'Growth requires release — what can you let go?',
  ]},
  fire:  { icon: '🔥', color: '#FF4D1C', readings: [
    'Heart energy rising — stay present, breathe',
    'Fire warms the spirit — connection is near',
    'Yang is high — channel it with intention',
  ]},
  earth: { icon: '🌕', color: '#FFB835', readings: [
    'Spleen grounded — nourish yourself today',
    'Earth steadies all — you are supported',
    'Center holds — digest what you have received',
  ]},
  metal: { icon: '✨', color: '#F0F0FF', readings: [
    'Lung clarity — release what no longer serves',
    'Metal purifies — breathe in, let go',
    'Autumn energy — honor endings and beginnings',
  ]},
};

let lastElementForUI = null;
let lastReadingIdx = 0;

function updateUI() {
  const el = dominantElement;
  if (el === lastElementForUI) return;
  lastElementForUI = el;
  const cfg = ELEMENT_UI[el];
  document.getElementById('element-icon').textContent = cfg.icon;
  document.getElementById('element-name').textContent = cfg.name.toUpperCase();
  document.getElementById('element-name').style.color = cfg.color;
  document.getElementById('element-badge').style.borderColor = cfg.color;

  lastReadingIdx = (lastReadingIdx + 1) % cfg.readings.length;
  document.getElementById('reading-text').textContent = cfg.readings[lastReadingIdx];
}
```

**Step 3: Call `updateUI()` in render loop**

**Step 4: Verify**

Element badge in top-right updates as you play different music. Reading text at bottom changes with the element.

**Step 5: Commit**

```bash
git commit -am "feat: UI overlay with element badge and TCM reading text"
```

---

### Task 9: Chi Scan Trigger (3-second hold-still)

**Files:**
- Modify: `chi-mirror.html` — trigger dramatic scan when user holds still for 3 seconds

**Step 1: Add Chi Scan state + trigger**

```javascript
let chiScanActive = false;
let chiScanFrame = 0;
const CHI_SCAN_FRAMES = 90; // ~1.5s at 60fps
const STILL_THRESHOLD = 180; // ~3s at 60fps

function checkChiScan() {
  if (stillFrames >= STILL_THRESHOLD && !chiScanActive && landmarks) {
    chiScanActive = true;
    chiScanFrame = 0;
    stillFrames = 0;
    // Trigger burst from all acupoints
    ACUPOINTS.forEach(ap => {
      const pt = lmToCanvas(landmarks[ap.idx]);
      for (let i = 0; i < 15; i++) {
        const angle = Math.random() * Math.PI * 2;
        particles.push(new Particle(pt.x, pt.y, dominantElement, angle));
      }
    });
  }
}

function drawChiScan() {
  if (!chiScanActive) return;
  chiScanFrame++;

  const progress = chiScanFrame / CHI_SCAN_FRAMES;
  const cfg = ELEMENT_CONFIG[dominantElement];

  // Expanding ring
  if (progress < 0.5) {
    const r = progress * 2 * Math.min(canvas.width, canvas.height) * 0.6;
    ctx.save();
    ctx.globalAlpha = (1 - progress * 2) * 0.3;
    ctx.strokeStyle = cfg.color;
    ctx.lineWidth = 3;
    ctx.shadowColor = cfg.color;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Flash overlay on beat
  if (chiScanFrame === 20 || chiScanFrame === 40) {
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = cfg.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  if (chiScanFrame >= CHI_SCAN_FRAMES) chiScanActive = false;
}
```

**Step 2: Call `checkChiScan()` and `drawChiScan()` in render loop**

**Step 3: Verify**

Sit in front of camera, hold your head completely still for 3 seconds. A ring should expand outward, particles burst from all acupoint positions simultaneously.

**Step 4: Commit**

```bash
git commit -am "feat: Chi Scan trigger on 3-second head stillness"
```

---

### Task 10: Final Polish

**Files:**
- Modify: `chi-mirror.html` — ambient particle rain for empty frame, color tuning, performance check

**Step 1: Add ambient particles when no face detected**

In the render loop, when `!landmarks`, spawn gentle ambient particles floating upward:

```javascript
function spawnAmbientParticles() {
  if (particles.length >= MAX_PARTICLES * 0.3) return;
  const x = Math.random() * canvas.width;
  const y = canvas.height + 10;
  const el = ['fire', 'earth', 'metal'][Math.floor(Math.random() * 3)];
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.5; // mostly upward
  const p = new Particle(x, y, el, angle);
  p.vy = -0.5 - Math.random(); // override to float up
  particles.push(p);
}
```

Call `spawnAmbientParticles()` when `!landmarks` (every few frames, guarded by `Math.random() < 0.2`).

**Step 2: Tune fade trail opacity**

Adjust `rgba(13, 5, 0, 0.18)` — lower = longer trails (more flow), higher = sharper. Target ~0.12 for a good flow feel.

**Step 3: Performance check**

Open DevTools Performance tab. Record 5 seconds. Target: 50fps+ on MacBook. If frame rate drops below 40fps, reduce `MAX_PARTICLES` from 400 to 250.

**Step 4: Remove all `console.log` debug calls**

```bash
grep -n "console.log" "WalktheChat Dropbox/Jenny/vibecoding/visual/chi-mirror.html"
```

**Step 5: Final commit**

```bash
git commit -am "feat: ambient particles for empty frame, polish and perf tuning"
```

---

## Summary

10 tasks, each ~2-5 minutes. Result: `chi-mirror.html` — a self-contained TCM-themed face-cam ambient experience.

**To run:** Open `chi-mirror.html` in Chrome. Accept camera + microphone permissions. Play music.

**No server needed.** No build step. No install.
