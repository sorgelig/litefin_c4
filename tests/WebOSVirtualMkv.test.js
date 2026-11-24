import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handle, prepare, release, parseAudio } = require('../services/virtual-mkv.js');

const elem = (id, body) => {
    const data = Buffer.from(body);
    assert.ok(data.length < 127);
    return Buffer.concat([Buffer.from(id), Buffer.from([0x80 | data.length]), data]);
};
const entry = (type, number, codec, flag) => elem([0xae], Buffer.concat([
    elem([0x83], [type]), elem([0xd7], [number]),
    elem([0x86], Buffer.from(codec)), elem([0x88], [flag])
]));
const tracks = elem([0x16, 0x54, 0xae, 0x6b], Buffer.concat([
    entry(1, 1, 'V_AV1', 1), entry(2, 2, 'A_DTS', 1), entry(2, 3, 'A_AC3', 0)
]));
const file = Buffer.concat([Buffer.alloc(11), tracks, Buffer.alloc(512 * 1024, 0x55)]);

function listen(handler) {
    return new Promise(resolve => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

test('selected audio header and byte offsets are preserved over full and partial requests', async () => {
    const upstream = await listen((req, res) => {
        const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
        if (!match) { res.writeHead(400); res.end(); return; }
        const start = Number(match[1]);
        const end = Math.min(Number(match[2]), file.length - 1);
        res.writeHead(206, { 'Content-Range': 'bytes ' + start + '-' + end + '/' + file.length,
            'Content-Length': end - start + 1 });
        res.end(file.subarray(start, end + 1));
    });
    const local = await listen((req, res) => handle(req, res, new URL(req.url, 'http://localhost').pathname));
    let token;
    try {
        const result = await prepare({ url: 'http://127.0.0.1:' + upstream.address().port + '/Videos/test/stream.mkv?Static=true',
            audioOrdinal: 1, audioCount: 2, headers: {} });
        token = result.token;
        const url = result.url.replace(':8123', ':' + local.address().port);
        const head = await fetch(url, { method: 'HEAD' });
        assert.equal(head.status, 200);
        assert.equal(Number(head.headers.get('content-length')), file.length);
        const whole = await fetch(url);
        const masked = Buffer.from(await whole.arrayBuffer());
        assert.equal(masked.length, file.length);
        const remaining = parseAudio(masked);
        assert.equal(remaining.length, 1);
        assert.equal(remaining[0].codec, 'A_AC3');
        assert.equal(masked[remaining[0].flag], 1);
        const source = parseAudio(file);
        const expected = Buffer.from(file);
        expected[source[0].off] = 0xec;
        expected[source[1].flag] = 1;
        assert.deepEqual(masked, expected);
        for (const [start, end] of [[source[0].off, source[0].off], [0, 99], [300000, 300100]]) {
            const response = await fetch(url, { headers: { Range: 'bytes=' + start + '-' + end } });
            assert.equal(response.status, 206);
            assert.equal(response.headers.get('content-range'), 'bytes ' + start + '-' + end + '/' + file.length);
            assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected.subarray(start, end + 1));
        }
        release(token);
        assert.equal((await fetch(url)).status, 404);
        token = null;
    } finally {
        if (token) release(token);
        local.closeAllConnections();
        upstream.closeAllConnections();
        await Promise.all([local, upstream].map(server => new Promise(resolve => server.close(resolve))));
    }
});
