import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isDolbyTrack,
    shouldUseDolbyProgressiveCopy,
    buildDolbyProgressiveCopyUrl,
    applyDolbyProgressiveCopy
} from '../src/player/core/WebOSDolbyProgressiveTest.js';

const mkv = () => ({
    Id: 'source1',
    Container: 'mkv',
    SupportsDirectPlay: true,
    MediaStreams: [
        { Type: 'Video', Index: 0, Codec: 'hevc' },
        { Type: 'Audio', Index: 1, Codec: 'dts', IsDefault: true },
        { Type: 'Audio', Index: 2, Codec: 'ac3' },
        { Type: 'Audio', Index: 3, Codec: 'eac3' }
    ]
});
const eligible = (src, idx, overrides = {}) => shouldUseDolbyProgressiveCopy({
    backendType: 'webos', mediaSource: src, audioStreamIndex: idx,
    playbackMode: 'auto', userPlaybackMode: 'auto', manualBitrate: null,
    isLiveTv: false, escalated: false, ...overrides
});

test('only Dolby tracks qualify, independent of physical track index or default flag', () => {
    const source = mkv();
    assert.equal(isDolbyTrack(source, 1), false);
    assert.equal(eligible(source, 1), false);
    assert.equal(eligible(source, 2), true);
    assert.equal(eligible(source, 3), true);
    source.MediaStreams[1].IsDefault = false;
    source.MediaStreams[2].IsDefault = true;
    assert.equal(eligible(source, 2), true);
    assert.equal(eligible(source, 3), true);
});

test('exclude non-native backend and non-MKV, remote, live, explicit remux or bitrate limited', () => {
    const source = mkv();
    assert.equal(eligible(source, 2, { backendType: 'html5' }), false);
    assert.equal(eligible({ ...source, Container: 'mp4' }, 2), false);
    assert.equal(eligible({ ...source, IsRemote: true }, 2), false);
    assert.equal(eligible(source, 2, { isLiveTv: true }), false);
    assert.equal(eligible(source, 2, { userPlaybackMode: 'transcode' }), false);
    assert.equal(eligible(source, 2, { manualBitrate: 2000000 }), false);
    assert.equal(eligible(source, 2, { escalated: true }), false);
});

test('HLS URL becomes stream.mkv with both streams copied and correct track', () => {
    const path = buildDolbyProgressiveCopyUrl({
        transcodingUrl: '/Videos/item42/master.m3u8?MediaSourceId=original&PlaySessionId=old&AudioCodec=aac&AudioStreamIndex=1&SegmentLength=6&TranscodeReasons=AudioCodecNotSupported',
        itemId: 'item42', mediaSourceId: 'source1', playSessionId: 'session99',
        authToken: 'mytoken', audioStreamIndex: 2, startPositionTicks: 123456000
    });
    const u = new URL(path, 'http://jellyfin.invalid');
    assert.equal(u.pathname, '/Videos/item42/stream.mkv');
    assert.equal(u.searchParams.get('AudioStreamIndex'), '2');
    assert.equal(u.searchParams.get('StartTimeTicks'), '123456000');
    assert.equal(u.searchParams.get('VideoCodec'), 'copy');
    assert.equal(u.searchParams.get('AudioCodec'), 'copy');
    assert.equal(u.searchParams.get('Container'), 'mkv');
    assert.equal(u.searchParams.get('Static'), 'false');
    assert.equal(u.searchParams.has('SegmentLength'), false);
    assert.equal(u.searchParams.has('TranscodeReasons'), false);
    assert.equal(u.searchParams.get('ApiKey'), 'mytoken');
});

test('static DirectPlay without HLS URL can still build progressive source', () => {
    const src = mkv();
    const okay = applyDolbyProgressiveCopy(src, {
        itemId: 'item42', audioStreamIndex: 3,
        playSessionId: 'session1', authToken: 'token'
    });
    assert.equal(okay, true);
    assert.equal(src._webosDolbyProgressiveCopy, true);
    assert.equal(src.SupportsDirectPlay, false);
    assert.equal(src.SupportsDirectStream, true);
    assert.equal(src.TranscodingContainer, 'mkv');
    assert.equal(src.TranscodingSubProtocol, null);
    assert.equal(src.TranscodingInfo.VideoCodec, 'copy');
    assert.equal(src.TranscodingInfo.AudioCodec, 'copy');
    assert.match(src.TranscodingUrl, /AudioStreamIndex=3/);
});
