import assert from 'node:assert/strict';
import test from 'node:test';
import {
    shouldUseProgressiveAudioCopy,
    buildProgressiveAudioCopyUrl,
    applyProgressiveAudioCopy,
    getFailedAudioSwitchRestartMode
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
    assert.equal(should({ userPlaybackMode: 'auto' }), true);
    assert.equal(should({ userPlaybackMode: 'auto', forceDirectPlay: 'all' }), true);
    assert.equal(should({ userPlaybackMode: 'auto', forceDirectPlay: 'audio' }), true);
    assert.equal(should({ userPlaybackMode: 'remux', forceDirectPlay: 'all' }), false);
    assert.equal(should({ requestedPlaybackMode: 'transcode' }), false);
    assert.equal(should({ requestedPlaybackMode: 'remux', userPlaybackMode: 'remux' }), false);
    assert.equal(should({ hasManualBitrate: true }), false);
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
    assert.equal(ms.TranscodingSubProtocol, null);
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

test('global Force Direct Play: construct progressive MKV when strict PlaybackInfo has no TranscodingUrl', () => {
    const ms = source();
    delete ms.TranscodingUrl;
    const auth = {
        itemId: 'movie-id',
        mediaSourceId: ms.Id,
        playSessionId: 'session-xyz',
        authToken: 'secret-123'
    };
    const url = buildProgressiveAudioCopyUrl(undefined, 3, 33000000000, auth);
    assert.ok(url.startsWith('/Videos/movie-id/stream.mkv?'));
    const parsed = new URL(url, 'https://server.local');
    assert.equal(parsed.searchParams.get('MediaSourceId'), 'media-id');
    assert.equal(parsed.searchParams.get('PlaySessionId'), 'session-xyz');
    assert.equal(parsed.searchParams.get('ApiKey'), 'secret-123');
    assert.equal(parsed.searchParams.get('VideoCodec'), 'copy');
    assert.equal(parsed.searchParams.get('AudioCodec'), 'copy');
    assert.equal(parsed.searchParams.get('AudioStreamIndex'), '3');
    assert.equal(parsed.searchParams.get('StartTimeTicks'), '33000000000');
    assert.equal(applyProgressiveAudioCopy(ms, 3, 33000000000, auth), true);
    assert.equal(ms._webosProgressiveAudioCopy, true);
    assert.equal(ms.SupportsDirectStream, true);
    assert.equal(ms.TranscodingUrl, url);
});

test('never generate unauthenticated synthetic URLs without media identity', () => {
    assert.equal(buildProgressiveAudioCopyUrl(null, 3, 0, {}), null);
    assert.equal(buildProgressiveAudioCopyUrl(null, 3, 0, { itemId: 'movie-id' }), null);
});

test('Auto audio-track restart retains copy eligibility after Direct Play falls into HLS', () => {
    // Previous implementation rejected Auto if an in-player Direct Play
    // selection was reset during an internal restart. It also checked
    // trackPlayable against PlaybackInfo's HLS transcoding session.
    const ms = source();
    assert.equal(should({
        userPlaybackMode: 'auto',
        requestedPlaybackMode: 'auto',
        mediaSource: ms,
        audioStreamIndex: 3,
        needsAudioRemux: true,
        trackPlayable: true
    }), true);
    assert.equal(should({
        userPlaybackMode: 'auto',
        requestedPlaybackMode: 'auto',
        mediaSource: ms,
        audioStreamIndex: 3,
        needsAudioRemux: true,
        trackPlayable: false
    }), false);
});

test('webOS failed native audio switch does not force an explicit fMP4 HLS remux', () => {
    assert.equal(getFailedAudioSwitchRestartMode('webos', 'directPlay', 'directPlay'), 'directPlay');
    assert.equal(getFailedAudioSwitchRestartMode('webos', 'directPlay', 'auto'), 'directPlay');
    assert.equal(getFailedAudioSwitchRestartMode('webos', 'directPlay', 'transcode'), 'transcode');
    assert.equal(getFailedAudioSwitchRestartMode('webos', 'auto', 'auto'), 'auto');
    assert.equal(getFailedAudioSwitchRestartMode('webos', 'auto', 'remux'), 'auto');
    assert.equal(getFailedAudioSwitchRestartMode('webos', 'remux', 'remux'), 'remux');
    assert.equal(getFailedAudioSwitchRestartMode('webos', 'transcodeAudio', 'auto'), 'transcodeAudio');
    assert.equal(getFailedAudioSwitchRestartMode('webos', 'transcodeVideo', 'auto'), 'transcodeVideo');
    assert.equal(getFailedAudioSwitchRestartMode('webos', 'auto', 'transcode'), 'transcode');
    assert.equal(getFailedAudioSwitchRestartMode('webos', 'transcode', 'transcode'), 'transcode');
    assert.equal(getFailedAudioSwitchRestartMode('html5', 'auto', 'directPlay'), 'remux');
    assert.equal(getFailedAudioSwitchRestartMode('tizen', 'auto', 'auto'), 'remux');
});

test('WebOS failed switch keeps explicit Direct Play and reaches progressive AC3 copying', () => {
    const selectedPlaybackMode = getFailedAudioSwitchRestartMode('webos', 'directPlay', 'directPlay');
    assert.equal(selectedPlaybackMode, 'directPlay');
    assert.equal(should({
        userPlaybackMode: 'directPlay',
        requestedPlaybackMode: selectedPlaybackMode,
        needsAudioRemux: true,
        audioStreamIndex: 3,
        trackPlayable: true
    }), true);
});

test('LG C4 proactively copies non-default AC3 stereo and 5.1 even when the codec probe fails', () => {
    for (const index of [2, 3]) {
        const ms = source();
        ms.TranscodingSubProtocol = 'hls';
        assert.equal(should({
            deviceModel: 'OLED65C4PUA',
            audioStreamIndex: index,
            trackPlayable: false,
            needsAudioRemux: false,
            mediaSource: ms
        }), true, 'C4 must not depend on the webOS codec probe or a previous failed track switch');
        assert.equal(applyProgressiveAudioCopy(ms, index, 150000000), true);
        assert.match(ms.TranscodingUrl, /\/stream\.mkv\?/);
        assert.equal(new URL(ms.TranscodingUrl, 'https://test.invalid').searchParams.get('AudioCodec'), 'copy');
        assert.equal(new URL(ms.TranscodingUrl, 'https://test.invalid').searchParams.get('AudioStreamIndex'), String(index));
        assert.equal(ms.TranscodingSubProtocol, null);
    }
});

test('non-C4 and unsupported audio codecs do not gain the C4 AC3 probe exemption', () => {
    assert.equal(should({
        deviceModel: 'OLED65C3',
        audioStreamIndex: 2,
        trackPlayable: false,
        needsAudioRemux: false
    }), false);
    assert.equal(should({
        deviceModel: 'OLED65C4',
        audioStreamIndex: 4,
        trackPlayable: false,
        needsAudioRemux: false
    }), false);
    assert.equal(should({
        deviceModel: 'OLED65C4',
        audioStreamIndex: 5,
        trackPlayable: true,
        needsAudioRemux: true
    }), false);
    assert.equal(should({
        deviceModel: 'OLED65C4',
        audioStreamIndex: 1,
        trackPlayable: true,
        needsAudioRemux: true
    }), false);
    assert.equal(should({
        deviceModel: 'OLED65C4',
        audioStreamIndex: 3,
        trackPlayable: false,
        needsAudioRemux: false,
        userPlaybackMode: 'transcode'
    }), false);
});
