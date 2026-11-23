/**
 * C4 DTS playback policy.
 *
 * DTS pass-through on LG C4 works through native progressive Direct Play, but
 * the standard Jellyfin profile can steer a DTS source into HLS/remux for
 * unrelated compatibility reasons. On Auto, prefer the already-tested native
 * path and leave explicit Remux/Transcode choices alone.
 *
 * A DTS audio stream can be copied into fMP4 HLS. Converting a DIFFERENT codec
 * to DTS is not safe without server-side experimental FFmpeg configuration;
 * pick AC3 instead of sending an unplayable DTS encoder request.
 */
export function isDtsAudioCodec(codec) {
    const c = String(codec || '').trim().toLowerCase();
    return c === 'dts' || c === 'dca' || c.startsWith('dts-') || c.startsWith('dtshd') ||
        c.startsWith('dts_');
}

export function getRequestedAudioCodec(options) {
    const sources = options?.item?.MediaSources;
    const source = (Array.isArray(sources)
        ? (sources.find((s) => s.Id === options.mediaSourceId) || sources[0])
        : null) || options?.mediaSource;
    const streams = source?.MediaStreams?.filter((stream) => stream.Type === 'Audio') || [];
    if (!streams.length) return null;
    const selectedIndex = Number(options?.audioStreamIndex);
    const requested = options?.audioStreamIndex != null && Number.isFinite(selectedIndex)
        ? streams.find((stream) => Number(stream.Index) === selectedIndex)
        : null;
    return (requested || streams.find((stream) => stream.IsDefault) || streams[0])?.Codec || null;
}

export function preferNativeDtsAuto({ backendType, dtsSupported, selectedCodec, playbackMode = 'auto', forceTranscode = false, hasManualBitrate = false }) {
    return backendType === 'webos' &&
        dtsSupported &&
        isDtsAudioCodec(selectedCodec) &&
        playbackMode === 'auto' &&
        !forceTranscode &&
        !hasManualBitrate;
}

/**
 * In a transcoding profile, prefer copying DTS from a DTS source. For other
 * sources, replace unusable DTS HLS encoding profiles with AC3 output.
 * This preserves codec compatibility without misrepresenting DTS encoding.
 */
export function avoidUnsupportedDtsEncode(deviceProfile, selectedCodec, preferredTranscodeCodec) {
    if (isDtsAudioCodec(selectedCodec)) return false;
    if (preferredTranscodeCodec !== 'force_dts' && preferredTranscodeCodec !== 'prefer_dts') return false;
    if (!Array.isArray(deviceProfile?.TranscodingProfiles)) return false;

    let modified = false;
    const fallback = [];
    for (const profile of deviceProfile.TranscodingProfiles) {
        if (profile.Type === 'Video' && profile.Protocol === 'hls' &&
            String(profile.AudioCodec || '').split(',').includes('dts')) {
            modified = true;
            if (preferredTranscodeCodec === 'force_dts') {
                fallback.push({ ...profile, AudioCodec: 'ac3' });
            }
            // Prefer DTS already has separate AC3/AAC profiles behind DTS;
            // dropping DTS lets Jellyfin select the working fallback.
        } else {
            fallback.push(profile);
        }
    }
    if (modified) deviceProfile.TranscodingProfiles = fallback;
    return modified;
}
