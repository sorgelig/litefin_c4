import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/player/core/JellyfinPlayer.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function extractMethod(signature) {
    const start = source.indexOf('\n    ' + signature);
    assert.ok(start !== -1, 'method missing: ' + signature);
    const end = source.indexOf('\n    }\n', start);
    assert.ok(end > start, 'method end missing: ' + signature);
    return source.slice(start + 1, end + 6);
}
const methods = vm.runInNewContext('({\n' + [
    'seek(positionTicks, options = {}) {',
    'getCurrentPositionMs() {',
    'getCurrentPositionTicks() {'
].map(extractMethod).join(',\n') + '\n})', {
    log: { info() {}, warn() {}, error() {} },
    PlayerEvent: { RESTARTING: 'restarting' },
    setTimeout, clearTimeout, Date
});

function makePlayer({ progressive = true, paused = false } = {}) {
    const nativeSeeks = [], restarts = [], events = [];
    const playOptions = {
        itemId: 'movie', mediaSourceId: 'source', playbackMode: 'directPlay',
        audioStreamIndex: 2, subtitleStreamIndex: -1, startPositionTicks: 0
    };
    const p = Object.assign(Object.create(methods), {
        _backendType: 'webos',
        _currentMediaSource: { _webosProgressiveAudioCopy: progressive },
        _currentAudioStreamIndex: 3,
        _currentSubtitleStreamIndex: 11,
        _currentSecondarySubtitleStreamIndex: -1,
        _playbackMode: 'directPlay',
        _userPlaybackMode: 'directPlay',
        _isPaused: paused,
        _currentPlayOptions: playOptions,
        _lastPlayOptions: playOptions,
        _transcodingOffsetTicks: 2000000000,
        _progressiveSeekPositionTicks: null,
        _isSeeking: false,
        _seekFailsafeTimeout: null,
        _subtitleManager: { resetActiveCues() {} },
        _backend: { seek(ticks) { nativeSeeks.push(ticks); }, getCurrentTime: () => 5 },
        emit(type, data) { events.push({ type, data }); },
        async stop() { this._isSeeking = false; },
        async _playAfterRestartPause(options, pauseMs) { restarts.push({ options, pauseMs }); return true; }
    });
    return { p, nativeSeeks, restarts, events };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('C4 progressive MKV seek restarts a copy stream at absolute timeline ticks', async () => {
    const { p, nativeSeeks, restarts, events } = makePlayer();
    const target = 36500000000;
    p.seek(target);
    // During stop/reload the old webOS currentTime must not roll the clock back.
    assert.equal(p.getCurrentPositionTicks(), target);
    assert.equal(p.getCurrentPositionMs(), target / 10000);
    await flush();
    assert.equal(nativeSeeks.length, 0, 'must not seek inside unindexed MKV using currentTime');
    assert.equal(restarts.length, 1);
    const opts = restarts[0].options;
    assert.equal(opts.startPositionTicks, target);
    assert.equal(opts.audioStreamIndex, 3);
    assert.equal(opts.subtitleStreamIndex, 11);
    assert.equal(opts.playbackMode, 'directPlay');
    assert.equal(opts._forceDirectStream, true);
    assert.equal(restarts[0].pauseMs, 0);
    assert.ok(events.some(e => e.type === 'restarting'));
    assert.ok(events.some(e => e.type === 'seek' && e.data.positionTicks === target));
    assert.equal(p._isRestarting, false);
    assert.equal(p._progressiveSeekPositionTicks, null);
});

test('C4 progressive seek preserves manual pause across stream restart', async () => {
    const { p, restarts } = makePlayer({ paused: true });
    p.seek(19000000000);
    await flush();
    assert.equal(restarts[0].options.autoPlay, false);
});

test('C4: native seeks remain unchanged for ordinary direct play and HLS', async () => {
    const { p, nativeSeeks, restarts } = makePlayer({ progressive: false });
    p.seek(43000000000);
    await flush();
    assert.deepEqual(nativeSeeks, [43000000000]);
    assert.equal(restarts.length, 0);
});

test('relative seeks read the pending target instead of the prior progressive stream', () => {
    const { p } = makePlayer();
    p._isSeeking = true;
    p._seekTargetTicks = 28000000000;
    assert.equal(p.getCurrentPositionMs(), 2800000);
    p._isSeeking = false;
    assert.equal(p.getCurrentPositionMs(), 205000);
});
