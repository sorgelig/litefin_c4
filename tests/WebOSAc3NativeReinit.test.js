import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const jellyfin = readFileSync(new URL('../src/player/core/JellyfinPlayer.js', import.meta.url), 'utf8');
const webos = readFileSync(new URL('../src/player/core/WebOSPlayer.js', import.meta.url), 'utf8');
const helper = readFileSync(new URL('../src/player/core/MediaHelper.js', import.meta.url), 'utf8');

test('AC3 DirectPlay track switches restart static MKV without remux', () => {
    const start = jellyfin.indexOf('    async setAudioStreamIndex(index) {');
    const stop = jellyfin.indexOf('    async setSubtitleStreamIndex(index) {', start);
    assert.ok(start >= 0 && stop > start);
    const block = jellyfin.slice(start, stop);
    assert.match(block, /const nativeAc3ReloadTest = this\._backendType === 'webos'/);
    assert.match(block, /this\._currentPlayMethod === 'DirectPlay'/);
    assert.match(block, /const restartPlaybackMode = nativeAc3ReloadTest \? 'directPlay'/);
    assert.match(block, /_forceDirectStream: nativeAc3ReloadTest \? false/);
    assert.match(block, /_nativeAc3ReloadTest: nativeAc3ReloadTest/);
});

test('native player selects AC3 before play and does not fallback if tracks absent', () => {
    assert.match(webos, /this\._listen\(video, 'loadedmetadata', \(\) => \{/);
    assert.match(webos, /this\._tryPreselectNativeAc3\(video, options, 'canplay'\)/);
    assert.match(webos, /tracks\[idx\]\.enabled = true;/);
    assert.match(webos, /if \(!hls && options\.nativeAc3EarlySelect\) \{/);
    assert.match(webos, /this\._replaceVideoElement\(\);/);
});

test('new backend options only enable early AC3 for raw MKV DirectPlay', () => {
    assert.match(jellyfin, /nativeAc3EarlySelect: this\._backendType === 'webos'/);
    assert.match(jellyfin, /playMethod === 'DirectPlay'/);
    assert.match(jellyfin, /\^\(mkv\|matroska\)\$/);
    assert.match(helper, /Static=true/);
    assert.match(helper, /stream\.\$\{mediaSource\.Container\}/);
});
