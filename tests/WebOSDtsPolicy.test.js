import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getRequestedAudioCodec,
    isDtsAudioCodec,
    preferNativeDtsAuto,
    avoidUnsupportedDtsEncode
} from '../src/player/core/WebOSDtsPolicy.js';

const item = {
    MediaSources: [{
        Id: 'source-1',
        MediaStreams: [
            { Type: 'Video', Index: 0, Codec: 'hevc' },
            { Type: 'Audio', Index: 1, Codec: 'ac3', IsDefault: true },
            { Type: 'Audio', Index: 2, Codec: 'dts', IsDefault: false }
        ]
    }]
};

test('identifies DTS, including Jellyfin aliases, but not AC3/EAC3', () => {
    for (const name of ['dts', 'DTS', 'dca', 'dtshd', 'dts-hd', 'dts-ma', 'dts-x']) {
        assert.equal(isDtsAudioCodec(name), true, name);
    }
    for (const name of ['ac3', 'eac3', 'truehd', 'aac', null]) {
        assert.equal(isDtsAudioCodec(name), false, String(name));
    }
});

test('selected non-default DTS track overrides the container AC3 default', () => {
    assert.equal(getRequestedAudioCodec({ item, mediaSourceId: 'source-1' }), 'ac3');
    assert.equal(getRequestedAudioCodec({ item, mediaSourceId: 'source-1', audioStreamIndex: 2 }), 'dts');
    assert.equal(getRequestedAudioCodec({ item, audioStreamIndex: 1 }), 'ac3');
    assert.equal(getRequestedAudioCodec({ item: {} }), null);
});

test('native DTS is preferred only in webOS Auto and never overrides manual transcoding', () => {
    const opts = {
        backendType: 'webos',
        dtsSupported: true,
        selectedCodec: 'dts',
        playbackMode: 'auto'
    };
    assert.equal(preferNativeDtsAuto(opts), true);
    assert.equal(preferNativeDtsAuto({ ...opts, playbackMode: 'remux' }), false);
    assert.equal(preferNativeDtsAuto({ ...opts, playbackMode: 'transcode' }), false);
    assert.equal(preferNativeDtsAuto({ ...opts, playbackMode: 'transcodeAudio' }), false);
    assert.equal(preferNativeDtsAuto({ ...opts, forceTranscode: true }), false);
    assert.equal(preferNativeDtsAuto({ ...opts, hasManualBitrate: true }), false);
    assert.equal(preferNativeDtsAuto({ ...opts, dtsSupported: false }), false);
    assert.equal(preferNativeDtsAuto({ ...opts, backendType: 'html5' }), false);
    assert.equal(preferNativeDtsAuto({ ...opts, selectedCodec: 'ac3' }), false);
});

function sampleProfile() {
    return {
        TranscodingProfiles: [
            { Type: 'Video', Protocol: 'hls', Container: 'mp4', AudioCodec: 'dts' },
            { Type: 'Video', Protocol: 'hls', Container: 'mp4', AudioCodec: 'ac3' },
            { Type: 'Video', Protocol: 'hls', Container: 'mp4', AudioCodec: 'aac' },
            { Type: 'Audio', Protocol: 'hls', AudioCodec: 'aac' }
        ]
    };
}

test('non-DTS source with Prefer DTS picks AC3/AAC without calling DTS encoder', () => {
    const profile = sampleProfile();
    assert.equal(avoidUnsupportedDtsEncode(profile, 'eac3', 'prefer_dts'), true);
    assert.deepEqual(profile.TranscodingProfiles.filter((x) => x.Type === 'Video').map((x) => x.AudioCodec), ['ac3', 'aac']);
});

test('non-DTS source with DTS Only uses AC3 compatibility fallback', () => {
    const profile = { TranscodingProfiles: [sampleProfile().TranscodingProfiles[0]] };
    assert.equal(avoidUnsupportedDtsEncode(profile, 'truehd', 'force_dts'), true);
    assert.equal(profile.TranscodingProfiles[0].AudioCodec, 'ac3');
    assert.equal(profile.TranscodingProfiles[0].Container, 'mp4');
});

test('DTS source retains DTS HLS copy target unchanged', () => {
    const profile = sampleProfile();
    assert.equal(avoidUnsupportedDtsEncode(profile, 'dts', 'prefer_dts'), false);
    assert.equal(avoidUnsupportedDtsEncode(profile, 'dca', 'force_dts'), false);
    assert.equal(profile.TranscodingProfiles[0].AudioCodec, 'dts');
});

test('unrelated audio preferences are not altered', () => {
    const profile = sampleProfile();
    assert.equal(avoidUnsupportedDtsEncode(profile, 'ac3', 'auto'), false);
    assert.equal(avoidUnsupportedDtsEncode(profile, 'ac3', 'force_ac3'), false);
    assert.equal(profile.TranscodingProfiles[0].AudioCodec, 'dts');
});
