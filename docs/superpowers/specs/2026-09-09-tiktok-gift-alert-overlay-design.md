# TikTok Gift & Gifter Alert Overlay Design Specification

**Date**: 2026-09-09  
**Status**: Approved  
**Topic**: TikTok Gift and Gifter Name HTML Overlay  

## 1. Overview & Objective
Create an HTML overlay file (`overlays/gift-alert.html`) that integrates with the local TikTok Live gift bridge (`server.js`). The overlay listens for incoming gifts over a local WebSocket, displays animated alert cards showing the gifter's name, avatar, gift graphic, quantity multiplier, and coin amount in a modern TikTok neon glassmorphism style, plays a synthesized audio chime via Web Audio API, and manages gift bursts via an orderly FIFO queue.

---

## 2. Architecture & File Placement

### 2.1 File Location
- File: `overlays/gift-alert.html`
- When accessed through the bridge's HTTP server: `http://localhost:8899/overlays/gift-alert.html`
- When loaded as an OBS local file: `file:///.../overlays/gift-alert.html`

### 2.2 WebSocket Communication
- **Protocol**: `ws://` (or `wss://` if hosted on HTTPS)
- **Target URL**: Auto-resolved from `location.host` when loaded over HTTP, with fallback to `127.0.0.1:8899` when loaded locally (`file://`).
- **Endpoint**: `/tiktok` (without `?panel=1` so OBS connections are tallied accurately by the bridge's `overlayCount()`).
- **Event Handling**:
  - `open`: Logs connection status; marks overlay ready.
  - `message`: Parses JSON payload. When `payload.type === 'donation'` and `payload.donation` exists, passes the donation object to the alert queue.
  - `close` & `error`: Triggers auto-reconnection loop every 3 seconds to survive bridge restarts without requiring OBS source reload.

---

## 3. Data Schema & Payload Extraction

The bridge (`server.js`) emits `donation` objects with the following properties:
- `name` (string): Viewer / gifter's display name or nickname.
- `avatar` (string URL): Viewer's TikTok profile picture.
- `giftName` (string): Name of the gift (e.g., "Rose", "Galaxy", "Universe").
- `giftCount` (number): Quantity in the streak/batch (e.g., 50).
- `giftCoins` (number): Total diamond / coin value.
- `giftImage` (string URL): TikTok gift icon image.
- `formatted_amount` (string): Formatted coins or currency string (e.g., `"COINS 1,000"`).
- `message` (string): Streamer comment or generated template text.

Fallback values:
- Missing avatar: Inline SVG circular avatar placeholder with neon accent.
- Missing gift image: Inline gift badge / icon.
- Missing message: Defaults to `"{giftName} ×{giftCount}"`.

---

## 4. UI & Visual Design

### 4.1 Aesthetic: Modern TikTok Neon & Dark Glass
- **Canvas**: Transparent (`background: transparent`), zero margins, full viewport `100vw` / `100vh` for seamless OBS placement.
- **Card Styling**:
  - Background: `rgba(15, 20, 30, 0.88)` with `backdrop-filter: blur(16px)`.
  - Border: 2px gradient border with subtle animation blending TikTok Cyan (`#25f4ee`) and TikTok Magenta (`#fe2c55`).
  - Glow: Soft multi-layered `box-shadow` (`0 8px 32px rgba(0, 0, 0, 0.45), 0 0 20px rgba(37, 244, 238, 0.2)`).
  - Border Radius: 20px pill/card.
- **Layout Elements**:
  1. **Avatar Box**: 64×64px circular avatar with glowing cyan/pink border ring.
  2. **Info Box**:
     - Eyebrow tag: `TIKTOK GIFT` in uppercase tracking font with pink badge.
     - Gifter Name: 20px bold font (`Montserrat`, `system-ui`), glowing white with drop shadow.
     - Action & Gift: `"sent "` + gift name in vibrant cyan.
     - Optional comment/message: 13px italic ivory text.
  3. **Badge & Icon Box**:
     - Gift icon: 60×60px with floating float/wobble keyframe animation.
     - Multiplier pill: Glowing pink badge with `×{count}`.
     - Coin pill: Golden badge with coin icon and formatted amount.

### 4.2 Animations
- **Entrance**: `card-enter` (0.5s `cubic-bezier(0.34, 1.56, 0.64, 1)`): translate from `translateY(30px) scale(0.9)` to `translateY(0) scale(1)` with opacity from `0` to `1`.
- **Active Hold**: 5-second duration with subtle breathing glow and floating gift image.
- **Exit**: `card-exit` (0.4s ease-in): `translateY(-20px) scale(0.95)` with opacity fading to `0`.

---

## 5. Queue & Audio Management

### 5.1 FIFO Queue
- Holds pending gift alerts during rapid bursts (e.g. roses or streak gifts).
- Ensures each gift receives minimum 4.5s – 5s screen time under normal conditions.
- When queue length > 5, dynamically tightens display duration down to 3s to keep alerts current without visual clutter.
- Maximum queue capacity: 30 items (oldest non-rare gifts dropped if capacity exceeded during spam events).

### 5.2 Web Audio API Chime
- Built-in synthesizer using `AudioContext`, requiring zero external sound files.
- Generates a dual-tone crystal chime (C6 ~1046.5 Hz and G6 ~1567.98 Hz) with soft envelope attack and gentle exponential decay.
- Configurable via URL query parameters:
  - `?sound=0`: Mutes sound.
  - `?volume=0.5`: Adjusts volume between 0 and 1.
  - `?duration=4`: Overrides display seconds per alert.

### 5.3 In-Browser Testing Fallback
- Pressing key `T` on keyboard generates and displays a simulated gift alert (e.g. "Alex sent Galaxy ×1 (1,000 coins)").
- Full compatibility with the bridge control panel's `/test` and `/api/test` triggers.

---

## 6. Testing & Verification Plan
1. Standalone Verification: Open `overlays/gift-alert.html` in browser, press `T`, observe card animation, layout, typography, and audio chime.
2. Bridge Integration: Launch bridge server (`node server.js`), trigger test gift via control panel / `/test` or terminal `T`, verify WebSocket connection count increments by 1, and alert card appears with gift data.
3. Burst Queuing: Rapidly trigger multiple test gifts; verify sequential processing without clipping.
4. OBS Studio Browser Source: Add `http://localhost:8899/overlays/gift-alert.html` as browser source, verify transparency and visual rendering over test stream backgrounds.
