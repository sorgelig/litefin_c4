// E-AC3 JOC/Atmos is an input-track property, not a different encoder codec.
export function isEac3Atmos(track) {
    if (!track || !['eac3', 'e-ac3', 'ec-3'].includes(String(track.Codec || '').toLowerCase())) return false;
    const spatial = String(track.AudioSpatialFormat ?? '').toLowerCase();
    return spatial === '1' || spatial === 'dolbyatmos' || spatial === 'atmos' ||
        /\b(?:atmos|joc)\b/i.test([track.Profile, track.DisplayTitle, track.Title].filter(Boolean).join(' '));
}
export function selectedAudioTrack(source, index) {
    const tracks = (source?.MediaStreams || []).filter(t => String(t.Type).toLowerCase() === 'audio');
    if (index != null && Number(index) >= 0) return tracks.find(t => Number(t.Index) === Number(index));
    const serverDefault = source?.DefaultAudioStreamIndex;
    return (serverDefault != null ? tracks.find(t => Number(t.Index) === Number(serverDefault)) : null) ||
        tracks.find(t => t.IsDefault) || tracks[0];
}
export function needsEac3AtmosEncode(track, backend, setting) {
    return backend === 'webos' && setting === 'disable' && isEac3Atmos(track);
}
// The selected input track, not the presence of other playable tracks, determines
// whether an explicitly disabled format must be encoded.
export function requiredAudioEncode(track, backend, atmosSetting, trueHdSetting) {
    if (backend !== 'webos') return null;
    if (needsEac3AtmosEncode(track, backend, atmosSetting)) return 'eac3-atmos';
    if (trueHdSetting === 'disable' &&
        ['truehd', 'mlp'].includes(String(track?.Codec || '').toLowerCase())) return 'truehd';
    return null;
}

export function forceEac3AtmosRequest(body, profile, index, copyVideo, forceEac3 = true) {
    const hlsProfiles = (profile.TranscodingProfiles || []).filter(p =>
        p.Type === 'Video' && String(p.Protocol).toLowerCase() === 'hls');
    if (!hlsProfiles.length) throw new Error('No HLS profile for selected-track audio conversion');
    const containers = new Set();
    const transcodingProfiles = forceEac3 ? hlsProfiles.filter(p => {
        if (containers.has(p.Container)) return false;
        containers.add(p.Container);
        return true;
    }).map(p => ({
        ...p,
        AudioCodec: 'eac3',
        MaxAudioChannels: Math.min(Number(p.MaxAudioChannels) || 6, 6)
    })) : hlsProfiles.map(p => ({ ...p }));
    Object.assign(body, {
        DeviceProfile: {
            ...profile,
            DirectPlayProfiles: [],
            DirectStreamProfiles: [],
            TranscodingProfiles: transcodingProfiles
        },
        AudioStreamIndex: index,
        EnableDirectPlay: false,
        EnableDirectStream: true,
        EnableTranscoding: true,
        AllowVideoStreamCopy: copyVideo,
        AllowAudioStreamCopy: false
    });
}
export function markEac3AtmosEncode(source) {
    const url = source?.TranscodingUrl;
    if (!url || !/[?&]AudioCodec=eac3(?:&|$)/i.test(url)) {
        throw new Error('Jellyfin did not negotiate E-AC3 Atmos conversion');
    }
    const copy = /([?&]AllowAudioStreamCopy=)[^&#]*/i;
    source.TranscodingUrl = copy.test(url)
        ? url.replace(copy, (_, prefix) => prefix + 'false')
        : url + '&AllowAudioStreamCopy=false';
    source.SupportsDirectPlay = false;
    source._litefinEac3AtmosEncode = true;
}

export function markTrueHdEncode(source) {
    const url = source?.TranscodingUrl;
    const codec = url?.match(/[?&]AudioCodec=([^&#]+)/i)?.[1];
    if (!codec || decodeURIComponent(codec).toLowerCase().split(',').some(c => ['truehd','mlp','copy'].includes(c.trim()))) {
        throw new Error('Jellyfin did not negotiate a compatible TrueHD audio encode');
    }
    const copy = /([?&]AllowAudioStreamCopy=)[^&#]*/i;
    source.TranscodingUrl = copy.test(url)
        ? url.replace(copy, (_, prefix) => prefix + 'false')
        : url + '&AllowAudioStreamCopy=false';
    source.SupportsDirectPlay = false;
    source._litefinForcedAudioEncode = true;
}
