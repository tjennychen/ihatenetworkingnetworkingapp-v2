# Gesture Tracking + Reaction Diffusion Shader Design
**Date:** 2026-03-03
**Project:** Puzzle Acupuncture — Chi Mirror v2

---

## Overview

Two changes to `chi-mirror.html`:

1. **Swap MediaPipe Face Mesh → MediaPipe Holistic** — adds hand landmarks (21pts × 2) and pose landmarks (33pts) alongside existing face landmarks (468pts). Holistic computes `window.motionData = { x, y, intensity }` each frame from hand/body movement.

2. **Add WebGL reaction diffusion shader** as the background visual layer — replaces the Canvas 2D particle system. The shader reads `window.motionData` each frame to warp diffusion origin and reaction speed.

---

## Layer Stack

```
z-index 2 — HTML overlay (logo, element badge, TCM reading) — UNCHANGED
z-index 1 — Canvas 2D (acupoints glow, Yin/Yang meter) — KEPT, drawn on top
z-index 0 — WebGL canvas (reaction diffusion shader) — NEW full-screen background
```

Both canvases are `position:fixed; inset:0; width:100%; height:100%`. WebGL canvas gets `id="glc"`, existing Canvas 2D keeps `id="c"`.

---

## MediaPipe Holistic Integration

### CDN Change
Remove:
```html
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js"></script>
```
Add:
```html
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/holistic/holistic.js"></script>
```
Keep `camera_utils.js`.

### New Landmark Variables
```javascript
let landmarks = null;          // face (468pts) — same as before
let handLandmarks = { left: null, right: null }; // 21pts each
let poseLandmarks = null;      // 33pts body
```

### onResults Update
```javascript
holistic.onResults(results => {
  landmarks     = results.faceLandmarks || null;
  poseLandmarks = results.poseLandmarks || null;
  handLandmarks.left  = results.leftHandLandmarks  || null;
  handLandmarks.right = results.rightHandLandmarks || null;
  updateMotionData();
});
```

### motionData Computation
```javascript
window.motionData = { x: 0.5, y: 0.5, intensity: 0 };
let prevHandCentroid = null;

function updateMotionData() {
  // Collect all hand landmark positions
  const pts = [];
  if (handLandmarks.left)  pts.push(...handLandmarks.left);
  if (handLandmarks.right) pts.push(...handLandmarks.right);
  // Fall back to nose if no hands
  if (pts.length === 0 && landmarks) pts.push(landmarks[4]);

  if (pts.length === 0) return;

  // Centroid
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

  // Intensity = velocity of centroid
  let intensity = 0;
  if (prevHandCentroid) {
    const dx = cx - prevHandCentroid.x;
    const dy = cy - prevHandCentroid.y;
    intensity = Math.min(1, Math.sqrt(dx*dx + dy*dy) * 20);
  }
  prevHandCentroid = { x: cx, y: cy };

  window.motionData = { x: cx, y: 1 - cy, intensity }; // flip y for WebGL
}
```

---

## Passive Hand/Arm Trails (Canvas 2D)

Particles spawn from fingertips and along arm segments, same element-colored system as face meridians.

**Fingertip indices (MediaPipe Hands):** 4, 8, 12, 16, 20

**Arm segments (MediaPipe Pose):**
- Left: 11→13→15 (shoulder→elbow→wrist)
- Right: 12→14→16

```javascript
function spawnHandParticles() {
  ['left', 'right'].forEach(side => {
    const hand = handLandmarks[side];
    if (!hand) return;
    const tips = [4, 8, 12, 16, 20];
    tips.forEach(idx => {
      if (particles.length >= MAX_PARTICLES) return;
      const pt = lmToCanvas(hand[idx]);
      const angle = Math.random() * Math.PI * 2;
      particles.push(new Particle(pt.x, pt.y, dominantElement, angle));
    });
  });
}

function spawnPoseParticles() {
  if (!poseLandmarks) return;
  const segments = [[11,13],[13,15],[12,14],[14,16]];
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

Called in `render()` alongside existing `spawnMeridianParticles()`.

---

## Gesture Detection

Simple threshold: finger "extended" if tip y-position < its base knuckle y-position in normalized camera space.

```javascript
function isExtended(hand, tipIdx, baseIdx) {
  return hand[tipIdx].y < hand[baseIdx].y;
}

function detectGesture(hand) {
  if (!hand) return null;
  const thumb  = isExtended(hand, 4, 2);
  const index  = isExtended(hand, 8, 6);
  const middle = isExtended(hand, 12, 10);
  const ring   = isExtended(hand, 16, 14);
  const pinky  = isExtended(hand, 20, 18);
  const count  = [thumb, index, middle, ring, pinky].filter(Boolean).length;

  if (count === 5) return 'open_palm';
  if (index && middle && !ring && !pinky) return 'peace';
  if (index && !middle && !ring && !pinky) return 'point';
  if (count === 0) return 'fist';
  return null;
}
```

**Gesture → Effect mapping:**

| Gesture | Shader effect | Canvas 2D effect | Reading |
|---|---|---|---|
| open_palm | warp radius expands to full screen | golden particle rain from above | "Open channels — chi flows freely" |
| peace | green flash on shader | Wood burst upward | "Creative force rising" |
| point | diffusion origin locked to fingertip | Particle stream from fingertip | "Where intention goes, energy follows" |
| fist | warp origin pulls tight, intensity spike | Particles spiral inward | "Gathering jing — store your essence" |
| both_hands_raised (pose) | full-screen pulse | Particles float upward | "Heart fire — lifting the spirit" |
| namaste (hands close) | yin/yang smooth center animation | none | "Shen is clear — heart and mind united" |

---

## WebGL Reaction Diffusion Shader

### Setup
Add `<canvas id="glc">` before `<canvas id="c">` in the HTML body. Same CSS as existing canvas (`position:fixed; inset:0`).

### Shader Architecture
Full-screen quad (2 triangles). Single fragment shader pass per frame — no ping-pong buffers (stateless voronoi, not iterative RD). Uniforms updated each frame from JS.

### Uniforms
```glsl
uniform float u_time;
uniform float u_speed;       // slider 0.1–2.0
uniform float u_cellScale;   // slider 0.5–3.0
uniform float u_pulse;       // slider 0.0–1.0
uniform float u_hueShift;    // slider 0.0–1.0
uniform vec2  u_resolution;
uniform vec2  u_motionXY;    // window.motionData.x/y
uniform float u_intensity;   // window.motionData.intensity
```

### Fragment Shader Logic
```glsl
// Voronoi distance function
float voronoi(vec2 uv, float scale, float t) {
  uv *= scale;
  vec2 i = floor(uv);
  vec2 f = fract(uv);
  float minDist = 1.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      vec2 n = vec2(float(x), float(y));
      vec2 cell = i + n;
      // Organic drift: seed based on cell
      float seed = dot(cell, vec2(127.1, 311.7));
      vec2 center = 0.5 + 0.4 * vec2(sin(seed * 6.28 + t), cos(seed * 5.17 + t));
      float d = length(n + center - f);
      minDist = min(minDist, d);
    }
  }
  return minDist;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  // Warp UV origin toward motionXY
  float warpStrength = 0.15 + u_intensity * 0.3;
  uv = mix(uv, u_motionXY, warpStrength * 0.4);

  float t = u_time * u_speed;

  // Three voronoi layers
  float c1 = voronoi(uv, 5.0  * u_cellScale, t * 0.7);  // activator
  float c2 = voronoi(uv, 10.0 * u_cellScale, t * 1.1);  // inhibitor
  float c3 = voronoi(uv, 20.0 * u_cellScale, t * 1.5);  // inhibitor detail

  // Reaction = activator - inhibitor with breathing pulse
  float A = c1;
  float B = mix(c2, c3, 0.5);
  float pulse = sin(u_time * 1.2) * 0.5 + 0.5;
  float reaction = A - B + pulse * u_pulse * 0.3;
  reaction = clamp(reaction * 2.0 + 0.5, 0.0, 1.0);

  // Motion intensity boosts reaction contrast
  reaction = mix(reaction, pow(reaction, 0.5), u_intensity * 0.6);

  // Color ramp: near-black → burnt orange #FF6B35 → warm white #FFD9A0
  vec3 colA = vec3(0.05, 0.02, 0.0);
  vec3 colB = vec3(1.0, 0.42 + u_hueShift * 0.2, 0.21);
  vec3 colC = vec3(1.0, 0.85, 0.63);
  vec3 color = reaction < 0.5
    ? mix(colA, colB, reaction * 2.0)
    : mix(colB, colC, (reaction - 0.5) * 2.0);

  // Glowing edges: bright at voronoi boundaries
  float edge = 1.0 - smoothstep(0.0, 0.08, c1);
  color += vec3(1.0, 0.5, 0.2) * edge * 0.6;

  // Vignette
  vec2 vigUV = uv - 0.5;
  float vignette = 1.0 - dot(vigUV, vigUV) * 1.5;
  color *= clamp(vignette, 0.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
```

### JS Update Loop
Each frame in `render()`:
```javascript
gl.uniform1f(uTime,      performance.now() / 1000);
gl.uniform1f(uSpeed,     speedSlider.value);
gl.uniform1f(uCellScale, cellScaleSlider.value);
gl.uniform1f(uPulse,     pulseSlider.value);
gl.uniform1f(uHueShift,  hueSlider.value);
gl.uniform2f(uMotionXY,  window.motionData.x, window.motionData.y);
gl.uniform1f(uIntensity, window.motionData.intensity);
gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
```

---

## UI Controls (4 sliders)

Added to HTML overlay, bottom-left corner, translucent dark background:

```html
<div id="controls" style="position:absolute;bottom:20px;left:20px;...">
  <label>Speed <input type="range" id="ctrl-speed" min="0.1" max="2.0" step="0.1" value="1.0"></label>
  <label>Scale <input type="range" id="ctrl-scale" min="0.5" max="3.0" step="0.1" value="1.0"></label>
  <label>Pulse <input type="range" id="ctrl-pulse" min="0.0" max="1.0" step="0.05" value="0.5"></label>
  <label>Orange <input type="range" id="ctrl-hue"   min="0.0" max="1.0" step="0.05" value="0.0"></label>
</div>
```

---

## Remove

- `spawnMeridianParticles()` — replaced by hand/pose particle spawns
- `MERIDIANS` constant — no longer needed
- `beatBurst()` — gesture effects replace beat bursts (or keep as fallback when no hands visible)
- `drawDebug` vestiges — none remain

Keep `MAX_PARTICLES`, `Particle` class, `spawnAmbientParticles()` — all still used.

---

## Success Criteria

- Shader runs at 50fps+ on MacBook
- motionData.x/y visibly warps diffusion origin toward hand position
- motionData.intensity visibly speeds up or brightens reaction on movement
- 6 gestures each produce a distinct visible effect
- Hand/arm particle trails visible when hands are in frame
- Sliders work in real time with no lag
- Existing acupoints, Yin/Yang meter, element badge, TCM readings all still visible on top
