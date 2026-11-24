/**
 * Request a high E-AC3 encoding bitrate without changing the negotiated
 * codec, channel count, transport, or the video stream-copy decision.
 * Jellyfin may clamp the requested value; this is NOT a measured bitrate.
 */
export const EAC3_TEST_BITRATE = 1536000;
export const EAC3_BITRATES = Object.freeze([0, 640000, 768000, 1024000, 1536000, 2048000, 3072000, 4096000, 6144000]);

export function requestEac3Bitrate(mediaSource, playMethod, backendType, isAudioDirect, requestedBitrate = EAC3_TEST_BITRATE) {
    const selectedBitrate = Number(requestedBitrate);
    // Zero means retain the server's original negotiated bitrate.
    if (!selectedBitrate || !EAC3_BITRATES.includes(selectedBitrate)) return false;
    if (backendType !== 'webos' || isAudioDirect ||
        !['DirectStream', 'Transcode'].includes(playMethod)) return false;

    const url = mediaSource?.TranscodingUrl;
    if (typeof url !== 'string' || !url.includes('?')) return false;
    const codecMatch = /[?&]AudioCodec=([^&#]+)/i.exec(url);
    if (!codecMatch) return false;
    let codec;
    try { codec = decodeURIComponent(codecMatch[1]).split(',')[0].trim().toLowerCase(); }
    catch { return false; }
    if (codec !== 'eac3') return false;

    // Do not override a stream that is explicitly being copied.
    if (/[?&]Static=true(?:&|#|$)/i.test(url)) return false;
    const bitrate = /([?&]AudioBitrate=)[^&#]*/i;
    const hashIndex = url.indexOf('#');
    const base = hashIndex < 0 ? url : url.slice(0, hashIndex);
    const fragment = hashIndex < 0 ? '' : url.slice(hashIndex);
    const modified = bitrate.test(base)
        ? base.replace(bitrate, (_, prefix) => prefix + selectedBitrate)
        : base + '&AudioBitrate=' + selectedBitrate;
    mediaSource.TranscodingUrl = modified + fragment;
    return true;
}
