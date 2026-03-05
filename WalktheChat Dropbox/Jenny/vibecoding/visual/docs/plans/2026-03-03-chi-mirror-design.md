# Chi Mirror — Design Doc
**Date:** 2026-03-03
**Project:** Puzzle Acupuncture Clinic SF — Ambient Laptop Experience

---

## Overview

A standalone HTML page that runs on a clinic laptop facing the client. Always-on webcam feed. The client's face becomes a living canvas of TCM energy — meridian particles flow across facial lines, music frequencies activate the Five Elements, and head movement shows Yin/Yang balance in real time.

New file: `chi-mirror.html` (alongside existing `puzzle-cam.html`)

---

## Visual Identity

- **Background:** Dark — near-black (#0D0500), projection-friendly, makes particles pop
- **Primary palette:** Neon orange (#FF6B35), bright coral (#FF4D1C), warm white (#FFF5EE)
- **Element accent colors:** Water = deep blue-violet, Wood = electric green, Fire = orange-red (dominant), Earth = amber-gold, Metal = silver-white
- **Font:** Press Start 2P for labels, IBM Plex Mono for readings (matching puzzle-cam brand)
- **Feel:** Bold, flowing, hypnotic — not chunky/static like puzzle-cam

---

## Architecture

Single HTML file, no server, no dependencies beyond CDN libs.

**Libraries:**
- MediaPipe Face Mesh (CDN) — 468 facial landmark points
- Web Audio API (built-in) — microphone frequency analysis
- Canvas 2D API (built-in) — particle rendering

**Core loop (60fps):**
1. Grab webcam frame
2. Run Face Mesh → get 468 landmarks
3. Analyze microphone → get frequency band levels (5 bands = 5 elements)
4. Track head position delta → compute Yin/Yang score
5. Update particle system → spawn, move, fade particles
6. Render to canvas

---

## TCM Systems

### Five Elements Frequency Mapping
| Element | Frequency Band | Color | Organ |
|---------|---------------|-------|-------|
| Water   | Sub-bass (20–80Hz)   | Blue-violet #6B35FF | Kidney |
| Wood    | Bass (80–250Hz)      | Electric green #35FF6B | Liver |
| Fire    | Mids (250–2kHz)      | Orange-red #FF4D1C | Heart |
| Earth   | Upper mids (2–6kHz)  | Amber gold #FFB835 | Spleen |
| Metal   | Highs (6kHz+)        | Silver white #F0F0FF | Lung |

Active element = loudest band at any moment. Drives particle color + burst behavior.

### Facial Meridian Lines
Particles trace 6 key meridian paths that cross the face (per TCM facial mapping):
- Stomach meridian (ST) — cheekbone down to jaw
- Large Intestine (LI) — nose wings to upper lip
- Triple Warmer (TW) — temple to eye corner
- Bladder (BL) — forehead down nose bridge
- Governing Vessel (GV) — midline forehead
- Conception Vessel (CV) — center chin to lips

Particles flow along these paths continuously. Beat hit = burst of new particles along the active element's meridian.

### Key Face Acupoints (glowing nodes)
6 points pulse in sync with music. Tiny label appears on hover/proximity:
- **Yintang (EX-HN3)** — between eyebrows — "Third Eye, calms Shen"
- **ST3** — below cheekbone — "Stomach Chi, grounds energy"
- **LI20** — beside nostrils — "Opens the lungs, releases grief"
- **BL2** — inner eyebrow — "Clears the head, relieves tension"
- **TW23** — outer eye corner — "Triple Warmer, harmonizes"
- **GV24** — hairline center — "Governing Vessel, lifts spirit"

### Yin/Yang Balance Meter
- Track nose tip (landmark 4) position delta frame-to-frame
- Movement velocity → Yang score (0–100)
- Display as subtle arc meter at bottom
  - Fast movement = excess Yang (warm red indicator)
  - Total stillness = stagnant Qi (grey pulse)
  - Gentle, rhythmic sway = balanced (gold glow)

### Element Reading (passive, always shown)
Bottom corner shows: dominant element + one-line TCM tip. Rotates every 30 seconds or when element changes.

Examples:
- Fire active: "Heart energy rising — stay present, breathe"
- Water active: "Kidney chi flowing — rest is medicine"
- Wood active: "Liver awake — let the tension move through"
- Earth active: "Spleen grounded — nourish yourself today"
- Metal active: "Lung clarity — release what no longer serves"

### Chi Scan (3-second hold-still trigger)
When face is detected and head is still for 3 continuous seconds:
1. Dramatic particle sweep radiates outward from face
2. All 6 acupoints light up simultaneously
3. "Dominant element" confirmed with full-screen flash of element color
4. Reading updates to a fresh tip

---

## Layout

Full-screen canvas. Minimal UI overlay:
- Top-left: Puzzle Acupuncture logo (small, unobtrusive)
- Top-right: Active element badge (icon + name, updates live)
- Bottom: Yin/Yang arc meter (centered) + element reading text
- Acupoint labels: appear as small floating tags near the point, fade in/out

No start button. Page loads → camera auto-starts → experience begins.

---

## Success Criteria

- Runs smoothly at 30fps+ on a standard MacBook
- Visually compelling on empty frame (no face) — particles still flow as ambient
- Clients understand what they're looking at within 10 seconds without explanation
- Bold colors — nothing washed out or pastel
- Flowing — no hard cuts or choppy transitions, everything eases

---

## Out of Scope

- No Stable Diffusion / image generation
- No TouchDesigner / Syphon / Resolume integration
- No backend / data storage
- No user accounts
