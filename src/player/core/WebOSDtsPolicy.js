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

/**
 * Jellyfin's StreamBuilder defaults to 192 kbps for DTS because the codec is
 * not explicitly handled in GetDefaultAudioBitrate. FFmpeg's dca encoder
 * rejects that bitrate for 5.1 audio. The server exposes AudioBitrate in the
 * generated transcoding URL, which can be corrected before requesting HLS.
 *
 * Use DTS core's standard 1536 kbps bitrate; leave all other codecs untouched.
 * The source and server's selected VideoCodec/AudioCodec/stream indices remain
 * unchanged.
 *
 * @param {Object} mediaSource - Jellyfin PlaybackInfo MediaSource (mutated)
 * @returns {boolean} whether a DTS HLS URL was updated
 */
export function setDtsHlsTranscodeBitrate(mediaSource) {
    if (!mediaSource || typeof mediaSource.TranscodingUrl !== 'string') return false;

    const url = mediaSource.TranscodingUrl;
    // The server's HLS URL is a relative /Videos/.../master.m3u8?AudioCodec=dts...
    if (!/\.m3u8(?:\?|$)/i.test(url)) return false;
    if (!/[?&]AudioCodec=(?:dts|dca)(?:&|$)/i.test(url)) return false;

    const dtsBitrate = 1536000;
    const bitratePattern = /([?&]AudioBitrate=)\d+/i;
    const modifiedUrl = bitratePattern.test(url)
        ? url.replace(bitratePattern, (_, key) => key + dtsBitrate)
        : url + (url.includes('?') ? '&' : '?') + 'AudioBitrate=' + dtsBitrate;

    if (modifiedUrl === url) return false;
    mediaSource.TranscodingUrl = modifiedUrl;
    return true;
}
