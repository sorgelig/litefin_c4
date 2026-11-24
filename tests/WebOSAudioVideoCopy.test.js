import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeHlsVideoCodecs, chooseWebOSFailureMode } from '../src/player/core/WebOSAudioVideoCopy.js';
test('advertise native HLS source video codecs instead of the copy pseudo-codec', () => {
    assert.equal(nativeHlsVideoCodecs({hevc:true, av1:true, vp9:true, native:true, container:'mp4'}),'h264,hevc,av1,vp9');
    assert.equal(nativeHlsVideoCodecs({hevc:true, av1:true, vp9:true, native:true, container:'ts'}),'h264,hevc');
    assert.equal(nativeHlsVideoCodecs({hevc:true, av1:true, vp9:true, native:false, container:'mp4'}),'h264,hevc');
    assert.equal(nativeHlsVideoCodecs({hevc:false, av1:false, vp9:false, native:true, container:'mp4'}),'h264');
});
const profile = { DirectPlayProfiles:[{Type:'Video',VideoCodec:'h264,hevc,av1'}], TranscodingProfiles:[{Type:'Video',Protocol:'hls',VideoCodec:'h264,hevc,av1'}] };
const options = {backend:'webos',mode:'auto',method:'DirectPlay',source:{MediaStreams:[{Type:'Video',Codec:'hevc'}]},profile};
test('try audio encode before full video encode on native supported video', () => {
    assert.equal(chooseWebOSFailureMode(options),'transcodeAudio');
    assert.equal(chooseWebOSFailureMode({...options,method:'Remux'}),'transcodeAudio');
    assert.equal(chooseWebOSFailureMode({...options,source:{MediaStreams:[{Type:'Video',Codec:'av1'}]}}),'transcodeAudio');
});
test('retain full fallback for actual video or incompatible situations; no loop', () => {
    for (const override of [{mode:'transcodeAudio'}, {mode:'transcodeVideo'}, {mode:'transcode'}, {method:'DirectStream'}, {method:'Transcode'}, {backend:'html5'}, {manualBitrate:1000000}, {source:{MediaStreams:[{Type:'Video',Codec:'mpeg4'}]}}, {source:{MediaStreams:[{Type:'Video',Codec:'hevc',IsInterlaced:true}]}}, {source:{...options.source,LiveStreamId:'live'}}, {profile:{DirectPlayProfiles:profile.DirectPlayProfiles,TranscodingProfiles:[]}}]) {
        assert.equal(chooseWebOSFailureMode({...options,...override}),'transcode');
    }
});
