/**
 * Native webOS bitstream preservation for a non-default MKV audio track.
 *
 * A static MKV URL does not select AudioStreamIndex (Jellyfin simply sends
 * the original file), while the default HLS remux can decode compressed audio
 * to PCM at the TV's ARC output. Use a progressive server-side MKV remux:
 * FFmpeg copies both video and selected AC3/EAC3/DTS packets with no encoding.
 *
 * Only for native webOS, when a user selected Direct Play and the active
 * track cannot be selected in-place. The normal player error fallback remains
 * available if an individual TV/codec rejects progressive remux playback.
 */

const COPY_AUDIO_CODECS = new Set(['ac3', 'eac3', 'dts', 'dca']);

export function shouldUseProgressiveAudioCopy({
    backendType,
    userPlaybackMode,
    forceDirectPlay,
    requestedPlaybackMode,
    mediaSource,
    audioStreamIndex,
    needsAudioRemux,
    trackPlayable,
    hasManualBitrate = false,
    wasEscalated = false,
    isLiveTv = false
}) {
    // Auto also prefers original audio for a supported non-default track.
    // The in-player Direct Play mode may be reset to Auto during an internal
    // audio-track restart; requiring an exact 'directPlay' string here would
    // wrongly re-encode that track as the selected HLS codec.
    if (backendType !== 'webos') return false;
    // Respect deliberate remux/transcode choices and quality limits.
    if (['remux', 'transcode', 'transcodeAudio', 'transcodeVideo'].includes(userPlaybackMode)) return false;
    if (wasEscalated || isLiveTv || hasManualBitrate) return false;
    if (['transcode', 'transcodeAudio', 'transcodeVideo'].includes(requestedPlaybackMode)) return false;
    if (!needsAudioRemux || !trackPlayable) return false;

    const container = String(mediaSource?.Container || '').toLowerCase();
    if (container !== 'mkv' && container !== 'matroska') return false;
    if (mediaSource?.IsRemote || mediaSource?.RequiresOpening || mediaSource?.LiveStreamId) return false;

    const streams = mediaSource.MediaStreams || [];
    const audios = streams.filter(s => s.Type === 'Audio');
    const selected = audios.find(s => Number(s.Index) === Number(audioStreamIndex));
    const physicalDefault = audios.find(s => s.IsDefault) || audios[0];
    if (!selected || !physicalDefault || selected.Index === physicalDefault.Index) return false;
    return COPY_AUDIO_CODECS.has(String(selected.Codec || '').toLowerCase());
}

/**
 * Derive a progressive /stream.mkv endpoint from Jellyfin's server-generated
 * HLS transcoding URL. This retains authenticated PlaybackInfo identifiers,
 * stream selections and session parameters but requests stream copy instead
 * of the user's HLS audio transcode target. Never rewrite other endpoints.
 */
export function buildProgressiveAudioCopyUrl(transcodingUrl, audioStreamIndex, startPositionTicks = 0, fallback = null) {
    let url;
    if (typeof transcodingUrl === 'string' && transcodingUrl) {
        try {
            url = new URL(transcodingUrl, 'http://jellyfin.invalid');
        } catch {
            return null;
        }
        const suffix = '/master.m3u8';
        if (!url.pathname.includes('/Videos/') || !url.pathname.endsWith(suffix)) return null;
        url.pathname = url.pathname.slice(0, -suffix.length) + '/stream.mkv';
    } else if (fallback?.itemId && fallback?.mediaSourceId) {
        // Strict Direct Play disables transcoding profiles, so PlaybackInfo has
        // no HLS URL to rewrite. Build the standard progressive Jellyfin endpoint
        // with the requested media source and the existing authenticated session.
        url = new URL(
            '/Videos/' + encodeURIComponent(fallback.itemId) + '/stream.mkv',
            'http://jellyfin.invalid'
        );
        url.searchParams.set('MediaSourceId', fallback.mediaSourceId);
        if (fallback.playSessionId) url.searchParams.set('PlaySessionId', fallback.playSessionId);
        if (fallback.authToken) url.searchParams.set('ApiKey', fallback.authToken);
    } else {
        return null;
    }

    for (const key of [
        'SegmentContainer', 'SegmentLength', 'MinSegments',
        'BreakOnNonKeyFrames', 'TranscodeReasons', 'AudioBitrate',
        'AudioChannels', 'MaxAudioChannels', 'TranscodingMaxAudioChannels'
    ]) url.searchParams.delete(key);

    url.searchParams.set('Static', 'false');
    url.searchParams.set('Container', 'mkv');
    url.searchParams.set('VideoCodec', 'copy');
    url.searchParams.set('AudioCodec', 'copy');
    url.searchParams.set('AllowVideoStreamCopy', 'true');
    url.searchParams.set('AllowAudioStreamCopy', 'true');
    url.searchParams.set('AudioStreamIndex', String(audioStreamIndex));
    url.searchParams.set('StartTimeTicks', String(Math.max(0, Number(startPositionTicks) || 0)));

    // TranscodingUrl is relative to the configured serverUrl; don't introduce
    // an absolute unrelated origin into the player's stream URL.
    return url.pathname + url.search;
}

/**
 * Convert PlaybackInfo's selected MediaSource to the progressive copy stream
 * only when it can be constructed safely. A true result must be used before
 * MediaHelper.getPlayMethod() chooses HLS/native playback.
 */
export function applyProgressiveAudioCopy(mediaSource, audioStreamIndex, startPositionTicks = 0, fallback = null) {
    const url = buildProgressiveAudioCopyUrl(mediaSource?.TranscodingUrl, audioStreamIndex, startPositionTicks, fallback);
    if (!url) return false;

    mediaSource.TranscodingUrl = url;
    mediaSource.TranscodingContainer = 'mkv';
    // The progressive stream contains only the selected track; do not ask the
    // native webOS audioTracks API to select another track from that stream.
    mediaSource._webosProgressiveAudioCopy = true;
    mediaSource.SupportsDirectPlay = false;
    mediaSource.SupportsDirectStream = true;
    mediaSource.TranscodingInfo = {
        IsVideoDirect: true,
        IsAudioDirect: false,
        VideoCodec: 'copy',
        AudioCodec: 'copy'
    };
    return true;
}
