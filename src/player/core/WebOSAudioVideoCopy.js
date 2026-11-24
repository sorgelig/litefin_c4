// HLS profiles use actual codec names, not the FFmpeg "-c:v copy" pseudo-codec.
export function nativeHlsVideoCodecs({ hevc, av1, vp9, native, container }) {
    const codecs = ['h264'];
    if (hevc) codecs.push('hevc');
    // AV1/VP9 are valid in fMP4. Keep the existing TS / HTML5 behavior.
    if (native && container === 'mp4') {
        if (av1) codecs.push('av1');
        if (vp9) codecs.push('vp9');
    }
    return codecs.join(',');
}

export function chooseWebOSFailureMode({ backend, mode, method, source, profile, manualBitrate }) {
    // Retry audio only at most once and never undo explicit video transcoding.
    if (backend !== 'webos' || manualBitrate > 0 ||
        ['transcode', 'transcodeVideo', 'transcodeAudio'].includes(mode) ||
        !['DirectPlay', 'Remux'].includes(method) ||
        !source || source.IsRemote || source.RequiresOpening || source.LiveStreamId) {
        return 'transcode';
    }
    const video = source.MediaStreams?.find(s => String(s.Type).toLowerCase() === 'video');
    const codec = String(video?.Codec || '').toLowerCase();
    if (!codec || video.IsInterlaced) return 'transcode';
    // Only attempt the intermediate step when the normal native profile
    // advertises that video codec; the server still evaluates its constraints.
    const supported = (profile?.DirectPlayProfiles || []).some(p =>
        p.Type === 'Video' && String(p.VideoCodec || '').toLowerCase().split(',').includes(codec));
    const supportedHls = (profile?.TranscodingProfiles || []).some(p =>
        p.Type === 'Video' && String(p.Protocol).toLowerCase() === 'hls' &&
        String(p.VideoCodec || '').toLowerCase().split(',').includes(codec));
    return supported && supportedHls ? 'transcodeAudio' : 'transcode';
}
