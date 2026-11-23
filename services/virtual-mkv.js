'use strict';

/**
 * LG webOS virtual MKV: proxy the original Jellyfin static stream over HTTP
 * Range, replacing the unwanted audio TrackEntry ID bytes with EBML Void IDs.
 * Stream offsets/lengths never change; the MKV file is not copied or remuxed.
 *
 * Experimental: hidden tracks still have Cluster blocks. LG C4 accepts this
 * when tested from the corresponding local Python proof of concept.
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const MAX_HEADER = 32 * 1024 * 1024;
const HEADER_CHUNK = 128 * 1024;
const SESSION_LIFETIME = 4 * 60 * 60 * 1000;
const TRACKS_ID = Buffer.from([0x16, 0x54, 0xae, 0x6b]);

function vint(buf, pos, isId) {
    if (pos >= buf.length) throw Error('Truncated EBML element');
    const first = buf[pos];
    let width = 1;
    while (width <= 8 && !(first & (0x80 >> (width - 1)))) width++;
    if (width > 8 || pos + width > buf.length) throw Error('Invalid EBML vint');
    let value = isId ? 0 : (first & ((1 << (8 - width)) - 1));
    for (let i = isId ? 0 : 1; i < width; i++) value = value * 256 + buf[pos + i];
    if (!Number.isSafeInteger(value)) throw Error('EBML size too large');
    if (!isId && value === Math.pow(2, 7 * width) - 1) throw Error('Unknown-size EBML child');
    return { value, width };
}

function children(buf, start, end, fn) {
    let at = start;
    while (at < end) {
        const id = vint(buf, at, true);
        const sz = vint(buf, at + id.width, false);
        const body = at + id.width + sz.width;
        const tail = body + sz.value;
        if (tail > end || tail > buf.length) throw Error('Invalid EBML child size');
        fn(at, id.value, body, tail);
        at = tail;
    }
}

function unsigned(buf, start, end) {
    if (end - start > 6) throw Error('EBML track integer too large');
    let value = 0;
    for (let i = start; i < end; i++) value = value * 256 + buf[i];
    return value;
}

function parseTrackEntries(buf) {
    let at = 0;
    while ((at = buf.indexOf(TRACKS_ID, at)) >= 0) {
        try {
            const size = vint(buf, at + 4, false);
            const body = at + 4 + size.width;
            const end = body + size.value;
            if (end > buf.length) { at++; continue; }
            const entries = [];
            children(buf, body, end, (off, id, start, tail) => {
                if (id !== 0xae) return;
                const e = { offset: off, type: null, number: null, codec: '', flagOffset: null };
                children(buf, start, tail, (p, eid, b, z) => {
                    if (eid === 0x83) e.type = unsigned(buf, b, z);
                    if (eid === 0xd7) e.number = unsigned(buf, b, z);
                    if (eid === 0x86) e.codec = buf.toString('ascii', b, z);
                    if (eid === 0x88 && z - b === 1) e.flagOffset = b;
                });
                if (e.type != null && e.number != null) entries.push(e);
            });
            if (entries.some(e => e.type === 1) && entries.some(e => e.type === 2)) return entries;
        } catch (_) { /* A SeekHead ID reference is not an actual Tracks element. */ }
        at++;
    }
    throw Error('No complete Matroska Tracks in first 32 MiB');
}

function getRemote(url, headers, callback) {
    const target = new URL(url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw Error('Unsupported source protocol');
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.get(target, { headers: Object.assign({ 'Accept-Encoding': 'identity' }, headers || {}) }, callback);
    request.setTimeout(30000, () => request.destroy(Error('Jellyfin connection timed out')));
    return request;
}

function readHeader(url, headers) {
    return new Promise((resolve, reject) => {
        let done = false;
        const fail = error => { if (!done) { done = true; reject(error); } };
        let request;
        try {
            request = getRemote(url, Object.assign({}, headers, { Range: 'bytes=0-' + (MAX_HEADER - 1) }), response => {
                const partial = response.statusCode === 206;
                const cr = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers['content-range'] || '');
                const fullLen = Number(response.headers['content-length']);
                if ((!partial || !cr) && !(response.statusCode === 200 && fullLen > 0 && fullLen <= MAX_HEADER)) {
                    response.destroy();
                    return fail(Error('Jellyfin must support HTTP Range requests'));
                }
                const size = cr ? Number(cr[2]) : fullLen;
                if (!Number.isSafeInteger(size) || size <= 0) return fail(Error('Invalid source size'));
                const chunks = [];
                let length = 0;
                response.on('data', chunk => {
                    length += chunk.length;
                    if (length > MAX_HEADER) {
                        response.destroy();
                        fail(Error('MKV header exceeds 32 MiB'));
                    } else chunks.push(chunk);
                });
                response.on('end', () => {
                    if (done) return;
                    try {
                        const entries = parseTrackEntries(Buffer.concat(chunks, length));
                        done = true;
                        resolve({ size, entries });
                    } catch (e) { fail(e); }
                });
                response.on('error', fail);
            });
            request.on('error', fail);
        } catch (e) { fail(e); }
    });
}

function createPatches(entries, ordinal) {
    const audio = entries.filter(e => e.type === 2);
    if (audio.length < 2 || ordinal < 1 || ordinal > audio.length) throw Error('Audio track ordinal is invalid');
    const keep = audio[ordinal - 1];
    const patches = new Map();
    audio.forEach(e => {
        if (e === keep) {
            if (e.flagOffset != null) patches.set(e.flagOffset, 1);
        } else {
            // 0xAE TrackEntry -> 0xEC Void: same EBML ID width, payload size.
            patches.set(e.offset, 0xec);
        }
    });
    return { patches, audioCount: audio.length, codec: keep.codec };
}

function isValidRange(range, size) {
    if (!range) return true;
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return false;
    const a = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const b = match[2] && match[1] ? Number(match[2]) : size - 1;
    return Number.isSafeInteger(a) && Number.isSafeInteger(b) && a >= 0 && a < size && b >= a;
}

function install(service, port) {
    const sessions = new Map();
    const tokens = new Map();
    const method = service.register('virtualMkv');

    method.on('request', msg => {
        const payload = msg.payload || {};
        const ordinal = Number(payload.audioOrdinal);
        // Require a subscription for the entire lifetime of playback. The
        // webOS service manager otherwise terminates inactive Node services.
        if (!msg.isSubscription || !Number.isSafeInteger(ordinal) || ordinal < 1 ||
            typeof payload.sourceUrl !== 'string' || payload.sourceUrl.length > 8192) {
            msg.respond({ returnValue: false, errorText: 'Invalid virtual MKV request' });
            return;
        }
        let source;
        try {
            source = new URL(payload.sourceUrl);
            if (!['http:', 'https:'].includes(source.protocol) ||
                !/\/Videos\/[^/]+\/stream\.(mkv|matroska)$/i.test(source.pathname) ||
                source.searchParams.get('Static') !== 'true') throw Error('Expected static Jellyfin MKV URL');
        } catch (_) {
            msg.respond({ returnValue: false, errorText: 'Not a static Jellyfin MKV stream' });
            return;
        }
        const extraHeaders = {};
        // The caller may supply custom reverse-proxy credentials; disallow
        // Host/Range/connection-level headers and avoid logging their values.
        if (payload.headers && typeof payload.headers === 'object') {
            for (const key of Object.keys(payload.headers)) {
                if (!/^[A-Za-z0-9-]{1,60}$/.test(key) ||
                    /^(host|range|connection|accept-encoding|content-length|transfer-encoding)$/i.test(key)) continue;
                if (typeof payload.headers[key] === 'string' && payload.headers[key].length < 4096) {
                    extraHeaders[key] = payload.headers[key];
                }
            }
        }
        readHeader(source.href, extraHeaders).then(meta => {
            const selected = createPatches(meta.entries, ordinal);
            const id = crypto.randomBytes(20).toString('hex');
            sessions.set(id, {
                url: source.href, headers: extraHeaders, size: meta.size,
                patches: selected.patches, expiry: Date.now() + SESSION_LIFETIME
            });
            tokens.set(msg.uniqueToken, id);
            console.log('[VirtualMKV] Session ready; tracks:', selected.audioCount,
                'selected ordinal:', ordinal, 'codec:', selected.codec);
            msg.respond({ returnValue: true, subscribed: true, url: 'http://127.0.0.1:' +
                port + '/virtual-mkv/' + id + '/movie.mkv', audioCount: selected.audioCount });
        }).catch(e => {
            console.log('[VirtualMKV] Cannot prepare stream:', e.message);
            msg.respond({ returnValue: false, errorText: e.message });
        });
    });
    method.on('cancel', msg => {
        const id = tokens.get(msg.uniqueToken);
        if (id) sessions.delete(id);
        tokens.delete(msg.uniqueToken);
    });
    const timer = setInterval(() => {
        for (const [id, entry] of sessions) if (entry.expiry < Date.now()) sessions.delete(id);
    }, 120000);
    if (timer.unref) timer.unref();

    function handle(req, res, pathname) {
        if (!pathname.startsWith('/virtual-mkv/')) return false;
        const match = /^\/virtual-mkv\/([0-9a-f]{40})\/movie\.mkv$/.exec(pathname);
        const session = match && sessions.get(match[1]);
        if (!session || session.expiry < Date.now() || !['GET', 'HEAD'].includes(req.method)) {
            res.writeHead(404, { 'Content-Length': '0' }); res.end(); return true;
        }
        if (!isValidRange(req.headers.range, session.size)) {
            res.writeHead(416, { 'Content-Range': 'bytes */' + session.size,
                'Content-Length': '0' }); res.end(); return true;
        }
        const common = {
            'Content-Type': 'video/x-matroska',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store'
        };
        if (req.method === 'HEAD') {
            res.writeHead(200, Object.assign(common, { 'Content-Length': String(session.size) }));
            res.end(); return true;
        }
        const requestHeaders = Object.assign({}, session.headers);
        if (req.headers.range) requestHeaders.Range = req.headers.range;
        let remote;
        try {
            remote = getRemote(session.url, requestHeaders, upstream => {
                const cr = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(upstream.headers['content-range'] || '');
                const expected = req.headers.range ? 206 : 200;
                const start = cr ? Number(cr[1]) : 0;
                const size = cr ? Number(cr[3]) : Number(upstream.headers['content-length']);
                if (upstream.statusCode !== expected || size !== session.size ||
                    (req.headers.range && !cr)) {
                    upstream.destroy();
                    res.writeHead(502, { 'Content-Length': '0' });
                    res.end(); return;
                }
                let position = start;
                const headers = Object.assign({}, common, {
                    'Content-Length': upstream.headers['content-length']
                });
                if (cr) headers['Content-Range'] = upstream.headers['content-range'];
                res.writeHead(upstream.statusCode, headers);
                upstream.on('data', bytes => {
                    const chunk = Buffer.from(bytes);
                    for (const [offset, value] of session.patches) {
                        if (offset >= position && offset < position + chunk.length) chunk[offset - position] = value;
                    }
                    position += chunk.length;
                    if (!res.write(chunk)) upstream.pause();
                });
                res.on('drain', () => upstream.resume());
                upstream.on('end', () => res.end());
                upstream.on('error', () => res.destroy());
                res.on('close', () => upstream.destroy());
            });
            remote.on('error', e => {
                console.log('[VirtualMKV] Range proxy:', e.message);
                if (!res.headersSent) { res.writeHead(502, { 'Content-Length': '0' }); res.end(); }
                else res.destroy();
            });
        } catch (_) {
            res.writeHead(502, { 'Content-Length': '0' }); res.end();
        }
        return true;
    }
    return { handle };
}

module.exports = { install, parseTrackEntries, createPatches, isValidRange };
