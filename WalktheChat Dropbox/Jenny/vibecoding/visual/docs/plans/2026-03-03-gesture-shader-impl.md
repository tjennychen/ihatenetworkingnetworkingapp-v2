# Gesture Tracking + Reaction Diffusion Shader Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add MediaPipe Holistic (face+hands+pose), a WebGL reaction diffusion shader background, hand/arm particle trails, and 6 TCM gesture effects to `chi-mirror.html`.

**Architecture:** Three-layer canvas stack — WebGL canvas (shader background) + Canvas 2D (particles, acupoints, meter) + HTML overlay (badges, sliders). MediaPipe Holistic feeds `window.motionData` each frame; the shader reads it to warp diffusion origin and reaction speed.

**Tech Stack:** Vanilla JS, WebGL 1.0, GLSL ES 1.0, MediaPipe Holistic (CDN), Canvas 2D, Web Audio API (existing)

**File:** `WalktheChat Dropbox/Jenny/vibecoding/visual/chi-mirror.html` (absolute: `/Users/jenny/WalktheChat Dropbox/Jenny/vibecoding/visual/chi-mirror.html`)
**Git root:** `/Users/jenny/WalktheChat Dropbox/Jenny/vibecoding/visual 2/`

---

### Task 1: Add WebGL Canvas + Init WebGL Context

**Files:**
- Modify: `chi-mirror.html` — add `<canvas id="glc">` before existing `<canvas id="c">`, init WebGL context in JS

**Step 1: Add WebGL canvas to HTML**

In the `<body>`, find `<canvas id="c"></canvas>` and insert the WebGL canvas BEFORE it:

```html
<canvas id="glc"></canvas>
<canvas id="c"></canvas>
```

The CSS rule `canvas{position:fixed;inset:0;width:100%;height:100%}` already handles both. `glc` will be behind `c` because it comes first in DOM order.

**Step 2: Add WebGL init code in JS**

After `const ctx = canvas.getContext('2d');`, add:

```javascript
// WebGL setup
const glCanvas = document.getElementById('glc');
const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl');

function resizeGL() {
  glCanvas.width  = window.innerWidth;
  glCanvas.height = window.innerHeight;
  if (gl) gl.viewport(0, 0, glCanvas.width, glCanvas.height);
}
resizeGL();
```

**Step 3: Update the existing `resize()` function** to also call `resizeGL()`:

Find:
```javascript
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
```
Replace with:
```javascript
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  resizeGL();
}
```

**Step 4: Verify**

Open `chi-mirror.html` in Chrome. Open DevTools console. No `gl is null` errors. The dark background is still visible (WebGL canvas initializes black by default).

**Step 5: Commit**
```bash
git -C "/Users/jenny/WalktheChat Dropbox/Jenny/vibecoding/visual 2/" commit -am "feat: add WebGL canvas and init GL context"
```

---

### Task 2: Write Vertex + Fragment Shaders

**Files:**
- Modify: `chi-mirror.html` — add shader source strings + compile/link program

**Step 1: Add shader source strings** in JS, just after the `resizeGL()` function:

```javascript
// ── Shaders ──────────────────────────────────────────────────────────────────
const VS_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FS_SRC = `
precision mediump float;
uniform float u_time;
uniform float u_speed;
uniform float u_cellScale;
uniform float u_pulse;
uniform float u_hueShift;
uniform vec2  u_resolution;
uniform vec2  u_motionXY;
uniform float u_intensity;

float voronoi(vec2 uv, float scale, float t) {
  uv *= scale;
  vec2 i = floor(uv);
  vec2 f = fract(uv);
  float minDist = 1.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      vec2 n   = vec2(float(x), float(y));
      vec2 cell = i + n;
      float seed = dot(cell, vec2(127.1, 311.7));
      vec2 center = 0.5 + 0.4 * vec2(
        sin(seed * 6.28318 + t),
        cos(seed * 5.17 + t)
      );
      minDist = min(minDist, length(n + center - f));
    }
  }
  return minDist;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  // Warp UV toward motionXY
  float warp = 0.15 + u_intensity * 0.3;
  uv = mix(uv, u_motionXY, warp * 0.4);

  float t = u_time * u_speed;

  float c1 = voronoi(uv, 5.0  * u_cellScale, t * 0.7);
  float c2 = voronoi(uv, 10.0 * u_cellScale, t * 1.1);
  float c3 = voronoi(uv, 20.0 * u_cellScale, t * 1.5);

  float A = c1;
  float B = mix(c2, c3, 0.5);
  float pulse = sin(u_time * 1.2) * 0.5 + 0.5;
  float reaction = clamp((A - B + pulse * u_pulse * 0.3) * 2.0 + 0.5, 0.0, 1.0);
  reaction = mix(reaction, pow(reaction, 0.5), u_intensity * 0.6);

  vec3 colA = vec3(0.05, 0.02, 0.0);
  vec3 colB = vec3(1.0, 0.42 + u_hueShift * 0.2, 0.21);
  vec3 colC = vec3(1.0, 0.85, 0.63);
  vec3 color = reaction < 0.5
    ? mix(colA, colB, reaction * 2.0)
    : mix(colB, colC, (reaction - 0.5) * 2.0);

  float edge = 1.0 - smoothstep(0.0, 0.08, c1);
  color += vec3(1.0, 0.5, 0.2) * edge * 0.6;

  vec2 vigUV = uv - 0.5;
  float vignette = clamp(1.0 - dot(vigUV, vigUV) * 1.5, 0.0, 1.0);
  color *= vignette;

  gl_FragColor = vec4(color, 1.0);
}
`;

function compileShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader error:', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

function buildProgram() {
  const vs = compileShader(gl.VERTEX_SHADER,   VS_SRC);
  const fs = compileShader(gl.FRAGMENT_SHADER, FS_SRC);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

let glProg = null;
let glUniforms = {};

function initGL() {
  if (!gl) return;
  glProg = buildProgram();
  if (!glProg) return;
  gl.useProgram(glProg);

  // Full-screen quad: 2 triangles as TRIANGLE_STRIP
  const verts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(glProg, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Cache uniform locations
  glUniforms = {
    time:       gl.getUniformLocation(glProg, 'u_time'),
    speed:      gl.getUniformLocation(glProg, 'u_speed'),
    cellScale:  gl.getUniformLocation(glProg, 'u_cellScale'),
    pulse:      gl.getUniformLocation(glProg, 'u_pulse'),
    hueShift:   gl.getUniformLocation(glProg, 'u_hueShift'),
    resolution: gl.getUniformLocation(glProg, 'u_resolution'),
    motionXY:   gl.getUniformLocation(glProg, 'u_motionXY'),
    intensity:  gl.getUniformLocation(glProg, 'u_intensity'),
  };
}

initGL();
```

**Step 2: Verify**

Open in Chrome. Open DevTools console. No shader compile errors. You can verify by adding a temporary call to `drawGL()` (which we'll write in Task 3) — but for now just confirm no errors on load.

**Step 3: Commit**
```bash
git -C "/Users/jenny/WalktheChat Dropbox/Jenny/vibecoding/visual 2/" commit -am "feat: add reaction diffusion vertex and fragment shaders"
```

---

### Task 3: WebGL Render Call in Main Loop

**Files:**
- Modify: `chi-mirror.html` — add `drawGL()` function, call it from `render()`

**Step 1: Add `drawGL()` function** after `initGL()`:

```javascript
function drawGL() {
  if (!gl || !glProg) return;
  gl.uniform1f(glUniforms.time,       performance.now() / 1000);
  gl.uniform1f(glUniforms.speed,      parseFloat(document.getElementById('ctrl-speed')?.value  ?? 1.0));
  gl.uniform1f(glUniforms.cellScale,  parseFloat(document.getElementById('ctrl-scale')?.value  ?? 1.0));
  gl.uniform1f(glUniforms.pulse,      parseFloat(document.getElementById('ctrl-pulse')?.value  ?? 0.5));
  gl.uniform1f(glUniforms.hueShift,   parseFloat(document.getElementById('ctrl-hue')?.value    ?? 0.0));
  gl.uniform2f(glUniforms.resolution, glCanvas.width, glCanvas.height);
  gl.uniform2f(glUniforms.motionXY,   window.motionData?.x ?? 0.5, window.motionData?.y ?? 0.5);
  gl.uniform1f(glUniforms.intensity,  window.motionData?.intensity ?? 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
```

**Step 2: Call `drawGL()` as the FIRST thing in `render()`**

Find the start of `render()`:
```javascript
function render() {
  updateElements();
```
Replace with:
```javascript
function render() {
  drawGL();
  updateElements();
```

**Step 3: Verify**

Open in Chrome. You should now see the reaction diffusion shader as a dark orange/brown animated background. The Canvas 2D layer (particles etc.) renders on top. If the background is black/blank, check console for shader errors.

**Step 4: Commit**
```bash
git -C "/Users/jenny/WalktheChat Dropbox/Jenny/vibecoding/visual 2/" commit -am "feat: wire WebGL shader into main render loop"
```

---

### Task 4: Add 4 UI Control Sliders

**Files:**
- Modify: `chi-mirror.html` — add controls HTML to `#ui`, add CSS

**Step 1: Add slider CSS** inside the `<style>` block, after the existing rules:

```css
#controls{position:absolute;bottom:20px;left:20px;display:flex;flex-direction:column;gap:6px;pointer-events:all}
#controls label{display:flex;align-items:center;gap:8px;font-size:7px;color:rgba(255,184,138,0.7);letter-spacing:.06em;font-family:'IBM Plex Mono',monospace}
#controls input[type=range]{width:90px;accent-color:#FF6B35;cursor:pointer}
```

**Step 2: Add slider HTML** inside `<div id="ui">`, after the `#reading` div:

```html
  <!-- Controls bottom-left -->
  <div id="controls">
    <label>SPEED  <input type="range" id="ctrl-speed" min="0.1" max="2.0" step="0.1"  value="1.0"></label>
    <label>SCALE  <input type="range" id="ctrl-scale" min="0.5" max="3.0" step="0.1"  value="1.0"></label>
    <label>PULSE  <input type="range" id="ctrl-pulse" min="0.0" max="1.0" step="0.05" value="0.5"></label>
    <label>ORANGE <input type="range" id="ctrl-hue"   min="0.0" max="1.0" step="0.05" value="0.0"></label>
  </div>
```

**Step 3: Verify**

4 labeled sliders appear in bottom-left. Dragging SPEED makes the shader animate faster/slower. SCALE changes cell size. PULSE changes breathing intensity. ORANGE shifts the warm tone.

**Step 4: Commit**
```bash
git -C "/Users/jenny/WalktheChat Dropbox/Jenny/vibecoding/visual 2/" commit -am "feat: add 4 realtime shader control sliders"
```

---

### Task 5: Swap Face Mesh → MediaPipe Holistic

**Files:**
- Modify: `chi-mirror.html` — replace face_mesh CDN with holistic CDN, replace FaceMesh instance with Holistic

**Step 1: Replace CDN script tag**

Find:
```html
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js"></script>
```
Replace with:
```html
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/holistic/holistic.js"></script>
```

**Step 2: Add new landmark state variables**

Find `let landmarks = null;` and add after it:
```javascript
let handLandmarks = { left: null, right: null };
let poseLandmarks = null;
window.motionData = { x: 0.5, y: 0.5, intensity: 0 };
let prevHandCentroid = null;
```

**Step 3: Replace FaceMesh instance with Holistic**

Find the entire MediaPipe block:
```javascript
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
```

Replace with:
```javascript
// MediaPipe Holistic (face + hands + pose)
const holistic = new Holistic({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${f}` });
holistic.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  refineFaceLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});
holistic.onResults(results => {
  landmarks          = results.faceLandmarks             || null;
  poseLandmarks      = results.poseLandmarks             || null;
  handLandmarks.left  = results.leftHandLandmarks        || null;
  handLandmarks.right = results.rightHandLandmarks       || null;
  updateMotionData();
});

const camera = new Camera(vid, {
  onFrame: async () => { await holistic.send({ image: vid }); },
  width: 640, height: 480
});
camera.start();
```

**Step 4: Add `updateMotionData()` function** — insert it just before the `camera` declaration:

```javascript
function updateMotionData() {
  const pts = [];
  if (handLandmarks.left)  pts.push(...handLandmarks.left);
  if (handLandmarks.right) pts.push(...handLandmarks.right);
  if (pts.length === 0 && landmarks) pts.push(landmarks[4]); // fallback: nose

  if (pts.length === 0) return;

  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

  let intensity = 0;
  if (prevHandCentroid) {
    const dx = cx - prevHandCentroid.x;
    const dy = cy - prevHandCentroid.y;
    intensity = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 20);
  }
  prevHandCentroid = { x: cx, y: cy };

  // Smooth intensity
  window.motionData = {
    x: cx,
    y: 1 - cy,  // flip y for WebGL coord system
    intensity: (window.motionData.intensity || 0) * 0.85 + intensity * 0.15,
  };
}
```

**Step 5: Verify**

Open in Chrome. Holistic takes a few seconds longer to load than Face Mesh. Once loaded, face should still be tracked (acupoints, Yin/Yang meter work). Move your hands — `window.motionData` should update (check in console: `window.motionData`). The shader diffusion origin should visibly shift toward your hands.

**Step 6: Commit**
```bash
git -C "/Users/jenny/WalktheChat Dropbox/Jenny/vibecoding/visual 2/" commit -am "feat: swap Face Mesh for Holistic, add motionData bridge"
```

---

### Task 6: Hand + Arm Particle Trails

**Files:**
- Modify: `chi-mirror.html` — add `spawnHandParticles()` and `spawnPoseParticles()`, call in render loop

**Step 1: Add `spawnHandParticles()` function** — insert after `spawnAmbientParticles()`:

```javascript
function spawnHandParticles() {
  const tips = [4, 8, 12, 16, 20]; // thumb, index, middle, ring, pinky tips
  ['left', 'right'].forEach(side => {
    const hand = handLandmarks[side];
    if (!hand) return;
    tips.forEach(idx => {
      if (particles.length >= MAX_PARTICLES) return;
      const pt = lmToCanvas(hand[idx]);
      const angle = Math.random() * Math.PI * 2;
      particles.push(new Particle(pt.x, pt.y, dominantElement, angle));
    });
  });
}
```

**Step 2: Add `spawnPoseParticles()` function** — insert after `spawnHandParticles()`:

```javascript
function spawnPoseParticles() {
  if (!poseLandmarks) return;
  // Arm segments: left shoulder→elbow→wrist, right shoulder→elbow→wrist
  const segments = [[11, 13], [13, 15], [12, 14], [14, 16]];
  segments.forEach(([a, b]) => {
    if (particles.length >= MAX_PARTICLES) return;
    const p0 = lmToCanvas(poseLandmarks[a]);
    const p1 = lmToCanvas(poseLandmarks[b]);
    const t = Math.random();
    const sx = p0.x + (p1.x - p0.x) * t;
    const sy = p0.y + (p1.y - p0.y) * t;
    const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    particles.push(new Particle(sx, sy, dominantElement, angle));
  });
}
```

**Step 3: Call both functions in `render()`**

Find the existing spawn block:
```javascript
  if (landmarks) {
    if (Math.random() < 0.4) spawnMeridianParticles();
  } else {
    if (Math.random() < 0.2) spawnAmbientParticles();
  }
```
Replace with:
```javascript
  if (landmarks) {
    if (Math.random() < 0.4) spawnMeridianParticles();
  } else {
    if (Math.random() < 0.2) spawnAmbientParticles();
  }
  if (Math.random() < 0.3) spawnHandParticles();
  if (Math.random() < 0.2) spawnPoseParticles();
```

**Step 4: Verify**

Put your hands in front of the camera. Particles should stream from your fingertips and along your arm lines (shoulder→elbow→wrist). They should be element-colored like the face meridian particles.

**Step 5: Commit**
```bash
git -C "/Users/jenny/WalktheChat Dropbox/Jenny/vibecoding/visual 2/" commit -am "feat: add hand fingertip and arm segment particle trails"
```

---

### Task 7: Gesture Detection

**Files:**
- Modify: `chi-mirror.html` — add `isExtended()`, `detectGesture()`, `detectBothHandsRaised()`, `detectNamaste()`

**Step 1: Add gesture detection functions** — insert after `spawnPoseParticles()`:

```javascript
// ── Gesture Detection ────────────────────────────────────────────────────────
function isExtended(hand, tipIdx, baseIdx) {
  return hand[tipIdx].y < hand[baseIdx].y - 0.04;
}

function detectGesture(hand) {
  if (!hand) return null;
  const thumb  = hand[4].x < hand[3].x; // thumb: horizontal extension
  const index  = isExtended(hand, 8,  6);
  const middle = isExtended(hand, 12, 10);
  const ring   = isExtended(hand, 16, 14);
  const pinky  = isExtended(hand, 20, 18);

  if (index && middle && ring && pinky) return 'open_palm';
  if (index && middle && !ring && !pinky) return 'peace';
  if (index && !middle && !ring && !pinky) return 'point';
  if (!index && !middle && !ring && !pinky) return 'fist';
  return null;
}

function detectBothHandsRaised() {
  if (!poseLandmarks) return false;
  // Wrists (15, 16) above shoulders (11, 12)
  return poseLandmarks[15].y < poseLandmarks[11].y &&
         poseLandmarks[16].y < poseLandmarks[12].y;
}

function detectNamaste() {
  if (!handLandmarks.left || !handLandmarks.right) return false;
  // Both wrist positions close together
  const dx = handLandmarks.left[0].x - handLandmarks.right[0].x;
  const dy = handLandmarks.left[0].y - handLandmarks.right[0].y;
  return Math.sqrt(dx * dx + dy * dy) < 0.1;
}
```

**Step 2: Add gesture state variables** — find `let chiScanActive = false;` and add before it:

```javascript
let activeGesture = null;
let gestureReading = null;
let gestureReadingTimer = 0;
```

**Step 3: Add `processGestures()` function** — insert after the detection functions:

```javascript
function processGestures() {
  const leftGesture  = detectGesture(handLandmarks.left);
  const rightGesture = detectGesture(handLandmarks.right);
  const gesture = rightGesture || leftGesture; // prefer right hand

  let newGesture = gesture;
  if (detectBothHandsRaised()) newGesture = 'both_raised';
  if (detectNamaste()) newGesture = 'namaste';

  if (newGesture !== activeGesture) {
    activeGesture = newGesture;
    if (newGesture) triggerGestureEffect(newGesture);
  }
}
```

**Step 4: Call `processGestures()` in `render()`** — add it after `updateYinYang()`:

```javascript
  processGestures();
```

**Step 5: Verify**

In console, add `console.log(activeGesture)` inside `processGestures()` temporarily. Make a fist, open palm, peace sign, point. Watch the console update. Remove the log when confirmed working.

**Step 6: Commit**
```bash
git -C "/Users/jenny/WalktheChat Dropbox/Jenny/vibecoding/visual 2/" commit -am "feat: add gesture detection for 6 TCM gestures"
```

---

### Task 8: Gesture Effects

**Files:**
- Modify: `chi-mirror.html` — add `triggerGestureEffect()`, gesture shader overrides, gesture reading display

**Step 1: Add gesture config** — insert after `ELEMENT_UI` constant:

```javascript
const GESTURE_READINGS = {
  open_palm:   'Open channels — chi flows freely',
  peace:       'Creative force rising — Wood energy',
  point:       'Where intention goes, energy follows',
  fist:        'Gathering jing — store your essence',
  both_raised: 'Heart fire — lifting the spirit',
  namaste:     'Shen is clear — heart and mind united',
};
```

**Step 2: Add gesture override uniforms** — find `window.motionData = { x: 0.5, y: 0.5, intensity: 0 };` and after it add:

```javascript
let gestureShaderBoost = 0; // extra intensity pushed to shader during gesture
```

**Step 3: Add `triggerGestureEffect()` function** — insert after `processGestures()`:

```javascript
function triggerGestureEffect(gesture) {
  // Show gesture reading
  const readingEl = document.getElementById('reading-text');
  if (readingEl && GESTURE_READINGS[gesture]) {
    readingEl.textContent = GESTURE_READINGS[gesture];
    clearTimeout(gestureReadingTimer);
    gestureReadingTimer = setTimeout(() => {
      // Restore element reading after 3s
      const cfg = ELEMENT_UI[dominantElement];
      if (cfg && readingEl) readingEl.textContent = cfg.readings[lastReadingIdx];
    }, 3000);
  }

  // Shader + particle effects per gesture
  switch (gesture) {
    case 'open_palm':
      gestureShaderBoost = 0.8;
      // Golden rain: spawn particles from top
      for (let i = 0; i < 30 && particles.length < MAX_PARTICLES; i++) {
        const x = Math.random() * canvas.width;
        const p = new Particle(x, 0, 'earth', Math.PI / 2 + (Math.random()-0.5)*0.3);
        p.vy = 0.8 + Math.random();
        particles.push(p);
      }
      break;

    case 'peace':
      gestureShaderBoost = 0.5;
      // Green burst upward from both hands
      ['left','right'].forEach(side => {
        const hand = handLandmarks[side];
        if (!hand) return;
        const pt = lmToCanvas(hand[9]); // middle of palm
        for (let i = 0; i < 15 && particles.length < MAX_PARTICLES; i++) {
          const angle = -Math.PI/2 + (Math.random()-0.5)*0.8;
          particles.push(new Particle(pt.x, pt.y, 'wood', angle));
        }
      });
      break;

    case 'point': {
      gestureShaderBoost = 0.3;
      // Stream from index fingertip
      const hand = handLandmarks.right || handLandmarks.left;
      if (hand) {
        const tip  = lmToCanvas(hand[8]);
        const base = lmToCanvas(hand[6]);
        const angle = Math.atan2(tip.y - base.y, tip.x - base.x);
        for (let i = 0; i < 20 && particles.length < MAX_PARTICLES; i++) {
          particles.push(new Particle(tip.x, tip.y, dominantElement, angle + (Math.random()-0.5)*0.2));
        }
      }
      break;
    }

    case 'fist':
      gestureShaderBoost = 1.0;
      // Spiral inward toward fist
      ['left','right'].forEach(side => {
        const hand = handLandmarks[side];
        if (!hand) return;
        const pt = lmToCanvas(hand[9]);
        for (let i = 0; i < 20 && particles.length < MAX_PARTICLES; i++) {
          const startX = pt.x + (Math.random()-0.5)*200;
          const startY = pt.y + (Math.random()-0.5)*200;
          const angle = Math.atan2(pt.y - startY, pt.x - startX);
          particles.push(new Particle(startX, startY, 'water', angle));
        }
      });
      break;

    case 'both_raised':
      gestureShaderBoost = 0.6;
      // All particles get upward velocity override — handled in render via yangScore boost
      yangScore = Math.min(100, yangScore + 30);
      break;

    case 'namaste':
      gestureShaderBoost = 0.4;
      // Ease yangScore toward 50 (balance)
      yangScore = yangScore * 0.7 + 50 * 0.3;
      break;
  }

  // Decay boost over ~1 second
  setTimeout(() => { gestureShaderBoost = 0; }, 1000);
}
```

**Step 4: Wire `gestureShaderBoost` into `drawGL()`**

Find in `drawGL()`:
```javascript
  gl.uniform1f(glUniforms.intensity,  window.motionData?.intensity ?? 0);
```
Replace with:
```javascript
  gl.uniform1f(glUniforms.intensity,  Math.min(1, (window.motionData?.intensity ?? 0) + gestureShaderBoost));
```

**Step 5: Verify**

Make each gesture and confirm: reading text updates at bottom, particles spawn appropriately, shader brightens/warps.

**Step 6: Commit**
```bash
git -C "/Users/jenny/WalktheChat Dropbox/Jenny/vibecoding/visual 2/" commit -am "feat: add gesture effects with shader boost, particles, and TCM readings"
```

---

### Task 9: Remove Dead Code

**Files:**
- Modify: `chi-mirror.html` — remove `MERIDIANS`, `spawnMeridianParticles()`, `beatBurst()`, `lmToCanvas` pose adaptation

**Step 1: Remove `beatBurst()` function entirely** (it's replaced by gesture effects)

Find the entire `beatBurst()` function and delete it:
```javascript
function beatBurst() {
  if (!landmarks) return;
  ...
}
```

**Step 2: Remove beat detection from `render()`**

Find and remove these lines from `render()`:
```javascript
  // Beat detection: fire level spike
  const fireLevel = elementLevels.fire;
  if (fireLevel > prevFireLevel + 0.15 && Date.now() - lastBeatTime > 200) {
    beatBurst();
    lastBeatTime = Date.now();
  }
  prevFireLevel = fireLevel * 0.85 + prevFireLevel * 0.15;
```

Also remove `let lastBeatTime = 0;` and `let prevFireLevel = 0;` from module scope.

**Step 3: Remove `MERIDIANS` constant and `spawnMeridianParticles()` function**

Find and delete:
- The entire `const MERIDIANS = { ... };` block
- The entire `function spawnMeridianParticles() { ... }` function
- The call to `spawnMeridianParticles()` in `render()`

Update the render spawn block to remove the meridian reference:
```javascript
  if (!landmarks) {
    if (Math.random() < 0.2) spawnAmbientParticles();
  }
  if (Math.random() < 0.3) spawnHandParticles();
  if (Math.random() < 0.2) spawnPoseParticles();
```

**Step 4: Verify**

File should still work. No console errors. Face tracking, hand trails, gesture detection, shader all functional.

**Step 5: Commit**
```bash
git -C "/Users/jenny/WalktheChat Dropbox/Jenny/vibecoding/visual 2/" commit -am "refactor: remove dead code (MERIDIANS, beatBurst, spawnMeridianParticles)"
```

---

### Task 10: Final Polish + Performance Check

**Files:**
- Modify: `chi-mirror.html` — performance tuning, remove any console.logs, final QA

**Step 1: Check for `console.log` calls**

Read the file and search for `console.log`. Remove any that were added during development. Keep `console.error` in shader compile checks and audio catch.

**Step 2: Add `gestureShaderBoost` smooth decay**

Instead of `setTimeout` for decay (which is abrupt), replace the setTimeout in `triggerGestureEffect` with a frame-based smooth decay. Add this to `render()` after `processGestures()`:

```javascript
  if (gestureShaderBoost > 0) gestureShaderBoost *= 0.97;
```

And remove the `setTimeout(() => { gestureShaderBoost = 0; }, 1000);` line from `triggerGestureEffect`.

**Step 3: Holistic is slower than Face Mesh — add a loading indicator**

Add to HTML in `#ui`:
```html
  <div id="loading" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-family:'Press Start 2P',monospace;font-size:10px;color:#FF6B35;letter-spacing:.1em">LOADING CHI...</div>
```

In JS, after `holistic.onResults(...)` first fires (i.e., once landmarks are set), hide the loading div:

Inside `holistic.onResults` callback, add at the top:
```javascript
  document.getElementById('loading')?.remove();
```

**Step 4: Performance check**

Open DevTools Performance tab, record 5s. Holistic is CPU-heavy. If FPS drops below 30:
- Reduce `modelComplexity` from `1` to `0` in `holistic.setOptions`
- Reduce `MAX_PARTICLES` from `400` to `250`

**Step 5: Final commit**
```bash
git -C "/Users/jenny/WalktheChat Dropbox/Jenny/vibecoding/visual 2/" commit -am "feat: gesture shader polish, smooth boost decay, loading indicator"
```

---

## Summary

10 tasks. Result: `chi-mirror.html` upgraded with:
- WebGL reaction diffusion shader (voronoi, orange→white color ramp, 4 sliders)
- MediaPipe Holistic (face + both hands + body pose)
- `window.motionData` bridge — hand centroid drives shader warp origin
- Hand fingertip + arm segment particle trails
- 6 gesture detectors (open palm, peace, point, fist, both raised, namaste)
- Each gesture triggers shader boost + particle effect + TCM reading

**To run:** Open `chi-mirror.html` in Chrome. Accept camera + mic. Play music.
