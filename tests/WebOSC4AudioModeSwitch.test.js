import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the real JellyfinPlayer methods without requiring a DOM or webOS runtime.
const source = readFileSync(new URL('../src/player/core/JellyfinPlayer.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function extractMethod(signature) {
    const start = source.indexOf('\n    ' + signature);
    assert.ok(start !== -1, 'method not found: ' + signature);
    const end = source.indexOf('\n    }\n', start);
    assert.ok(end > start, 'method end not found: ' + signature);
    return source.slice(start + 1, end + 6);
}

function makePlayer() {
    const methods = vm.runInNewContext('({\n' + [
        'getPlaybackMode() {',
        'async setPlaybackMode(mode) {',
        'async setAudioStreamIndex(index) {'
    ].map(extractMethod).join(',\n') + '\n})', {
        PlayerSettings: { get: () => undefined },
        PlayerEvent: { RESTARTING: 'restarting', MEDIA_STREAMS_CHANGE: 'streams-change' },
        log: { info() {}, warn() {}, error() {}, debug() {} },
        prewarmManager: { invalidateCache() {} },
        isAudioTrackNativelyPlayable: () => true,
        doesAudioTrackRequireDirectStream: (_ms, index) => Number(index) !== 1
    });
    const ms = {
        Id: 'media-1',
        Container: 'mkv',
        MediaStreams: [
            { Type: 'Video', Index: 0, Codec: 'h264' },
            { Type: 'Audio', Index: 1, Codec: 'dts', IsDefault: true },
            { Type: 'Audio', Index: 2, Codec: 'ac3', IsDefault: false },
            { Type: 'Audio', Index: 3, Codec: 'ac3', IsDefault: false }
        ]
    };
    const calls = [];
    const opts = {
        itemId: 'movie-1', mediaSourceId: ms.Id, audioStreamIndex: 2,
        playbackMode: 'directPlay', startPositionTicks: 0
    };
    const player = Object.assign(Object.create(methods), {
        _backendType: 'webos',
        _currentPlayMethod: 'DirectStream',
        _playbackMode: 'directPlay',
        _userPlaybackMode: 'directPlay',
        _directPlayEscalated: false,
        _isPlaying: true, _isPaused: false, _state: 'playing',
        _audioRestartInProgress: false, _isRestarting: false,
        _currentAudioStreamIndex: 2,
        _currentSubtitleStreamIndex: -1,
        _currentSecondarySubtitleStreamIndex: -1,
        _currentItem: { MediaSources: [ms] },
        _currentMediaSource: { ...ms, _webosProgressiveAudioCopy: true },
        _currentPlayOptions: opts,
        _lastPlayOptions: opts,
        _backend: { supportsNativeAudioTracks: () => true },
        getAudioTracks: () => ms.MediaStreams.filter(s => s.Type === 'Audio'),
        getCurrentPositionTicks: () => 1200000000,
        emit() {},
        async stop() {},
        async _playAfterRestartPause(options, pauseMs) {
            calls.push({ options, pauseMs });
            return true;
        }
    });
    return { player, calls };
}

test('C4: changing AC3 tracks keeps explicit Direct Play through restart', async () => {
    const { player, calls } = makePlayer();
    await player.setAudioStreamIndex(3);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.audioStreamIndex, 3);
    assert.equal(calls[0].options.playbackMode, 'directPlay');
    assert.equal(calls[0].options._forceDirectStream, true);
    assert.equal(player.getPlaybackMode(), 'directPlay');
    assert.equal(player._isRestarting, false);
});

test('C4: switching back to physical default preserves explicit Direct Play', async () => {
    const { player, calls } = makePlayer();
    await player.setAudioStreamIndex(1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.playbackMode, 'directPlay');
    assert.equal(calls[0].options._forceDirectStream, false);
});

test('C4: Auto track switching is still Auto; genuine transcode fallback is not overridden', async () => {
    const { player, calls } = makePlayer();
    player._userPlaybackMode = 'auto';
    player._playbackMode = 'remux';
    await player.setAudioStreamIndex(3);
    assert.equal(calls[0].options.playbackMode, 'auto');
    const fallback = makePlayer();
    fallback.player._playbackMode = 'transcode';
    fallback.player._directPlayEscalated = true;
    await fallback.player.setAudioStreamIndex(3);
    assert.equal(fallback.calls[0].options.playbackMode, 'auto');
});

test('C4: reselecting highlighted Direct Play repairs an Auto session', async () => {
    const { player, calls } = makePlayer();
    player._playbackMode = 'auto';
    player._directPlayEscalated = true;
    player._currentMediaSource._webosProgressiveAudioCopy = false;
    await player.setPlaybackMode('directPlay');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.playbackMode, 'directPlay');
    assert.equal(player._directPlayEscalated, false);
    assert.equal(player.getPlaybackMode(), 'directPlay');
});

test('C4: same-mode Direct Play reattempts an actual Transcode session', async () => {
    const { player, calls } = makePlayer();
    player._currentPlayMethod = 'Transcode';
    player._currentMediaSource._webosProgressiveAudioCopy = false;
    await player.setPlaybackMode('directPlay');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.playbackMode, 'directPlay');
});

test('C4: healthy progressive MKV copy does not restart on redundant mode selection', async () => {
    const { player, calls } = makePlayer();
    await player.setPlaybackMode('directPlay');
    assert.equal(calls.length, 0);
});
