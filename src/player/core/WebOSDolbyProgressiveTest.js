/**
 * Diagnostic: route AC3 / EAC3 from an MKV through a progressive MKV stream
 * with both original video and selected audio copied, not re-encoded.
 *
 * This is intentionally independent of the audioTracks switch strategy and
 * preserves the native webOS backend. The old v9 patch demonstrated that this
 * transport can preserve AC3 on LG C4, at the cost of slower FFmpeg-backed seeks.
 */
const DOLBY_CODECS = new Set(['ac3', 'eac3']);

export function isDolbyTrack(mediaSource, audioStreamIndex) {
    if (!Array.isArray(mediaSource?.MediaStreams) || audioStreamIndex == null) return false;
    const track = mediaSource.MediaStreams.find(
        stream => stream.Type === 'Audio' && Number(stream.Index) === Number(audioStreamIndex)
    );
    return DOLBY_CODECS.has(String(track?.Codec || '').toLowerCase());
}

export function shouldUseDolbyProgressiveCopy({
    backendType, mediaSource, audioStreamIndex, playbackMode,
    userPlaybackMode, manualBitrate, isLiveTv, escalated
}) {
    if (backendType !== 'webos' || isLiveTv || escalated || manualBitrate > 0) return false;
    if (['remux', 'transcode', 'transcodeAudio', 'transcodeVideo'].includes(userPlaybackMode)) return false;
    if (['remux', 'transcode', 'transcodeAudio', 'transcodeVideo'].includes(playbackMode)) return false;
    if (!['mkv', 'matroska'].includes(String(mediaSource?.Container || '').toLowerCase())) return false;
    if (mediaSource.IsRemote || mediaSource.RequiresOpening || mediaSource.LiveStreamId) return false;
    return isDolbyTrack(mediaSource, audioStreamIndex);
}

export function buildDolbyProgressiveCopyUrl({
    transcodingUrl, itemId, mediaSourceId, playSessionId, authToken,
    audioStreamIndex, startPositionTicks = 0
}) {
    if (!itemId || !mediaSourceId || !Number.isFinite(Number(audioStreamIndex))) return null;
    let url = null;
    if (transcodingUrl) {
        try {
            const candidate = new URL(transcodingUrl, 'http://jellyfin.invalid');
            if (/\/Videos\/[^/]+\/(?:master|main)\.m3u8$/i.test(candidate.pathname)) {
                candidate.pathname = candidate.pathname.replace(/\/(?:master|main)\.m3u8$/i, '/stream.mkv');
                url = candidate;
            }
        } catch (e) { /* Unsupported URL, construct normal Jellyfin path below */ }
    }
    if (!url) {
        url = new URL('/Videos/' + encodeURIComponent(itemId) + '/stream.mkv', 'http://jellyfin.invalid');
    }
    if (mediaSourceId) url.searchParams.set('MediaSourceId', String(mediaSourceId));
    if (playSessionId) url.searchParams.set('PlaySessionId', String(playSessionId));
    if (authToken && !url.searchParams.has('ApiKey') && !url.searchParams.has('api_key')) {
        url.searchParams.set('ApiKey', String(authToken));
    }
    for (const key of [
        'SegmentContainer', 'SegmentLength', 'MinSegments',
        'BreakOnNonKeyFrames', 'TranscodeReasons',
        'AudioBitrate', 'AudioChannels', 'MaxAudioChannels', 'TranscodingMaxAudioChannels'
    ]) url.searchParams.delete(key);
    url.searchParams.set('Static', 'false');
    url.searchParams.set('Container', 'mkv');
    url.searchParams.set('VideoCodec', 'copy');
    url.searchParams.set('AudioCodec', 'copy');
    url.searchParams.set('AllowVideoStreamCopy', 'true');
    url.searchParams.set('AllowAudioStreamCopy', 'true');
    url.searchParams.set('AudioStreamIndex', String(audioStreamIndex));
    url.searchParams.set('StartTimeTicks', String(Math.max(0, Number(startPositionTicks) || 0)));
    return url.pathname + url.search;
}

export function applyDolbyProgressiveCopy(mediaSource, params) {
    const url = buildDolbyProgressiveCopyUrl({
        ...params,
        transcodingUrl: mediaSource?.TranscodingUrl,
        mediaSourceId: mediaSource?.Id
    });
    if (!url) return false;
    mediaSource.TranscodingUrl = url;
    mediaSource.TranscodingContainer = 'mkv';
    mediaSource.TranscodingSubProtocol = null;
    mediaSource._webosDolbyProgressiveCopy = true;
    mediaSource.SupportsDirectPlay = false;
    mediaSource.SupportsDirectStream = true;
    // MediaHelper classifies this as progressive DirectStream to use the
    // TranscodingUrl and to apply the correct StartTimeTicks offset. Despite
    // this routing label the request explicitly uses audio/video stream copy.
    mediaSource.TranscodingInfo = {
        IsVideoDirect: true,
        IsAudioDirect: false,
        VideoCodec: 'copy',
        AudioCodec: 'copy'
    };
    return true;
}
