# TikTok Gift & Gifter Alert Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an HTML stream overlay (`overlays/gift-alert.html`) that connects to the local TikTok bridge WebSocket, displaying animated neon glassmorphic alert cards with gifter name, avatar, gift icon, multiplier, coin amount, and synthesized Web Audio chime.

**Architecture:** A standalone, dependency-free HTML/CSS/JavaScript page placed in the `overlays/` folder. It connects to `ws://localhost:8899/tiktok` (dynamically detecting host), processes incoming `donation` events, queues rapid gift bursts into a FIFO queue, plays a synthesized chime via Web Audio API, and renders animated visual alert cards designed for OBS Studio browser sources.

**Tech Stack:** HTML5, CSS3 (Keyframe animations, Flexbox, Glassmorphism backdrop-filter), Vanilla JavaScript (WebSocket API, Web Audio API).

## Global Constraints
- Target File: `overlays/gift-alert.html`
- Server port default: `8899`
- WebSocket path: `/tiktok` (without `?panel=1` so OBS overlay counts accurately)
- Pure client-side zero-dependency audio synthesis (no external audio files required)
- Auto-reconnect every 3 seconds if WebSocket drops

---

### Task 1: Create `overlays/gift-alert.html` with Neon Glassmorphism UI, Audio Synthesis, and Queue Logic

**Files:**
- Create: `overlays/gift-alert.html`

**Interfaces:**
- Consumes: WebSocket messages from `/tiktok`:
  ```json
  {
    "type": "donation",
    "source": "tiktok",
    "donation": {
      "name": "Sarah",
      "avatar": "https://...",
      "giftName": "Galaxy",
      "giftCount": 1,
      "giftCoins": 1000,
      "giftImage": "https://...",
      "formatted_amount": "COINS 1,000",
      "message": "Galaxy ×1"
    }
  }
  ```
- Produces: Visual alert card and audio chime on gift events, plus keyboard test trigger (`T`).

- [ ] **Step 1: Create the directory `overlays`**

Run:
```powershell
New-Item -ItemType Directory -Force -Path "overlays"
```

- [ ] **Step 2: Create `overlays/gift-alert.html`**

Create `overlays/gift-alert.html` with:
- Embedded Google Fonts (`Montserrat`, `Outfit`, `Inter`)
- Transparent canvas (`background: transparent`)
- Dark glassmorphic card with animated cyan/pink TikTok gradient border and glow
- Avatar frame with glowing neon border and SVG fallback
- Gifter name, eyebrow "TIKTOK GIFT", gift action text, and message
- Gift icon with floating animation and SVG fallback
- Multiplier badge (`×{count}`) and coin amount badge
- Web Audio API dual-tone chime generator
- FIFO alert queue with burst speed-up
- Auto-reconnecting WebSocket client
- Keyboard shortcut `T` for instant local browser testing

- [ ] **Step 3: Verify the file exists and has valid HTML syntax**

Run:
```powershell
Test-Path "overlays/gift-alert.html"
```
Expected: `True`

- [ ] **Step 4: Commit the overlay implementation**

```bash
git add overlays/gift-alert.html
git commit -m "feat: add TikTok gift & gifter alert overlay with neon glassmorphism and web audio chime"
```

---

### Task 2: Automated Verification and Bridge Server Integration Test

**Files:**
- Create: `test/verify-overlay.test.js`

**Interfaces:**
- Tests `overlays/gift-alert.html` content integrity, ensuring:
  - Valid HTML document structure
  - WebSocket connection logic to `/tiktok`
  - Web Audio synthesizer functions
  - Queue mechanism and event listeners
  - Keyboard trigger `T` handling
- Tests server static serving:
  - Verifies `server.js` serves `/overlays/gift-alert.html` with status 200 and Content-Security-Policy headers

- [ ] **Step 1: Write verification test script**

Create `test/verify-overlay.test.js` using Node.js built-in `node:test` and `node:assert`.

- [ ] **Step 2: Run verification tests**

Run:
```powershell
node test/verify-overlay.test.js
```
Expected: All tests pass with exit code 0.

- [ ] **Step 3: Commit verification test suite**

```bash
git add test/verify-overlay.test.js
git commit -m "test: add verification test suite for gift alert overlay"
```

---

### Task 3: Interactive Browser & End-to-End Verification

- [ ] **Step 1: Start bridge server temporarily**

Run server and verify it serves `/overlays/gift-alert.html`:
```powershell
$proc = Start-Process node -ArgumentList "server.js" -PassThru
Start-Sleep -Seconds 2
Invoke-WebRequest -Uri "http://localhost:8899/overlays/gift-alert.html" | Select-Object -ExpandProperty StatusCode
Stop-Process -Id $proc.Id
```
Expected: Status code 200.

- [ ] **Step 2: Test gift trigger check**

Verify test gift endpoint `/test` produces a formatted donation payload that matches the overlay's expected fields.

- [ ] **Step 3: Remove test artifacts and commit final verification**
