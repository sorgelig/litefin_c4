import assert from 'node:assert/strict';
import test from 'node:test';
import {
    shouldUseProgressiveAudioCopy,
    buildProgressiveAudioCopyUrl,
    applyProgressiveAudioCopy
} from '../src/player/core/WebOSProgressiveAudio.js';

const source = () => ({
    Container: 'mkv',
    Id: 'media-id',
    IsRemote: false,
    MediaStreams: [
        { Type: 'Video', Index: 0, Codec: 'h264' },
        { Type: 'Audio', Index: 1, Codec: 'dts', IsDefault: true },
        { Type: 'Audio', Index: 2, Codec: 'ac3', IsDefault: false },
        { Type: 'Audio', Index: 3, Codec: 'ac3', IsDefault: false },
        { Type: 'Audio', Index: 4, Codec: 'eac3', IsDefault: false },
        { Type: 'Audio', Index: 5, Codec: 'truehd', IsDefault: false }
    ],
    TranscodingUrl: '/Videos/movie-id/master.m3u8?MediaSourceId=media-id&PlaySessionId=session&ApiKey=token&AudioStreamIndex=3&AudioCodec=dts&AudioBitrate=768000&VideoCodec=copy&SegmentContainer=mp4&SegmentLength=6'
});

function should(override = {}) {
    return shouldUseProgressiveAudioCopy({
        backendType: 'webos',
        userPlaybackMode: 'directPlay',
        requestedPlaybackMode: 'auto',
        mediaSource: source(),
        audioStreamIndex: 3,
        needsAudioRemux: true,
        trackPlayable: true,
        ...override
    });
}

test('webOS native MKV non-default AC3 passthrough chooses progressive A/V copy', () => {
    assert.equal(should(), true);
    assert.equal(should({ audioStreamIndex: 2 }), true);
    assert.equal(should({ audioStreamIndex: 4 }), true);
});

test('do not alter first/default DTS, unsupported TrueHD, explicit transcode or other backends', () => {
    assert.equal(should({ audioStreamIndex: 1 }), false);
    assert.equal(should({ audioStreamIndex: 5 }), false);
    assert.equal(should({ backendType: 'html5' }), false);
    assert.equal(should({ userPlaybackMode: 'remux' }), false);
    assert.equal(should({ userPlaybackMode: 'auto' }), false);
    assert.equal(should({ requestedPlaybackMode: 'transcode' }), false);
    assert.equal(should({ wasEscalated: true }), false);
    assert.equal(should({ needsAudioRemux: false }), false);
    assert.equal(should({ trackPlayable: false }), false);
    assert.equal(should({ isLiveTv: true }), false);
    assert.equal(should({ mediaSource: { ...source(), Container: 'mp4' } }), false);
    assert.equal(should({ mediaSource: { ...source(), IsRemote: true } }), false);
});

test('progressive URL copies selected audio + video and retains playback auth/session', () => {
    const url = buildProgressiveAudioCopyUrl(source().TranscodingUrl, 3, 33545000000);
    assert.ok(url.startsWith('/Videos/movie-id/stream.mkv?'));
    const parsed = new URL(url, 'https://server.example');
    assert.equal(parsed.searchParams.get('MediaSourceId'), 'media-id');
    assert.equal(parsed.searchParams.get('PlaySessionId'), 'session');
    assert.equal(parsed.searchParams.get('ApiKey'), 'token');
    assert.equal(parsed.searchParams.get('AudioStreamIndex'), '3');
    assert.equal(parsed.searchParams.get('AudioCodec'), 'copy');
    assert.equal(parsed.searchParams.get('VideoCodec'), 'copy');
    assert.equal(parsed.searchParams.get('Static'), 'false');
    assert.equal(parsed.searchParams.get('Container'), 'mkv');
    assert.equal(parsed.searchParams.get('StartTimeTicks'), '33545000000');
    for (const name of ['SegmentContainer','SegmentLength','AudioBitrate','TranscodeReasons']) {
        assert.equal(parsed.searchParams.has(name), false, name);
    }
});

test('does not construct progressive stream for unrelated/invalid URLs', () => {
    assert.equal(buildProgressiveAudioCopyUrl('/Videos/foo/stream.mkv?AudioCodec=ac3', 3), null);
    assert.equal(buildProgressiveAudioCopyUrl('/Videos/foo/master.m3u8', 3).includes('AudioStreamIndex=3'), true);
    assert.equal(buildProgressiveAudioCopyUrl(null, 3), null);
    assert.equal(buildProgressiveAudioCopyUrl('/Audio/foo/master.m3u8', 3), null);
});

test('applying progressive URL forces Native DirectStream instead of HLS transcode', () => {
    const ms = source();
    assert.equal(applyProgressiveAudioCopy(ms, 3, 33300000000), true);
    assert.match(ms.TranscodingUrl, /\/stream\.mkv\?/);
    assert.equal(ms.TranscodingContainer, 'mkv');
    assert.equal(ms._webosProgressiveAudioCopy, true);
    assert.equal(ms.SupportsDirectPlay, false);
    assert.equal(ms.SupportsDirectStream, true);
    assert.equal(ms.TranscodingInfo.IsVideoDirect, true);
    assert.equal(ms.TranscodingInfo.IsAudioDirect, false);
    assert.equal(ms.TranscodingInfo.AudioCodec, 'copy');
});

test('no mutation when server does not return a usable HLS URL', () => {
    const ms = source();
    delete ms.TranscodingUrl;
    const before = structuredClone(ms);
    assert.equal(applyProgressiveAudioCopy(ms, 3), false);
    assert.deepEqual(ms, before);
});
