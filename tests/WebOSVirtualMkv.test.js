import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { parseTrackEntries, createPatches, isValidRange } = require('../services/virtual-mkv.js');

function element(id, payload) {
    assert.ok(payload.length < 127);
    return Buffer.concat([Buffer.from([id, 0x80 | payload.length]), payload]);
}
function entry(number, type, codec, isDefault) {
    const fields = [
        element(0xd7, Buffer.from([number])),
        element(0x83, Buffer.from([type])),
        element(0x86, Buffer.from(codec, 'ascii')),
        element(0x88, Buffer.from([isDefault ? 1 : 0]))
    ];
    return element(0xae, Buffer.concat(fields));
}
function fixture() {
    const header = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]);
    const entries = Buffer.concat([
        entry(1, 1, 'V_MPEG4', true),
        entry(2, 2, 'A_DTS', true),
        entry(3, 2, 'A_AC3', false),
        entry(4, 2, 'A_EAC3', false)
    ]);
    assert.ok(entries.length < 127);
    return Buffer.concat([header, Buffer.from([0x16, 0x54, 0xae, 0x6b, 0x80 | entries.length]), entries,
        Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x80])]);
}

test('EBML parser finds video and three audio entries in physical order', () => {
    const found = parseTrackEntries(fixture());
    assert.deepEqual(found.map(e => e.type), [1, 2, 2, 2]);
    assert.deepEqual(found.map(e => e.number), [1, 2, 3, 4]);
});

test('selecting AC3 masks other audio TrackEntries and marks AC3 as default', () => {
    const data = fixture();
    const found = parseTrackEntries(data);
    const { patches, audioCount, codec } = createPatches(found, 2);
    assert.equal(audioCount, 3);
    assert.equal(codec, 'A_AC3');
    assert.equal(patches.get(found[1].offset), 0xec);
    assert.equal(patches.get(found[3].offset), 0xec);
    assert.equal(patches.get(found[2].flagOffset), 1);
    assert.equal(patches.has(found[0].offset), false);
    for (const [offset, value] of patches) data[offset] = value;
    const visible = parseTrackEntries(data);
    assert.deepEqual(visible.map(e => e.number), [1, 3]);
});

test('invalid audio ordinal is rejected', () => {
    assert.throws(() => createPatches(parseTrackEntries(fixture()), 4));
    assert.throws(() => createPatches(parseTrackEntries(fixture()), 0));
});

test('valid single HTTP byte ranges and rejected invalid ranges', () => {
    assert.equal(isValidRange('bytes=0-99', 1000), true);
    assert.equal(isValidRange('bytes=500-', 1000), true);
    assert.equal(isValidRange('bytes=-100', 1000), true);
    assert.equal(isValidRange('bytes=1000-', 1000), false);
    assert.equal(isValidRange('bytes=900-800', 1000), false);
    assert.equal(isValidRange('bytes=0-99,200-250', 1000), false);
});

test('the player routes virtual tracks before any native audioTracks switching', () => {
    const webos = readFileSync(new URL('../src/player/core/WebOSPlayer.js', import.meta.url), 'utf8');
    const player = readFileSync(new URL('../src/player/core/JellyfinPlayer.js', import.meta.url), 'utf8');
    const service = readFileSync(new URL('../services/service.js', import.meta.url), 'utf8');
    assert.match(webos, /await prepareVirtualMkv\(options\.url, ordinal/);
    assert.match(webos, /if \(options\.virtualMkv\) return;/);
    assert.match(webos, /isVirtualMkvActive\(\)/);
    assert.match(player, /const switchingVirtualMkv =/);
    assert.match(player, /restartPlaybackMode = switchingVirtualMkv \? 'directPlay'/);
    assert.match(service, /virtualMkv\.handle\(req, res, u\.pathname\)/);
});
