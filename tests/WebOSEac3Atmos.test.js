import test from 'node:test';
import assert from 'node:assert/strict';
import { isEac3Atmos, selectedAudioTrack, needsEac3AtmosEncode, forceEac3AtmosRequest, markEac3AtmosEncode, requiredAudioEncode, markTrueHdEncode } from '../src/player/core/WebOSEac3Atmos.js';
import { requestEac3Bitrate } from '../src/player/core/WebOSEac3Bitrate.js';
const plain = {Type:'Audio', Index:1, Codec:'eac3', Profile:'Dolby Digital Plus', IsDefault:true};
const atmos = {Type:'Audio', Index:2, Codec:'eac3', Profile:'Dolby Digital Plus + Dolby Atmos'};
test('detect Atmos only on E-AC3, including Jellyfin spatial flag and JOC profile', () => {
    assert.equal(isEac3Atmos(plain),false);
    assert.equal(isEac3Atmos(atmos),true);
    assert.equal(isEac3Atmos({...plain, AudioSpatialFormat:1}),true);
    assert.equal(isEac3Atmos({...plain, Profile:'E-AC-3 JOC'}),true);
    assert.equal(isEac3Atmos({...atmos, Codec:'truehd'}),false);
    assert.equal(isEac3Atmos({...plain, AudioSpatialFormat:0}),false);
    assert.equal(needsEac3AtmosEncode(atmos,'webos','disable'),true);
    assert.equal(needsEac3AtmosEncode(atmos,'webos','enable'),false);
    assert.equal(needsEac3AtmosEncode(plain,'webos','disable'),false);
    assert.equal(needsEac3AtmosEncode(atmos,'html5','disable'),false);
});
test('only selected track matters', () => {
    const src = {MediaStreams:[plain,atmos],DefaultAudioStreamIndex:2};
    assert.equal(selectedAudioTrack(src,1),plain);
    assert.equal(selectedAudioTrack(src,'2'),atmos);
    assert.equal(selectedAudioTrack(src),atmos);
    assert.equal(selectedAudioTrack(src,99),undefined);
});
test('force EAC3 re-encoding with video copy and never modify shared profile', () => {
    const profile = {DirectPlayProfiles:[{}], DirectStreamProfiles:[{}], TranscodingProfiles:[
        {Type:'Video', Protocol:'hls',Container:'mp4',AudioCodec:'aac',VideoCodec:'copy', MaxAudioChannels:8},
        {Type:'Video', Protocol:'hls',Container:'mp4',AudioCodec:'ac3',VideoCodec:'copy'},
        {Type:'Audio', Protocol:'http',Container:'mp3',AudioCodec:'mp3'}
    ]};
    const original = JSON.stringify(profile);
    const body = {EnableDirectPlay:true,AllowAudioStreamCopy:true};
    forceEac3AtmosRequest(body,profile,2,true);
    assert.equal(body.EnableDirectPlay,false);
    assert.equal(body.AllowAudioStreamCopy,false);
    assert.equal(body.AllowVideoStreamCopy,true);
    assert.equal(body.AudioStreamIndex,2);
    assert.equal(body.DeviceProfile.TranscodingProfiles.length,1);
    assert.equal(body.DeviceProfile.TranscodingProfiles[0].AudioCodec,'eac3');
    assert.equal(body.DeviceProfile.TranscodingProfiles[0].MaxAudioChannels,6);
    assert.equal(JSON.stringify(profile),original);
});
test('same-codec transcode URL is explicitly non-copy and accepts selected bitrate', () => {
    const source = {SupportsDirectPlay:true,TranscodingUrl:'/Videos/id/master.m3u8?VideoCodec=copy&AudioCodec=eac3&AudioBitrate=640000&AllowAudioStreamCopy=true'};
    markEac3AtmosEncode(source);
    assert.equal(source.SupportsDirectPlay,false);
    assert.match(source.TranscodingUrl,/AllowAudioStreamCopy=false/);
    assert.equal(requestEac3Bitrate(source,'DirectStream','webos',false,3072000),true);
    assert.match(source.TranscodingUrl,/AudioBitrate=3072000/);
    assert.throws(()=>markEac3AtmosEncode({TranscodingUrl:'/Videos/id/master.m3u8?AudioCodec=aac'}));
});

test('explicit TrueHD disable is a selected track policy regardless of other playable audio tracks', () => {
    const src = {MediaStreams:[
        {Type:'Audio', Index:1, Codec:'truehd', Profile:'TrueHD + Atmos', IsDefault:true},
        {Type:'Audio', Index:2, Codec:'ac3'},
        {...atmos, Index:3},
        {Type:'Audio', Index:4, Codec:'ac3'}
    ]};
    const policy = i => requiredAudioEncode(selectedAudioTrack(src,i),'webos','disable','disable');
    assert.equal(policy(1),'truehd');
    assert.equal(policy(2),null);
    assert.equal(policy(3),'eac3-atmos');
    assert.equal(policy(4),null);
    assert.equal(requiredAudioEncode(src.MediaStreams[0],'webos','disable','enable'),null);
    assert.equal(requiredAudioEncode(src.MediaStreams[0],'webos','disable','auto'),null);
    assert.equal(requiredAudioEncode(src.MediaStreams[0],'html5','disable','disable'),null);
    assert.equal(requiredAudioEncode({...src.MediaStreams[0],Codec:'mlp'},'webos','enable','disable'),'truehd');
    assert.equal(requiredAudioEncode(selectedAudioTrack({MediaStreams:[src.MediaStreams[0]]}),'webos','disable','disable'),'truehd');
});
test('TrueHD policy preserves chosen transcode audio profiles and video copy request', () => {
    const profile = {DirectPlayProfiles:[{}],DirectStreamProfiles:[{}],TranscodingProfiles:[
        {Type:'Video',Protocol:'hls',Container:'mp4',AudioCodec:'eac3',VideoCodec:'copy',MaxAudioChannels:6},
        {Type:'Video',Protocol:'hls',Container:'mp4',AudioCodec:'ac3',VideoCodec:'copy',MaxAudioChannels:6}
    ]};
    const body = {};
    forceEac3AtmosRequest(body,profile,1,true,false);
    assert.deepEqual(body.DeviceProfile.TranscodingProfiles,profile.TranscodingProfiles);
    assert.equal(body.EnableDirectPlay,false);
    assert.equal(body.AllowAudioStreamCopy,false);
    assert.equal(body.AllowVideoStreamCopy,true);
    assert.equal(body.AudioStreamIndex,1);
    const source = {SupportsDirectPlay:true,TranscodingUrl:'/Videos/id/master.m3u8?AudioCodec=eac3&AudioBitrate=640000&AllowAudioStreamCopy=true'};
    markTrueHdEncode(source);
    assert.equal(source.SupportsDirectPlay,false);
    assert.match(source.TranscodingUrl,/AllowAudioStreamCopy=false/);
    assert.equal(requestEac3Bitrate(source,'Transcode','webos',false,3072000),true);
    assert.match(source.TranscodingUrl,/AudioBitrate=3072000/);
    assert.throws(()=>markTrueHdEncode({TranscodingUrl:'/Videos/id/master.m3u8?AudioCodec=truehd'}));
});
