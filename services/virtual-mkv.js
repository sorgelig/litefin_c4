'use strict';
/**
 * LG webOS virtual single-audio Matroska stream.
 * Read-only, byte-for-byte Range proxy; only modifies obsolete audio TrackEntry
 * element IDs (0xAE -> EBML Void 0xEC) in the first 32 MiB.
 *
 * Media Clusters are deliberately unchanged, including packets for hidden
 * tracks. This is an experimental webOS workaround, NOT a standards-compliant
 * Matroska rewriting tool.
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const HEADER_LIMIT = 32 * 1024 * 1024;
const SESSION_TTL = 6 * 60 * 60 * 1000;
const sessions = new Map();

function vint(buffer, off, isId) {
    if (off >= buffer.length) throw Error('Truncated EBML');
    const first = buffer[off];
    let width = 1;
    while (width <= 8 && !(first & (0x80 >> (width - 1)))) width++;
    if (width > 8 || off + width > buffer.length) throw Error('Invalid EBML vint');
    let value = 0;
    for (let i = 0; i < width; i++) value = value * 256 + buffer[off + i];
    if (!isId) {
        value -= Math.pow(2, 8 * width - width);
        if (value === Math.pow(2, 7 * width) - 1) throw Error('Unknown-size EBML child');
    }
    return { value, width };
}

function children(buffer, begin, end) {
    const result = [];
    for (let off = begin; off < end;) {
        const id = vint(buffer, off, true);
        const sz = vint(buffer, off + id.width, false);
        const start = off + id.width + sz.width;
        const tail = start + sz.value;
        if (tail > end || tail <= off || tail > buffer.length) throw Error('Invalid child bounds');
        result.push({ off, id: id.value, start, end: tail });
        off = tail;
    }
    return result;
}

function parseAudio(buffer) {
    const needle = Buffer.from([0x16, 0x54, 0xae, 0x6b]);
    for (let off = buffer.indexOf(needle); off >= 0; off = buffer.indexOf(needle, off + 1)) {
        try {
            const sz = vint(buffer, off + 4, false);
            const begin = off + 4 + sz.width, end = begin + sz.value;
            if (end > buffer.length) continue;
            const entries = [];
            for (const e of children(buffer, begin, end)) {
                if (e.id !== 0xae) continue;
                let type = 0, number = 0, codec = '', flag = null;
                for (const c of children(buffer, e.start, e.end)) {
                    const data = buffer.subarray(c.start, c.end);
                    if (c.id === 0x83) type = data.reduce((n, b) => n * 256 + b, 0);
                    if (c.id === 0xd7) number = data.reduce((n, b) => n * 256 + b, 0);
                    if (c.id === 0x86) codec = data.toString('ascii');
                    if (c.id === 0x88) flag = data.length === 1 ? c.start : null;
                }
                if (type && number) entries.push({ off: e.off, type, number, codec, flag });
            }
            if (entries.some(e => e.type === 1) && entries.some(e => e.type === 2)) {
                return entries.filter(e => e.type === 2);
            }
        } catch (_) { /* SeekHead can contain a spurious matching sequence */ }
    }
    throw Error('Complete Matroska Tracks element not present in first 32 MiB');
}

function openSource(url, headers, range, onResponse, onError) {
    const target = new URL(url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw Error('Unsupported source protocol');
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.get(target, {
        headers: { ...headers, Range: range, 'Accept-Encoding': 'identity' },
        timeout: 30000,
        agent: false
    }, onResponse).on('error', onError);
    request.on('timeout', () => request.destroy(Error('Upstream timeout')));
    return request;
}

function fetchHeader(url, headers) {
    return new Promise((resolve, reject) => {
        let request;
        try {
            request = openSource(url, headers, 'bytes=0-' + (HEADER_LIMIT - 1), upstream => {
                const cr = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(upstream.headers['content-range'] || '');
                if (upstream.statusCode !== 206 || !cr || Number(cr[1]) !== 0) {
                    upstream.destroy();
                    return reject(Error('Jellyfin source did not honor HTTP Range'));
                }
                const total = Number(cr[3]);
                if (!Number.isSafeInteger(total) || total <= 0) return reject(Error('Invalid file size'));
                const parts = [];
                let length = 0;
                upstream.on('data', chunk => {
                    length += chunk.length;
                    if (length > HEADER_LIMIT) { upstream.destroy(); reject(Error('MKV header too large')); return; }
                    parts.push(chunk);
                });
                upstream.on('end', () => resolve({ buffer: Buffer.concat(parts), size: total }));
                upstream.on('error', reject);
            }, reject);
        } catch (err) { reject(err); }
    });
}

function json(res, status, body) {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
}

function register(req, res) {
    let chunks = [], size = 0;
    req.on('data', chunk => {
        size += chunk.length;
        if (size > 16384) { req.destroy(); return; }
        chunks.push(chunk);
    });
    req.on('end', async () => {
        try {
            const input = JSON.parse(Buffer.concat(chunks).toString());
            const target = new URL(input.url);
            if (!['http:', 'https:'].includes(target.protocol)) throw Error('Invalid source URL');
            if (!/\/Videos\/[^/]+\/stream\.(?:mkv|matroska)$/i.test(target.pathname)) throw Error('Source must be an original Jellyfin MKV stream');
            const headers = {};
            for (const [name, value] of Object.entries(input.headers || {})) {
                if (/^(authorization|x-emby-token|x-mediabrowser-token|cookie|cf-access-client-id|cf-access-client-secret)$/i.test(name) && typeof value === 'string') {
                    headers[name] = value;
                }
            }
            const ordinal = Number(input.audioOrdinal);
            const { buffer, size } = await fetchHeader(target.href, headers);
            const audio = parseAudio(buffer);
            if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= audio.length || audio.length < 2) {
                throw Error('Invalid audio ordinal / not a multitrack MKV');
            }
            const patches = new Map();
            audio.forEach((entry, i) => {
                if (i !== ordinal) patches.set(entry.off, 0xec);
                else if (entry.flag !== null) patches.set(entry.flag, 1);
            });
            for (const [key, value] of sessions) {
                if (Date.now() - value.created > SESSION_TTL) sessions.delete(key);
            }
            const token = crypto.randomBytes(18).toString('hex');
            sessions.set(token, { url: target.href, headers, size, patches, created: Date.now() });
            json(res, 200, { url: 'http://127.0.0.1:8123/virtual-mkv/' + token + '/movie.mkv', audioCount: audio.length });
        } catch (err) {
            console.error('[VirtualMKV] registration failed:', err.message);
            json(res, 422, { error: err.message });
        }
    });
}

function serve(req, res, token) {
    const session = sessions.get(token);
    if (!session || Date.now() - session.created > SESSION_TTL) {
        sessions.delete(token);
        return json(res, 404, { error: 'Unknown or expired stream' });
    }
    const size = session.size;
    let start = 0, end = size - 1;
    const range = req.headers.range;
    if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return invalidRange(res, size);
        if (match[1]) {
            start = Number(match[1]);
            if (match[2]) end = Math.min(Number(match[2]), size - 1);
        } else {
            const suffix = Number(match[2]);
            if (!suffix) return invalidRange(res, size);
            start = Math.max(0, size - suffix);
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return invalidRange(res, size);
    }
    const responseHeaders = {
        'Content-Type': 'video/x-matroska',
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
    };
    if (range) responseHeaders['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
    const status = range ? 206 : 200;
    if (req.method === 'HEAD') {
        res.writeHead(status, responseHeaders);
        res.end();
        return;
    }
    let cursor = start, responded = false;
    try {
        const outgoing = openSource(session.url, session.headers, 'bytes=' + start + '-' + end, upstream => {
            const cr = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(upstream.headers['content-range'] || '');
            if (upstream.statusCode !== 206 || !cr || Number(cr[1]) !== start || Number(cr[2]) !== end || Number(cr[3]) !== size) {
                upstream.destroy();
                return json(res, 502, { error: 'Upstream Range mismatch' });
            }
            responded = true;
            res.writeHead(status, responseHeaders);
            upstream.on('data', chunk => {
                const data = Buffer.from(chunk);
                for (const [offset, value] of session.patches) {
                    if (offset >= cursor && offset < cursor + data.length) data[offset - cursor] = value;
                }
                cursor += data.length;
                if (!res.write(data)) upstream.pause();
            });
            res.on('drain', () => upstream.resume());
            upstream.on('end', () => res.end());
            upstream.on('error', () => res.destroy());
            res.on('close', () => upstream.destroy());
        }, err => {
            console.error('[VirtualMKV] upstream:', err.message);
            if (responded) res.destroy(); else if (!res.headersSent) json(res, 502, { error: 'Upstream failed' });
        });
        res.on('close', () => outgoing.destroy());
    } catch (err) {
        json(res, 502, { error: err.message });
    }
}

function invalidRange(res, size) {
    res.writeHead(416, { 'Content-Range': 'bytes */' + size, 'Content-Length': '0' });
    res.end();
}

function handle(req, res, path) {
    if (path === '/virtual-mkv/session') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
        return register(req, res);
    }
    const match = /^\/virtual-mkv\/([0-9a-f]{36})\/movie\.mkv$/.exec(path);
    if (match && (req.method === 'GET' || req.method === 'HEAD')) return serve(req, res, match[1]);
    return json(res, 404, { error: 'Not found' });
}

module.exports = { handle, parseAudio };
