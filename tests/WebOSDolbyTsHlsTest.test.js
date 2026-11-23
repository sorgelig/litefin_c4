import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  shouldUseDolbyTsHlsCopy, buildDolbyTsHlsUrl, applyDolbyTsHlsCopy
} from '../src/player/core/WebOSDolbyTsHlsTest.js';
import { shouldRestartDolbyProgressiveSeek } from '../src/player/core/WebOSDolbyProgressiveTest.js';

function mkv() {
    return {
        Id: 'source123', Container: 'mkv', SupportsDirectPlay: true,
        MediaStreams: [
            { Type: 'Video', Index: 0, Codec: 'hevc' },
            { Type: 'Audio', Index: 1, Codec: 'dts', IsDefault: true },
            { Type: 'Audio', Index: 2, Codec: 'ac3', Channels: 6 },
            { Type: 'Audio', Index: 3, Codec: 'eac3', Channels: 6 }
        ]
    };
}
function eligible(ms, index, overrides={}) {
    return shouldUseDolbyTsHlsCopy({
        backendType:'webos', mediaSource:ms, audioStreamIndex:index,
        playbackMode:'auto', userPlaybackMode:'auto',
        manualBitrate:null, isLiveTv:false, escalated:false,
        ...overrides
    });
}
test('only MKV Dolby tracks use HLS test, even when DTS is default', () => {
    const ms=mkv();
    assert.equal(eligible(ms,1),false);
    assert.equal(eligible(ms,2),true);
    assert.equal(eligible(ms,3),true);
    assert.equal(eligible(ms,2,{backendType:'html5'}),false);
    assert.equal(eligible(ms,2,{userPlaybackMode:'remux'}),false);
});
test('fMP4 URL becomes TS-HLS short segment with video/audio copy', () => {
    const url = buildDolbyTsHlsUrl({
        transcodingUrl:'/Videos/item123/master.m3u8?MediaSourceId=old&SegmentContainer=mp4&SegmentLength=6&AudioCodec=aac&VideoCodec=h264&AudioBitrate=256000&TranscodeReasons=AudioCodecNotSupported',
        itemId:'item123',mediaSourceId:'source123',playSessionId:'session1',
        authToken:'secret',audioStreamIndex:2
    });
    const u = new URL(url,'http://example.invalid');
    assert.equal(u.pathname,'/Videos/item123/master.m3u8');
    for(const [key,value] of Object.entries({
        SegmentContainer:'ts',Container:'ts',SegmentLength:'1',
        AudioCodec:'copy', VideoCodec:'copy',AudioStreamIndex:'2',
        MediaSourceId:'source123',ApiKey:'secret',
        AllowAudioStreamCopy:'true',AllowVideoStreamCopy:'true'
    })) assert.equal(u.searchParams.get(key),value,key);
    assert.equal(u.searchParams.has('TranscodeReasons'),false);
    assert.equal(u.searchParams.has('AudioBitrate'),false);
});
test('force direct play with no original HLS TranscodingUrl gets native TS HLS', () => {
    const ms=mkv();
    assert.equal(applyDolbyTsHlsCopy(ms,{
        itemId:'item123',audioStreamIndex:3,playSessionId:'session1'
    }),true);
    assert.equal(ms._webosDolbyTsHlsCopy,true);
    assert.equal(ms.SupportsDirectStream,true);
    assert.equal(ms.SupportsDirectPlay,false);
    assert.equal(ms.TranscodingSubProtocol,'hls');
    assert.equal(ms.TranscodingContainer,'ts');
    assert.equal(ms.TranscodingInfo.IsVideoDirect,true);
    assert.equal(ms.TranscodingInfo.IsAudioDirect,false);
    assert.equal(ms.TranscodingInfo.AudioCodec,'copy');
    assert.match(ms.TranscodingUrl,/master\.m3u8/);
    assert.equal(shouldRestartDolbyProgressiveSeek('webos',ms,{itemId:'item123'}),false);
});
test('player activates native TS-HLS but does not toggle original audio track', () => {
    const p=readFileSync(new URL('../src/player/core/WebOSPlayer.js',import.meta.url),'utf8');
    assert.match(p,/options\.mediaSource\?\._webosDolbyTsHlsCopy/);
    const j=readFileSync(new URL('../src/player/core/JellyfinPlayer.js',import.meta.url),'utf8');
    assert.match(j,/applyDolbyTsHlsCopy\(mediaSource/);
    assert.match(j,/shouldUseDolbyTsHlsCopy\(/);
    assert.match(j,/selectedDolbyForCopy \|\| isTranscoding/);
});
