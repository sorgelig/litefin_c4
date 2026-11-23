import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getRequestedAudioCodec,
    isDtsAudioCodec,
    preferNativeDtsAuto
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

