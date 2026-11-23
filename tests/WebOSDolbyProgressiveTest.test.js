import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
    isDolbyTrack,
    shouldUseDolbyProgressiveCopy,
    buildDolbyProgressiveCopyUrl,
    applyDolbyProgressiveCopy,
    shouldRestartDolbyProgressiveSeek
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

test('player uses defined Live TV variable when invoking DD progressive routing', () => {
    // This guards a runtime ReferenceError that node --check cannot detect.
    const source = readFileSync(
        new URL('../src/player/core/JellyfinPlayer.js', import.meta.url), 'utf8'
    );
    assert.match(source, /const isLiveChannel = options\.item\?\.Type === 'TvChannel'/);
    assert.match(source, /isLiveTv:\s*isLiveChannel/);
    assert.doesNotMatch(source, /\n\s+isLiveTv,\s*\n/);
});

test('progressive DD seeks restart the server copy, never the native time cursor', () => {
    const ms = mkv();
    assert.equal(shouldRestartDolbyProgressiveSeek('webos', ms, { itemId: 'item42' }), false);
    ms._webosDolbyProgressiveCopy = true;
    assert.equal(shouldRestartDolbyProgressiveSeek('webos', ms, { itemId: 'item42' }), true);
    assert.equal(shouldRestartDolbyProgressiveSeek('html5', ms, { itemId: 'item42' }), false);
    assert.equal(shouldRestartDolbyProgressiveSeek('webos', ms, null), false);

    // A new progressive stream must embed the absolute requested offset.
    const target = 3600 * 10000000;
    const url = buildDolbyProgressiveCopyUrl({
        itemId: 'item42', mediaSourceId: ms.Id, audioStreamIndex: 2,
        startPositionTicks: target
    });
    assert.equal(new URL(url, 'http://jellyfin.invalid').searchParams.get('StartTimeTicks'), String(target));
});

test('DD seek handler dispatches restart path before native backend seeking', () => {
    const source = readFileSync(new URL('../src/player/core/JellyfinPlayer.js', import.meta.url), 'utf8');
    const start = source.indexOf('    seek(positionTicks, options = {}) {');
    const end = source.indexOf('    seekRelative(offsetMs) {', start);
    assert.ok(start >= 0 && end > start);
    const handler = source.slice(start, end);
    const first = handler.indexOf('if (shouldRestartDolbyProgressiveSeek(');
    const fallback = handler.indexOf('this._backend?.seek(positionTicks, options);');
    assert.ok(first >= 0 && fallback > first);
    assert.match(handler, /this\.stop\(\{ restart: true \}\)/);
    assert.match(handler, /startPositionTicks: positionTicks/);
    assert.match(handler, /this\._progressiveSeekPositionTicks = positionTicks/);
});
