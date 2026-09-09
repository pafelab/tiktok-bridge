# Task 3 Brief: Interactive Browser & End-to-End Verification

## Objectives
1. Verify `server.js` static serving behavior and ensure `overlays/gift-alert.html` is accessible both when loaded as a file and when served over HTTP.
2. In `server.js`, if `OVERLAY_ROOT` is `..` and `OVERLAYS_DIR` is `path.join(OVERLAY_ROOT, 'overlays')`, ensure `overlays/gift-alert.html` exists in `OVERLAYS_DIR` or ensure `server.js` serves it properly.
3. Launch `server.js` on port `8899` (or a dedicated test port) in the background.
4. Test:
   - `GET /health`: verify bridge status.
   - `GET /overlays/gift-alert.html`: verify status 200 and Content-Security-Policy headers.
   - WebSocket connection to `/tiktok`: verify connection and check overlay count increases by 1.
   - `GET /test?name=Sarah&gift=Galaxy&count=1&coins=1000`: verify test gift emits `donation` event to connected overlay.
5. Verify keyboard shortcut `T` or visual layout in browser if needed.
6. Record end-to-end verification evidence.

## Report Contract
Write report to `.superpowers/sdd/task-3-report.md`.
