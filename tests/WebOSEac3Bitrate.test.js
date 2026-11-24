import test from 'node:test';
import assert from 'node:assert/strict';
import { requestEac3Bitrate, EAC3_TEST_BITRATE } from '../src/player/core/WebOSEac3Bitrate.js';

test('raise negotiated EAC3 encode request without changing other URL parameters', () => {
    for (const codec of ['eac3', 'EAC3', 'eac3,ac3', 'eac3%2Cac3']) {
        const original = '/Videos/id/master.m3u8?VideoCodec=hevc&AudioCodec=' + codec + '&AudioBitrate=640000&AudioStreamIndex=4&SegmentContainer=mp4&AllowVideoStreamCopy=true';
        const source = { TranscodingUrl: original };
        assert.equal(requestEac3Bitrate(source, 'DirectStream', 'webos', false), true);
        assert.equal(source.TranscodingUrl, original.replace('640000', String(EAC3_TEST_BITRATE)));
    }
});
test('append missing bitrate, support progressive encodes, retain fragments', () => {
    const source = { TranscodingUrl: '/Videos/id/stream.mp4?AudioCodec=eac3#fragment' };
    assert.equal(requestEac3Bitrate(source, 'Transcode', 'webos', false), true);
    assert.equal(source.TranscodingUrl, '/Videos/id/stream.mp4?AudioCodec=eac3&AudioBitrate=1536000#fragment');
});
test('never modify direct play, remux, audio copy, other codecs or other backends', () => {
    for (const [method, backend, copy, codec, suffix] of [
        ['DirectPlay','webos',false,'eac3',''],
        ['Remux','webos',false,'eac3',''],
        ['DirectStream','webos',true,'eac3',''],
        ['Transcode','tizen',false,'eac3',''],
        ['Transcode','webos',false,'ac3',''],
        ['Transcode','webos',false,'aac,eac3',''],
        ['Transcode','webos',false,'dts',''],
        ['Transcode','webos',false,'eac3','&Static=true'],
    ]) {
        const url = '/Videos/id/master.m3u8?AudioCodec=' + codec + '&AudioBitrate=640000' + suffix;
        const source = { TranscodingUrl: url };
        assert.equal(requestEac3Bitrate(source, method, backend, copy), false);
        assert.equal(source.TranscodingUrl, url);
    }
});
