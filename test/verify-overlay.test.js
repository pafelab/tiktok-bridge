/**
 * Automated Verification & Bridge Server Integration Test Suite
 *
 * Verifies:
 * 1. File existence and content integrity of overlays/gift-alert.html:
 *    - Required DOM elements (#alert-card, #gifter-name, #gift-name, #gift-count/#multiplier-badge, #coin-badge, #avatar-img, #gift-img)
 *    - WebSocket endpoint (/tiktok) without ?panel=1
 *    - Web Audio API synthesizer initialization & dual-tone crystal chime frequencies (1046.5Hz, 1567.98Hz)
 *    - Keyframe animations (card-enter, card-exit, gift-float)
 *    - Keyboard test shortcut (KeyT)
 * 2. Script syntax compilation via node:vm new vm.Script(code)
 * 3. Bridge server static serving simulation & HTTP integration:
 *    - Status 200 for /overlays/gift-alert.html
 *    - Content-Type: text/html; charset=utf-8
 *    - Content-Security-Policy: sandbox allow-scripts
 *    - Cache-Control: no-store
 *    - 404 for missing overlays and 403 for path traversal attempts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const OVERLAY_PATH = path.join(REPO_ROOT, 'overlays', 'gift-alert.html');
const SERVER_JS_PATH = path.join(REPO_ROOT, 'server.js');

test.describe('Task 2: Overlay Verification Suite', () => {

  test.describe('1. File Existence & Content Integrity', () => {

    test('overlays/gift-alert.html exists on disk and is non-empty', () => {
      assert.ok(fs.existsSync(OVERLAY_PATH), `Expected ${OVERLAY_PATH} to exist.`);
      const stats = fs.statSync(OVERLAY_PATH);
      assert.ok(stats.isFile(), 'gift-alert.html must be a regular file.');
      assert.ok(stats.size > 500, `Expected gift-alert.html size > 500 bytes, got ${stats.size}`);
    });

    test('contains all required DOM elements for gift alert presentation', () => {
      const html = fs.readFileSync(OVERLAY_PATH, 'utf8');

      const requiredElements = [
        { name: 'Card Container', pattern: /id=["']alert-card["']/ },
        { name: 'Gifter Name', pattern: /id=["']gifter-name["']/ },
        { name: 'Gift Name', pattern: /id=["']gift-name["']/ },
        { name: 'Gift Count / Multiplier', pattern: /id=["'](?:gift-count|multiplier-badge)["']/ },
        { name: 'Coin Badge', pattern: /id=["']coin-badge["']/ },
        { name: 'Avatar Image', pattern: /id=["']avatar-img["']/ },
        { name: 'Gift Icon Image', pattern: /id=["']gift-img["']/ }
      ];

      for (const element of requiredElements) {
        assert.ok(
          element.pattern.test(html),
          `Missing required DOM element: ${element.name} (${element.pattern})`
        );
      }
    });

    test('contains fallback SVG icons for avatar and gift image loading errors', () => {
      const html = fs.readFileSync(OVERLAY_PATH, 'utf8');
      assert.ok(/id=["']avatar-fallback["']/.test(html), 'Missing avatar SVG fallback element.');
      assert.ok(/id=["']gift-fallback["']/.test(html), 'Missing gift SVG fallback element.');
    });

    test('connects to /tiktok WebSocket endpoint without ?panel=1 parameter', () => {
      const html = fs.readFileSync(OVERLAY_PATH, 'utf8');

      // Check for /tiktok endpoint path
      assert.ok(
        /\/tiktok/.test(html),
        'WebSocket connection must point to the /tiktok endpoint.'
      );

      // Verify it does NOT append ?panel=1 so it counts accurately as an OBS overlay
      assert.ok(
        !/\/tiktok\?panel=1/.test(html),
        'Overlay must not connect with ?panel=1 parameter (reserved for admin control panel).'
      );
    });

    test('initializes Web Audio API synthesizer with crystal chime frequencies (1046.5Hz & 1567.98Hz)', () => {
      const html = fs.readFileSync(OVERLAY_PATH, 'utf8');

      // Verify AudioContext instantiation
      assert.ok(
        /AudioContext/.test(html),
        'Must initialize Web Audio API AudioContext.'
      );

      // Verify C6 note frequency (~1046.5Hz)
      assert.ok(
        /1046\.5/.test(html),
        'Must include C6 crystal chime frequency (~1046.5 Hz).'
      );

      // Verify G6 note frequency (~1567.98Hz)
      assert.ok(
        /1567\.98/.test(html),
        'Must include G6 crystal chime frequency (~1567.98 Hz).'
      );

      // Verify exponential ramp envelope for clean decay
      assert.ok(
        /exponentialRampToValueAtTime/.test(html),
        'Must use exponential decay envelope for crystal chime synthesis.'
      );
    });

    test('defines keyframe animations for card entrance, exit, and gift floating', () => {
      const html = fs.readFileSync(OVERLAY_PATH, 'utf8');

      assert.ok(
        /@keyframes\s+card-enter/.test(html),
        'CSS must define @keyframes card-enter animation.'
      );
      assert.ok(
        /@keyframes\s+card-exit/.test(html),
        'CSS must define @keyframes card-exit animation.'
      );
      assert.ok(
        /@keyframes\s+gift-float/.test(html),
        'CSS must define @keyframes gift-float animation.'
      );
    });

    test('includes keyboard shortcut KeyT for test triggering', () => {
      const html = fs.readFileSync(OVERLAY_PATH, 'utf8');

      assert.ok(
        /KeyT/.test(html) || /e\.key\s*===\s*['"]t['"]/i.test(html),
        'Overlay must listen for "KeyT" keyboard event for interactive testing.'
      );
    });
  });

  test.describe('2. Script Syntax Compilation & Execution Safety', () => {

    test('embedded <script> compiles without syntax or parsing errors via node:vm', () => {
      const html = fs.readFileSync(OVERLAY_PATH, 'utf8');
      const scriptMatch = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);

      assert.ok(scriptMatch, 'Could not find <script> tag in gift-alert.html');
      const scriptCode = scriptMatch[1].trim();
      assert.ok(scriptCode.length > 100, 'Embedded script content appears empty or truncated.');

      // Compile using node:vm Script
      let script;
      assert.doesNotThrow(() => {
        script = new vm.Script(scriptCode, { filename: 'overlays/gift-alert.html' });
      }, 'Embedded script failed to compile via vm.Script');

      assert.ok(script, 'vm.Script compilation should return a valid script instance.');
    });

    test('script exports or defines essential client functions', () => {
      const html = fs.readFileSync(OVERLAY_PATH, 'utf8');
      const expectedRoutines = [
        'enqueueGift',
        'renderDonation',
        'processQueue',
        'playChime',
        'connectWs'
      ];

      for (const routine of expectedRoutines) {
        assert.ok(
          html.includes(routine),
          `Script should define core function: ${routine}`
        );
      }
    });
  });

  test.describe('3. Bridge Server Static Serving & CSP Verification', () => {

    test('server.js defines CSP header sandbox allow-scripts and MIME type mapping', () => {
      assert.ok(fs.existsSync(SERVER_JS_PATH), 'server.js must exist.');
      const serverCode = fs.readFileSync(SERVER_JS_PATH, 'utf8');

      // Verify CSP header
      assert.ok(
        /['"]Content-Security-Policy['"]\s*:\s*['"]sandbox allow-scripts['"]|headers\[['"]Content-Security-Policy['"]\]\s*=\s*['"]sandbox allow-scripts['"]/.test(serverCode),
        'server.js must enforce Content-Security-Policy: sandbox allow-scripts for overlays'
      );

      // Verify text/html MIME type
      assert.ok(
        /['"]\.html['"]\s*:\s*['"]text\/html;\s*charset=utf-8['"]/.test(serverCode),
        'server.js must map .html files to text/html; charset=utf-8'
      );
    });

    test('HTTP server serves /overlays/gift-alert.html with 200, correct MIME type and CSP header', async () => {
      const MIME = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png'
      };

      // Create a test server simulating the bridge server's static serving rules
      const server = http.createServer(async (req, res) => {
        let decoded;
        try {
          decoded = decodeURIComponent(req.url);
        } catch {
          res.writeHead(400).end('Bad request');
          return;
        }

        const clean = path.normalize(decoded).replace(/^[/\\]+/, '');
        const target = path.resolve(REPO_ROOT, clean);

        // Path traversal protection
        if (target !== REPO_ROOT && !target.startsWith(REPO_ROOT + path.sep)) {
          res.writeHead(403).end('Forbidden');
          return;
        }

        // Sensitive file protection (config.json, node_modules)
        if (target.endsWith('config.json') || target.includes('node_modules')) {
          res.writeHead(403).end('Forbidden');
          return;
        }

        try {
          const stats = await fs.promises.stat(target);
          if (!stats.isFile()) throw new Error('Not a file');

          const headers = {
            'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
            'Content-Length': stats.size,
            'Cache-Control': 'no-store'
          };

          const overlaysDir = path.join(REPO_ROOT, 'overlays');
          if (target.startsWith(overlaysDir + path.sep) || target === overlaysDir) {
            headers['Content-Security-Policy'] = 'sandbox allow-scripts';
          }

          res.writeHead(200, headers);
          fs.createReadStream(target).pipe(res);
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        }
      });

      // Start on random ephemeral port
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;

      try {
        const response = await fetch(`http://127.0.0.1:${port}/overlays/gift-alert.html`);

        assert.equal(response.status, 200, 'Response status must be 200 OK');
        assert.equal(
          response.headers.get('content-type'),
          'text/html; charset=utf-8',
          'Content-Type header must be text/html; charset=utf-8'
        );
        assert.equal(
          response.headers.get('content-security-policy'),
          'sandbox allow-scripts',
          'Content-Security-Policy header must be sandbox allow-scripts'
        );
        assert.equal(
          response.headers.get('cache-control'),
          'no-store',
          'Cache-Control header must be no-store'
        );

        const body = await response.text();
        assert.ok(body.includes('id="alert-card"'), 'Response body must contain the alert card element');
        assert.equal(
          body,
          fs.readFileSync(OVERLAY_PATH, 'utf8'),
          'Served response body must match the exact file content'
        );

        // Test 404 behavior
        const missingRes = await fetch(`http://127.0.0.1:${port}/overlays/non-existent-overlay.html`);
        assert.equal(missingRes.status, 404, 'Non-existent file should return 404 Not Found');

        // Test 403 path traversal protection
        const forbiddenRes = await fetch(`http://127.0.0.1:${port}/overlays/../config.json`);
        assert.equal(forbiddenRes.status, 403, 'Attempting path traversal to config.json should return 403 Forbidden');
      } finally {
        await new Promise(resolve => server.close(resolve));
      }
    });
  });
});
