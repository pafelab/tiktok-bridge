/**
 * Black Swan — TikTok LIVE gift bridge
 *
 * Connects to a TikTok LIVE room, turns gifts into donation cards, and pushes them
 * to the Black Swan overlay over a local WebSocket.
 *
 * Run it with start.bat (Windows) or `node server.js`.
 * Everything you can tune lives in config.json — see README.md in this folder.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import {
    TikTokLiveConnection,
    WebcastEvent,
    ControlEvent,
    SignConfig,
    SignatureRateLimitError,
    UserOfflineError
} from 'tiktok-live-connector';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY_ROOT = path.resolve(HERE, '..');
const CONFIG_PATH = path.join(HERE, 'config.json');
const OVERLAY_PAGE = '/donate%20board.html';

const DEFAULTS = {
    tiktokUsername: '',
    port: 8899,
    minCoins: 1,
    amountMode: 'coins',
    currency: 'THB',
    coinValue: 0.35,
    messageTemplate: '{gift} ×{count}',
    useRecentComment: true,
    recentCommentWindowSeconds: 90,
    eyebrowText: 'TikTok gift',
    showGiftIcon: true,
    signApiKey: '',
    openPanel: true
};

// What the control panel is allowed to change. port needs a restart; the rest
// take effect on the very next gift because toDonation reads config each time.
const EDITABLE = [
    'tiktokUsername', 'port', 'minCoins', 'amountMode', 'currency', 'coinValue',
    'messageTemplate', 'useRecentComment', 'recentCommentWindowSeconds',
    'eyebrowText', 'showGiftIcon', 'signApiKey', 'openPanel'
];

/* ------------------------------------------------------------------ logging */

const colour = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const paint = (code, text) => (colour ? `\u001b[${code}m${text}\u001b[0m` : text);
const gold = text => paint('33', text);
const dim = text => paint('90', text);
const good = text => paint('32', text);
const bad = text => paint('31', text);

const stamp = () => new Date().toLocaleTimeString();
const say = (...parts) => console.log(dim(stamp()), ...parts);
const warn = (...parts) => console.log(dim(stamp()), bad('!'), ...parts);

/* ------------------------------------------------------------------- config */

function coerce(raw) {
    const config = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
    config.port = Number(config.port) || DEFAULTS.port;
    config.minCoins = Math.max(0, Number(config.minCoins) || 0);
    config.coinValue = Math.max(0, Number(config.coinValue) || 0);
    config.recentCommentWindowSeconds = Math.max(0, Number(config.recentCommentWindowSeconds) || 0);
    config.amountMode = config.amountMode === 'currency' ? 'currency' : 'coins';
    config.useRecentComment = config.useRecentComment !== false;
    config.showGiftIcon = config.showGiftIcon !== false;
    config.openPanel = config.openPanel !== false;
    config.tiktokUsername = String(config.tiktokUsername || '').trim().replace(/^@/, '');
    return config;
}

async function loadConfig() {
    let raw = {};
    try {
        raw = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') {
            warn(`config.json has a typo, so none of your settings are being used.`);
            console.log(dim(`  ${error.message}`));
            console.log(dim('  Fix it and start again, or delete the file to reset it to the defaults.'));
        }
    }
    const fromArgs = process.argv.slice(2).join(' ').match(/--user(?:name)?[= ]@?([\w.\-]+)/i);
    if (fromArgs) raw.tiktokUsername = fromArgs[1];
    if (process.env.TIKTOK_USERNAME) raw.tiktokUsername = process.env.TIKTOK_USERNAME;
    // Lets a second copy run on another port without editing config.json.
    if (process.env.BRIDGE_PORT) raw.port = process.env.BRIDGE_PORT;
    return coerce(raw);
}

async function askForUsername() {
    if (!process.stdin.isTTY) return '';
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
        rl.question(gold('\n  Which TikTok account are you streaming from? ') + dim('(e.g. @yourname) '), resolve);
    });
    rl.close();
    return String(answer || '').trim().replace(/^@/, '');
}

async function rememberUsername(username) {
    let stored = {};
    try {
        stored = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') {
            // The file exists but will not parse. Rewriting it here would quietly
            // throw away every setting the streamer had typed, so leave it alone.
            warn('config.json has a typo in it, so your settings were left untouched.');
            console.log(dim(`  Fix the file and set "tiktokUsername": "${username}" in it yourself,`));
            console.log(dim('  or delete config.json to start again from the defaults.'));
            return;
        }
    }
    stored.tiktokUsername = username;
    await writeFile(CONFIG_PATH, JSON.stringify({ ...DEFAULTS, ...stored }, null, 4) + '\n', 'utf8');
    say(`Saved @${username} to config.json.`);
}

/* -------------------------------------------------------------- gift -> card */

const numbers = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function firstUrl(image) {
    const list = image && Array.isArray(image.urlList) ? image.urlList : [];
    const url = list.find(entry => typeof entry === 'string' && /^https:\/\//i.test(entry));
    return url || '';
}

function formatAmount(coins, config) {
    if (config.amountMode === 'currency' && config.coinValue > 0) {
        const currency = String(config.currency || 'THB').slice(0, 8);
        return `${currency} ${numbers.format(coins * config.coinValue)}`;
    }
    return `COINS ${numbers.format(coins)}`;
}

function fillTemplate(template, values) {
    return String(template || '').replace(/\{(\w+)\}/g, (match, key) =>
        Object.hasOwn(values, key) ? String(values[key]) : match);
}

/**
 * Build the payload the overlay understands. The TikTok-only fields are additive —
 * the overlay ignores anything it does not recognise, so Streamlabs keeps working.
 */
function toDonation(gift, config, recentComment) {
    const giftName = String(gift.giftName || 'Gift').trim() || 'Gift';
    const count = Math.max(1, gift.count);
    const giftLine = fillTemplate(config.messageTemplate, {
        gift: giftName,
        count,
        coins: numbers.format(gift.coins),
        name: gift.name
    });
    const asCurrency = config.amountMode === 'currency' && config.coinValue > 0;
    return {
        name: gift.name,
        formatted_amount: formatAmount(gift.coins, config),
        amount: asCurrency ? Number((gift.coins * config.coinValue).toFixed(2)) : gift.coins,
        currency: asCurrency ? config.currency : 'COINS',
        message: recentComment || giftLine,
        platform: 'tiktok',
        eyebrow: fillTemplate(config.eyebrowText, { gift: giftName, count, name: gift.name }),
        giftName,
        giftCount: count,
        giftCoins: gift.coins,
        giftImage: config.showGiftIcon ? gift.giftImage : '',
        avatar: gift.avatar,
        giftLine,
        id: gift.id
    };
}

/* -------------------------------------------------------------- broadcaster */

const clients = new Set();
const panels = new Set();
const recentGifts = [];
let sent = 0;

// The control panel shares the gift socket, so it must not count as an overlay.
const overlayCount = () => clients.size - panels.size;

function broadcast(payload) {
    const frame = JSON.stringify(payload);
    for (const client of clients) {
        if (client.readyState === 1) client.send(frame);
    }
}

function publishDonation(donation) {
    sent += 1;
    // Kept so the control panel can show what has already happened when it opens.
    recentGifts.unshift({ ...donation, at: new Date().toISOString() });
    if (recentGifts.length > 40) recentGifts.pop();
    broadcast({ type: 'donation', source: 'tiktok', donation });
    const reach = `${overlayCount()} overlay${overlayCount() === 1 ? '' : 's'}`;
    say(good('gift'), `${donation.name} — ${donation.giftLine} (${donation.giftCoins} coins) ${dim('-> ' + reach)}`);
}

/* --------------------------------------------------------- TikTok connection */

const seenMessages = new Set();
const seenOrder = [];
const recentComments = new Map();

function alreadyHandled(id) {
    if (!id) return false;
    if (seenMessages.has(id)) return true;
    seenMessages.add(id);
    seenOrder.push(id);
    if (seenOrder.length > 300) seenMessages.delete(seenOrder.shift());
    return false;
}

function takeRecentComment(userId, config) {
    if (!config.useRecentComment || !userId) return '';
    const entry = recentComments.get(userId);
    if (!entry) return '';
    recentComments.delete(userId);
    const age = (Date.now() - entry.at) / 1000;
    return age <= config.recentCommentWindowSeconds ? entry.text : '';
}

function describeError(value) {
    if (!value) return 'unknown error';
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message;
    const inner = value.exception || value.error;
    const detail = inner instanceof Error ? inner.message : (inner && inner.message) || '';
    const info = typeof value.info === 'string' ? value.info : '';
    if (!info || info === detail) return detail || info || 'unknown error';
    return detail ? `${info} - ${detail}` : info;
}

function createBridge(config) {
    let connection = null;
    let retryTimer = null;
    let attempt = 0;
    let stopping = false;
    const status = { connected: false, roomId: '', since: null, lastError: '' };

    function scheduleReconnect(seconds, why) {
        if (stopping || retryTimer) return;
        const wait = Math.max(3, Math.round(seconds));
        say(dim(`Retrying in ${wait}s — ${why}`));
        retryTimer = setTimeout(() => {
            retryTimer = null;
            start();
        }, wait * 1000);
    }

    function handleGift(data) {
        // TikTok fires one event per repeat for streakable gifts (gift.type === 1).
        // Waiting for repeatEnd turns a "Rose x50" streak into ONE card, not fifty.
        const streakable = data?.gift?.type === 1;
        const streakFinished = data?.repeatEnd === 1 || data?.repeatEnd === true;
        if (streakable && !streakFinished) return;

        const messageId = data?.common?.msgId || '';
        if (alreadyHandled(messageId)) return;

        const perGift = Number(data?.gift?.diamondCount) || 0;
        const count = Math.max(1, Number(data?.repeatCount) || 1);
        const coins = perGift * count;
        if (coins < config.minCoins) {
            say(dim(`skipped ${data?.gift?.name || 'gift'} (${coins} coins, under minCoins ${config.minCoins})`));
            return;
        }

        const user = data?.user || {};
        publishDonation(toDonation({
            name: String(user.nickname || user.displayId || 'A TikTok friend').trim() || 'A TikTok friend',
            giftName: data?.gift?.name,
            count,
            coins,
            giftImage: firstUrl(data?.gift?.image) || firstUrl(data?.gift?.icon),
            avatar: firstUrl(user.avatarThumb) || firstUrl(user.avatarMedium),
            id: messageId || `${user.id || 'anon'}-${data?.groupId || ''}-${coins}`
        }, config, takeRecentComment(user.id, config)));
    }

    function handleChat(data) {
        if (!config.useRecentComment) return;
        const userId = data?.user?.id;
        const text = String(data?.content || '').trim();
        if (!userId || !text) return;
        recentComments.set(userId, { text: text.slice(0, 500), at: Date.now() });
        if (recentComments.size > 400) recentComments.delete(recentComments.keys().next().value);
    }

    function dropConnection() {
        try {
            connection?.disconnect?.();
        } catch {
            // Already gone — nothing to tidy up.
        }
        connection?.removeAllListeners?.();
        connection = null;
    }

    async function start() {
        if (stopping) return;
        dropConnection();
        connection = new TikTokLiveConnection(config.tiktokUsername, {
            processInitialData: false,      // don't replay gifts sent before the bridge started
            fetchRoomInfoOnConnect: true,   // fail fast with UserOfflineError when nobody is live
            enableExtendedGiftInfo: false,  // gift name, icon and coin value already ride on the event
            ...(config.signApiKey ? { signApiKey: config.signApiKey } : {})
        });

        connection.on(WebcastEvent.GIFT, handleGift);
        connection.on(WebcastEvent.CHAT, handleChat);
        connection.on(ControlEvent.ERROR, event => {
            // The library reports errors as { info, exception }, not as an Error.
            status.lastError = describeError(event);
            warn(dim(`stream error: ${status.lastError}`));
        });
        connection.on(WebcastEvent.STREAM_END, () => {
            status.connected = false;
            say('The LIVE ended. Waiting for the next one.');
            scheduleReconnect(30, 'stream ended');
        });
        connection.on(ControlEvent.DISCONNECTED, () => {
            if (!status.connected) return;
            status.connected = false;
            say('Disconnected from TikTok.');
            scheduleReconnect(10, 'connection dropped');
        });

        say(`Connecting to ${gold('@' + config.tiktokUsername)}...`);
        try {
            const state = await connection.connect();
            attempt = 0;
            status.connected = true;
            status.roomId = state?.roomId || '';
            status.since = new Date().toISOString();
            status.lastError = '';
            const room = status.roomId ? dim(` (room ${status.roomId})`) : '';
            console.log(`${dim(stamp())} ${good('Connected')} to @${config.tiktokUsername}${room}. Gifts will appear on the overlay.`);
        } catch (error) {
            status.connected = false;
            status.lastError = describeError(error);
            if (error instanceof UserOfflineError) {
                say(`@${config.tiktokUsername} is not live right now.`);
                scheduleReconnect(30, 'waiting for the LIVE to start');
                return;
            }
            if (error instanceof SignatureRateLimitError) {
                warn(`Rate limited by the signing service. ${dim('A free Euler Stream key in config.json raises this limit.')}`);
                scheduleReconnect(error.retryAfter || 60, 'rate limited');
                return;
            }
            attempt += 1;
            warn(`Could not connect: ${status.lastError}`);
            scheduleReconnect(Math.min(60, 5 * 2 ** (attempt - 1)), 'connection failed');
        }
    }

    return {
        status,
        start,
        // Used when the panel changes the account, so the new one connects at once.
        async restart() {
            clearTimeout(retryTimer);
            retryTimer = null;
            stopping = false;
            attempt = 0;
            status.connected = false;
            status.lastError = '';
            await start();
        },
        stop() {
            stopping = true;
            clearTimeout(retryTimer);
            try {
                connection?.disconnect?.();
            } catch {
                // Already gone — nothing to tidy up.
            }
        }
    };
}

/* --------------------------------------------------------------- test gifts */

const SAMPLE_GIFTS = [
    { giftName: 'Rose', coins: 1, count: 50 },
    { giftName: 'Finger Heart', coins: 5, count: 1 },
    { giftName: 'Galaxy', coins: 1000, count: 1 },
    { giftName: 'Universe', coins: 34999, count: 1 }
];
let sampleIndex = -1;

function sendTestGift(config, overrides = {}) {
    sampleIndex = (sampleIndex + 1) % SAMPLE_GIFTS.length;
    const sample = SAMPLE_GIFTS[sampleIndex];
    const count = Math.max(1, Number(overrides.count) || sample.count);
    const coins = Number.isFinite(Number(overrides.coins)) && overrides.coins !== undefined && overrides.coins !== ''
        ? Math.max(0, Number(overrides.coins))
        : sample.coins * count;
    const donation = toDonation({
        name: String(overrides.name || 'Test Viewer').slice(0, 100),
        giftName: overrides.gift || sample.giftName,
        count,
        coins,
        giftImage: '',
        avatar: '',
        id: `test-${sampleIndex}-${coins}-${count}`
    }, config, String(overrides.message || '').slice(0, 500));
    publishDonation(donation);
    return donation;
}

/* ----------------------------------------------------------- static server */

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.gif': 'image/gif',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2'
};

async function serveFile(requestPath, response) {
    let decoded;
    try {
        decoded = decodeURIComponent(requestPath);
    } catch {
        response.writeHead(400).end('Bad request');
        return;
    }
    const target = path.resolve(OVERLAY_ROOT, '.' + path.normalize(decoded).replace(/^[/\\]+/, path.sep));
    if (target !== OVERLAY_ROOT && !target.startsWith(OVERLAY_ROOT + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
    }
    // This folder holds config.json — including any sign key — and node_modules.
    // The overlay never needs anything from it, so it is never served.
    if (target === HERE || target.startsWith(HERE + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
    }
    try {
        const info = await stat(target);
        if (!info.isFile()) throw new Error('not a file');
        response.writeHead(200, {
            'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
            'Content-Length': info.size,
            'Cache-Control': 'no-store'
        });
        // The headers are already out, so a read failure now can only be abandoned —
        // but it must be handled, or the stream takes the whole bridge down with it.
        const file = createReadStream(target);
        file.on('error', error => {
            warn(dim(`could not finish sending ${path.basename(target)}: ${error.message}`));
            response.destroy();
        });
        file.pipe(response);
    } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
}

/**
 * /test puts text straight onto the live stream, so only allow it from a URL the
 * streamer opened themselves. A link on someone else's page arrives as a cross-site
 * navigation; typing the address or opening it from the overlay does not.
 */
function askedForByTheStreamer(request) {
    const site = request.headers['sec-fetch-site'];
    if (site && site !== 'none' && site !== 'same-origin') return false;
    const from = request.headers.origin || request.headers.referer;
    if (!from) return true;
    try {
        return new URL(from).host === request.headers.host;
    } catch {
        return false;
    }
}

function readJsonBody(request) {
    return new Promise(resolve => {
        let body = '';
        let tooBig = false;
        request.on('data', chunk => {
            body += chunk;
            if (body.length > 20000) {
                tooBig = true;
                request.destroy();
            }
        });
        request.on('end', () => {
            if (tooBig) return resolve(null);
            try {
                resolve(JSON.parse(body || '{}'));
            } catch {
                resolve(null);
            }
        });
        request.on('error', () => resolve(null));
    });
}

function sendJson(response, status, payload) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(payload, null, 2));
}

function createHttpServer(config, bridge) {
    const panelPage = path.join(HERE, 'panel.html');

    async function sendPanel(response) {
        try {
            const page = await readFile(panelPage);
            response.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Length': page.length,
                'Cache-Control': 'no-store'
            });
            response.end(page);
        } catch {
            response.writeHead(302, { Location: OVERLAY_PAGE }).end();
        }
    }

    return createServer(async (request, response) => {
        let url;
        try {
            url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
        } catch {
            response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Bad request');
            return;
        }

        const route = url.pathname;

        if (route === '/' || route === '/panel') {
            await sendPanel(response);
            return;
        }
        if (route === '/overlay') {
            response.writeHead(302, { Location: OVERLAY_PAGE }).end();
            return;
        }
        if (route === '/health') {
            sendJson(response, 200, {
                username: config.tiktokUsername,
                tiktok: bridge.status,
                overlaysConnected: overlayCount(),
                giftsSent: sent
            });
            return;
        }
        if (route === '/api/state') {
            sendJson(response, 200, {
                config: Object.fromEntries(EDITABLE.map(key => [key, config[key]])),
                tiktok: bridge.status,
                overlaysConnected: overlayCount(),
                giftsSent: sent,
                gifts: recentGifts,
                overlayUrl: `http://localhost:${config.port}${OVERLAY_PAGE}`,
                now: new Date().toISOString()
            });
            return;
        }

        // Everything past here changes something, so it must come from the streamer.
        const writing = route === '/test' || route.startsWith('/api/');
        if (writing && !askedForByTheStreamer(request)) {
            warn(dim(`another website tried to use ${route} and was ignored.`));
            sendJson(response, 403, { ok: false, error: 'This can only be used from this machine, not from another website.' });
            return;
        }

        if (route === '/test') {
            const donation = sendTestGift(config, Object.fromEntries(url.searchParams));
            sendJson(response, 200, { ok: true, overlaysConnected: overlayCount(), donation });
            return;
        }
        if (route === '/api/test' && request.method === 'POST') {
            const body = await readJsonBody(request);
            const donation = sendTestGift(config, body || {});
            sendJson(response, 200, { ok: true, overlaysConnected: overlayCount(), donation });
            return;
        }
        if (route === '/api/reconnect' && request.method === 'POST') {
            sendJson(response, 200, { ok: true });
            bridge.restart();
            return;
        }
        if (route === '/api/config' && request.method === 'POST') {
            const body = await readJsonBody(request);
            if (!body) {
                sendJson(response, 400, { ok: false, error: 'Those settings could not be read.' });
                return;
            }
            const result = await applySettings(config, bridge, body);
            sendJson(response, result.ok ? 200 : 400, result);
            return;
        }

        await serveFile(route, response);
    });
}

/**
 * Save what the panel sent. Most settings apply to the very next gift because the
 * gift code reads this same object; only the port needs the app restarted.
 */
async function applySettings(config, bridge, incoming) {
    // Check the port before coerce(), which would quietly fold anything odd back
    // to the default and hide the mistake from whoever typed it.
    if (incoming.port !== undefined) {
        const wanted = Number(incoming.port);
        if (!Number.isInteger(wanted) || wanted < 1 || wanted > 65535) {
            return { ok: false, error: 'The port has to be a whole number between 1 and 65535.' };
        }
    }
    const merged = coerce({ ...config, ...Object.fromEntries(EDITABLE.map(key => [key, incoming[key]]).filter(([, v]) => v !== undefined)) });
    if (!merged.tiktokUsername) {
        return { ok: false, error: 'Add the TikTok username you stream from.' };
    }

    const accountChanged = merged.tiktokUsername !== config.tiktokUsername || merged.signApiKey !== config.signApiKey;
    const portChanged = merged.port !== config.port;

    try {
        await writeFile(CONFIG_PATH, JSON.stringify({ ...DEFAULTS, ...merged }, null, 4) + '\n', 'utf8');
    } catch (error) {
        return { ok: false, error: `config.json could not be saved: ${error.message}` };
    }

    for (const key of EDITABLE) config[key] = merged[key];
    if (merged.signApiKey) SignConfig.apiKey = merged.signApiKey;
    say('Settings saved from the control panel.');

    if (accountChanged) bridge.restart();
    return {
        ok: true,
        reconnecting: accountChanged,
        restartNeeded: portChanged,
        config: Object.fromEntries(EDITABLE.map(key => [key, config[key]]))
    };
}

/* --------------------------------------------------------------------- main */

const config = await loadConfig();

if (!config.tiktokUsername) {
    console.log(gold('\n  Black Swan — TikTok gift bridge'));
    console.log('  No TikTok username is set yet.');
    const entered = await askForUsername();
    if (!entered) {
        warn('Add your username to tiktok-bridge/config.json ("tiktokUsername"), then run this again.');
        process.exit(1);
    }
    config.tiktokUsername = entered;
    await rememberUsername(entered);
}

if (config.signApiKey) SignConfig.apiKey = config.signApiKey;

const bridge = createBridge(config);
const server = createHttpServer(config, bridge);
const wss = new WebSocketServer({ server, path: '/tiktok' });

wss.on('connection', (socket, request) => {
    // The control panel listens on the same socket to show its live feed, but it is
    // not an overlay — counting it would tell the streamer OBS is connected when it
    // is not. It still receives every gift.
    const isPanel = /[?&]panel=1(&|$)/.test(request.url || '');
    clients.add(socket);
    if (isPanel) panels.add(socket);
    else say(dim(`overlay connected (${overlayCount()} total)`));
    socket.send(JSON.stringify({ type: 'hello', source: 'tiktok', username: config.tiktokUsername }));
    socket.on('close', () => {
        clients.delete(socket);
        panels.delete(socket);
        if (!isPanel) say(dim(`overlay disconnected (${overlayCount()} left)`));
    });
    socket.on('error', () => {
        clients.delete(socket);
        panels.delete(socket);
    });
});

// ws re-emits the HTTP server's errors on the WebSocketServer, so both need a
// handler — otherwise a busy port crashes with a stack trace instead of advice.
let fatal = false;
function handleServerError(error) {
    if (fatal) return;
    fatal = true;
    if (error.code === 'EADDRINUSE') {
        warn(`Port ${config.port} is already in use.`);
        console.log(dim('  Another copy of the bridge is probably already running — look for its window.'));
        console.log(dim(`  Otherwise change "port" in config.json and use the new number in the OBS URL.`));
    } else {
        warn(`Server error: ${error.message}`);
    }
    process.exit(1);
}

server.on('error', handleServerError);
wss.on('error', handleServerError);

// A hiccup anywhere should never take the bridge down in the middle of a stream:
// a dropped card is recoverable, a dead bridge nobody is watching is not.
process.on('unhandledRejection', reason => warn(dim(`ignored background error: ${describeError(reason)}`)));
process.on('uncaughtException', error => {
    if (fatal) return;
    warn(`recovered from an unexpected error: ${describeError(error)}`);
    console.log(dim('  The bridge is still running. Restart it if gifts stop appearing.'));
});

// Opening the panel is the whole point of the app having one, so do it for them.
function openInBrowser(target) {
    try {
        const child = process.platform === 'win32'
            ? spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', windowsHide: true })
            : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], { detached: true, stdio: 'ignore' });
        child.on('error', () => say(dim(`Open ${target} yourself to see the control panel.`)));
        child.unref();
    } catch {
        say(dim(`Open ${target} yourself to see the control panel.`));
    }
}

server.listen(config.port, '127.0.0.1', () => {
    const panelUrl = `http://localhost:${config.port}/`;
    console.log(gold('\n  Black Swan — TikTok gift bridge'));
    console.log(`  Control panel         ${gold(panelUrl)}`);
    console.log(`  Overlay URL for OBS   ${gold(`http://localhost:${config.port}${OVERLAY_PAGE}`)}`);
    console.log(`  Watching              ${dim('@' + config.tiktokUsername)}`);
    console.log(dim(`  Minimum ${config.minCoins} coin${config.minCoins === 1 ? '' : 's'} per card. Leave this window open while you stream.`));
    console.log(process.stdin.isTTY ? dim('  Press T for a test gift, Q or Ctrl+C to stop.\n') : '');
    bridge.start();
    // Only when a person is watching: tests and background runs get no browser.
    if (config.openPanel && process.stdout.isTTY) openInBrowser(panelUrl);
});

if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on('keypress', (_char, key) => {
        if (!key) return;
        if (key.name === 't') sendTestGift(config);
        if (key.name === 'q' || (key.ctrl && key.name === 'c')) shutdown();
    });
}

let closing = false;
function shutdown() {
    if (closing) return;
    closing = true;
    console.log(dim('\nStopping the bridge...'));
    bridge.stop();
    for (const client of clients) client.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
