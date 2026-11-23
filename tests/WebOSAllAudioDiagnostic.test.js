import assert from 'node:assert/strict';
import test from 'node:test';

// Exercise the native webOS device profile without a TV.
const values = new Map();
globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
};
globalThis.document = { createElement: () => ({ canPlayType: () => '' }) };
globalThis.screen = { width: 1920, height: 1080 };
globalThis.window = globalThis;
try {
    Object.defineProperty(globalThis.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (WebOS; LG Smart TV)',
        configurable: true
    });
} catch { /* Node may prevent overriding navigator */ }

const { PlayerSettings } = await import('../src/utils/PlayerSettings.js');
const { getDeviceCapabilities, buildJellyfinProfile } = await import('../src/api/profiles/WebOSProfile.js');

test('diagnostic assumes AC3/EAC3/DTS/TrueHD support even if browser probes reject all', () => {
    const caps = getDeviceCapabilities();
    assert.equal(caps.diagnosticAllAudioPassthrough, true);
    for (const codec of ['ac3', 'eac3', 'dts', 'truehd', 'mp2']) {
        assert.equal(caps[codec], true, codec);
    }
});

test('advertises common codecs in native MKV direct-play and direct-stream profiles', () => {
    PlayerSettings.set('enableDts', 'auto');
    PlayerSettings.set('enableTrueHd', 'auto');
    PlayerSettings.set('forceTranscode', false);
    const profile = buildJellyfinProfile({ backend: 'webos', playbackMode: 'auto' });
    const mkv = profile.DirectPlayProfiles.find(p => p.Type === 'Video' && p.Container === 'mkv');
    const directStream = profile.DirectStreamProfiles.find(p => p.Type === 'Video' && p.Container === 'mkv');
    assert.ok(mkv);
    assert.ok(directStream);
    for (const codec of ['ac3', 'eac3', 'dts', 'dtshd', 'truehd', 'mlp', 'flac', 'alac', 'opus', 'pcm', 'mp2']) {
        assert.ok(mkv.AudioCodec.split(',').includes(codec), 'DirectPlay ' + codec);
        assert.ok(directStream.AudioCodec.split(',').includes(codec), 'DirectStream ' + codec);
    }
});

test('does not introduce a DTS transcoding target', () => {
    PlayerSettings.set('forceTranscode', false);
    PlayerSettings.set('transcodeAudioCodec', 'auto');
    const profile = buildJellyfinProfile({ backend: 'webos', playbackMode: 'auto' });
    const hls = profile.TranscodingProfiles.filter(p => p.Type === 'Video' && p.Protocol === 'hls');
    assert.ok(hls.length);
    assert.ok(hls.every(p => p.AudioCodec !== 'dts'));
});
