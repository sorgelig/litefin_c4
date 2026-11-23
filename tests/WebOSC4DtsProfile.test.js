import assert from 'node:assert/strict';
import test from 'node:test';

// Match the minimal browser environment used by the existing profile tests.
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
        value: 'Mozilla/5.0 (Web0S; LG Smart TV)',
        configurable: true
    });
} catch { /* navigator is not configurable on some Node versions */ }

const { PlayerSettings } = await import('../src/utils/PlayerSettings.js');
const { buildJellyfinProfile } = await import('../src/api/profiles/WebOSProfile.js');

function setDtsMode(mode) {
    PlayerSettings.set('transcodeAudioCodec', mode);
    PlayerSettings.set('enableDts', 'enable');
    PlayerSettings.set('forceFmp4HlsContainer', false);
    PlayerSettings.set('forceTranscode', false);
    PlayerSettings.set('transcodeMaxAudioChannels', -1);
}

function hlsProfiles(profile) {
    return profile.TranscodingProfiles.filter(
        (p) => p.Type === 'Video' && p.Protocol === 'hls' && p.Context === 'Streaming'
    );
}

test('C4: DTS forced passthrough is advertised to Jellyfin for native MKV playback', () => {
    setDtsMode('auto');
    const profile = buildJellyfinProfile();
    const mkv = profile.DirectPlayProfiles.find((p) => p.Type === 'Video' && p.Container === 'mkv');
    assert.ok(mkv, 'MKV Direct Play profile is present');
    assert.ok(mkv.AudioCodec.split(',').includes('dts'), 'DTS audio is allowed for native playback');
    PlayerSettings.set('enableDts', 'auto');
});

test('C4: experimental DTS-only transcode advertises only DTS in fMP4 HLS and <= 5.1', () => {
    setDtsMode('force_dts');
    const profiles = hlsProfiles(buildJellyfinProfile());
    assert.ok(profiles.length > 0);
    assert.ok(profiles.every((p) => p.AudioCodec === 'dts'));
    assert.ok(profiles.every((p) => p.Container === 'mp4'));
    assert.ok(profiles.every((p) => p.MaxAudioChannels <= 6));
    PlayerSettings.set('transcodeAudioCodec', 'auto');
});

test('C4: experimental Prefer DTS includes AC3/AAC fallback and uses fMP4 HLS', () => {
    setDtsMode('prefer_dts');
    const profiles = hlsProfiles(buildJellyfinProfile());
    assert.deepEqual(profiles.map((p) => p.AudioCodec), ['dts', 'ac3', 'aac']);
    assert.ok(profiles.every((p) => p.Container === 'mp4'));
    PlayerSettings.set('transcodeAudioCodec', 'auto');
});

test('C4: HTML5 fallback does not advertise DTS in HLS output', () => {
    setDtsMode('force_dts');
    const profiles = hlsProfiles(buildJellyfinProfile({ backend: 'html5' }));
    assert.ok(profiles.length > 0);
    assert.ok(profiles.every((p) => p.AudioCodec === 'aac'));
    PlayerSettings.set('transcodeAudioCodec', 'auto');
});

test('C4: Force Transcode honors experimental DTS-only instead of silently choosing AAC', () => {
    setDtsMode('force_dts');
    const profiles = hlsProfiles(buildJellyfinProfile({ playbackMode: 'transcode' }));
    assert.ok(profiles.length > 0);
    assert.ok(profiles.every((p) => p.AudioCodec === 'dts'));
    assert.ok(profiles.every((p) => p.Container === 'mp4'));
    assert.ok(profiles.every((p) => p.MaxAudioChannels <= 6));
    PlayerSettings.set('transcodeAudioCodec', 'auto');
});

test('C4: HTML5 Force Transcode remains compatible AAC output', () => {
    setDtsMode('force_dts');
    const profiles = hlsProfiles(buildJellyfinProfile({ playbackMode: 'transcode', backend: 'html5' }));
    assert.ok(profiles.length > 0);
    assert.ok(profiles.every((p) => p.AudioCodec === 'aac'));
    assert.ok(profiles.every((p) => p.Container === 'ts'));
    PlayerSettings.set('transcodeAudioCodec', 'auto');
});
