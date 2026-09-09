import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

const TEST_PORT = 8999;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runE2E() {
    console.log('Starting end-to-end integration test for TikTok Gift Alert Overlay...');

    // Launch server.js with test port
    const serverProc = spawn('node', ['server.js'], {
        env: { ...process.env, BRIDGE_PORT: String(TEST_PORT), TIKTOK_USERNAME: 'testuser' },
        stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    serverProc.stdout.on('data', d => { stdout += d.toString(); });
    serverProc.stderr.on('data', d => { stderr += d.toString(); });

    try {
        // Wait for server to listen
        let ready = false;
        for (let i = 0; i < 30; i++) {
            await sleep(200);
            try {
                const res = await fetch(`http://localhost:${TEST_PORT}/health`);
                if (res.ok) {
                    ready = true;
                    break;
                }
            } catch {
                // Keep waiting
            }
        }
        assert.ok(ready, `Server failed to start in time. Stderr: ${stderr}`);
        console.log('✓ Bridge server started and responding on port', TEST_PORT);

        // 1. Health check
        const healthRes = await fetch(`http://localhost:${TEST_PORT}/health`);
        const health = await healthRes.json();
        assert.equal(health.username, 'testuser');
        console.log('✓ /health returns username: testuser');

        // 2. Fetch overlay page over HTTP
        const overlayRes = await fetch(`http://localhost:${TEST_PORT}/overlays/gift-alert.html`);
        assert.equal(overlayRes.status, 200, 'Overlay page should return 200 OK');
        assert.match(overlayRes.headers.get('content-type') || '', /text\/html/);
        assert.equal(overlayRes.headers.get('content-security-policy'), 'sandbox allow-scripts');
        const overlayHtml = await overlayRes.text();
        assert.ok(overlayHtml.includes('id="alert-card"'), 'Overlay HTML contains alert card');
        assert.ok(overlayHtml.includes('id="gifter-name"'), 'Overlay HTML contains gifter name');
        assert.ok(overlayHtml.includes('id="gift-name"'), 'Overlay HTML contains gift name');
        console.log('✓ /overlays/gift-alert.html served successfully with 200 OK and CSP');

        // 3. Check /api/overlays listing in control panel
        const overlaysListRes = await fetch(`http://localhost:${TEST_PORT}/api/overlays`);
        const overlaysList = await overlaysListRes.json();
        assert.ok(Array.isArray(overlaysList.overlays), 'Overlays should be an array');
        const found = overlaysList.overlays.find(o => o.file === 'gift-alert.html');
        assert.ok(found, 'gift-alert.html should be listed in /api/overlays');
        console.log('✓ gift-alert.html appears in control panel overlay list');

        // 4. Connect WebSocket client
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/tiktok`);
        const messages = [];

        await new Promise((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });
        console.log('✓ WebSocket connected to /tiktok');

        ws.on('message', data => {
            try {
                messages.push(JSON.parse(data.toString()));
            } catch (e) {
                console.error('Failed to parse WS message:', e);
            }
        });

        // Verify hello message received
        await sleep(150);
        assert.ok(messages.length >= 1, 'Should receive hello message');
        assert.equal(messages[0].type, 'hello');
        assert.equal(messages[0].source, 'tiktok');
        console.log('✓ Received hello handshake from bridge');

        // Verify overlayCount is now 1
        const countRes = await fetch(`http://localhost:${TEST_PORT}/health`);
        const countData = await countRes.json();
        assert.equal(countData.overlaysConnected, 1, 'Bridge should count 1 overlay connected');
        console.log('✓ Bridge correctly tallies overlay count = 1');

        // 5. Trigger a test gift
        const testRes = await fetch(`http://localhost:${TEST_PORT}/test?name=Ammaret&gift=Galaxy&count=3&coins=3000`);
        assert.equal(testRes.status, 200);
        const testJson = await testRes.json();
        assert.equal(testJson.ok, true);
        console.log('✓ /test gift triggered successfully');

        // Wait for donation event on WebSocket
        await sleep(200);
        const donationMsg = messages.find(m => m.type === 'donation');
        assert.ok(donationMsg, 'Should receive donation message on WebSocket');
        assert.equal(donationMsg.donation.name, 'Ammaret');
        assert.equal(donationMsg.donation.giftName, 'Galaxy');
        assert.equal(donationMsg.donation.giftCount, 3);
        assert.equal(donationMsg.donation.giftCoins, 3000);
        assert.ok(donationMsg.donation.formatted_amount);
        console.log('✓ Overlay received donation event:', JSON.stringify(donationMsg.donation.giftLine));

        // Cleanup
        ws.close();
        console.log('\nAll End-to-End Integration Tests PASSED perfectly!');
    } finally {
        serverProc.kill();
    }
}

runE2E().catch(err => {
    console.error('\nTest Failed:', err);
    process.exit(1);
});
