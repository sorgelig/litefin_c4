/**
 * C4 DTS playback policy.
 *
 * DTS pass-through on LG C4 works through native progressive Direct Play, but
 * the standard Jellyfin profile can steer a DTS source into HLS/remux for
 * unrelated compatibility reasons. On Auto, prefer the already-tested native
 * path and leave explicit Remux/Transcode choices alone.
 *
 * Audio transcoding codec selection is handled by the Jellyfin device profile;
 * this helper only handles native Direct Play selection.
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
