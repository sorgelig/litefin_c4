/**
 * Diagnostic: native webOS HLS with keyframe-aligned MPEG-TS and copied AC3/EAC3.
 * Only applied to local MKV Dolby audio, keeping DTS on Litefin's normal path.
 * In particular, this overrides force-fMP4 for these Dolby test tracks.
 *
 * Compare with the proven (but slow-seeking) progressive /stream.mkv route.
 */
import { shouldUseDolbyProgressiveCopy } from './WebOSDolbyProgressiveTest.js';

export function shouldUseDolbyTsHlsCopy(options) {
    return shouldUseDolbyProgressiveCopy(options);
}

export function buildDolbyTsHlsUrl({
    transcodingUrl, itemId, mediaSourceId, playSessionId, authToken,
    audioStreamIndex
}) {
    if (!itemId || !mediaSourceId || audioStreamIndex == null ||
        !Number.isFinite(Number(audioStreamIndex))) return null;
    let url = null;
    if (transcodingUrl) {
        try {
            const candidate = new URL(transcodingUrl, 'http://jellyfin.invalid');
            if (/\/Videos\/[^/]+\/(?:master|main)\.m3u8$/i.test(candidate.pathname)) {
                candidate.pathname = candidate.pathname.replace(/\/main\.m3u8$/i, '/master.m3u8');
                url = candidate;
            }
        } catch (_e) { /* Unusable transcode URL; construct standard endpoint */ }
    }
    if (!url) {
        url = new URL('/Videos/' + encodeURIComponent(itemId) + '/master.m3u8',
            'http://jellyfin.invalid');
    }
    // Preserve the original session and source identification, but strip any
    // old re-encoding directives from the original force-fMP4 profile.
    for (const key of [
        'TranscodeReasons', 'VideoBitrate', 'AudioBitrate', 'AudioChannels',
        'MaxAudioChannels', 'TranscodingMaxAudioChannels', 'MaxWidth',
        'MaxHeight', 'VideoCodec', 'AudioCodec', 'SegmentContainer',
        'SegmentLength', 'MinSegments', 'BreakOnNonKeyFrames',
        'StartTimeTicks'
    ]) url.searchParams.delete(key);
    url.searchParams.set('MediaSourceId', String(mediaSourceId));
    if (playSessionId) url.searchParams.set('PlaySessionId', String(playSessionId));
    if (authToken && !url.searchParams.has('ApiKey') && !url.searchParams.has('api_key')) {
        url.searchParams.set('ApiKey', String(authToken));
    }
    url.searchParams.set('Static', 'false');
    url.searchParams.set('Container', 'ts');
    url.searchParams.set('SegmentContainer', 'ts');
    url.searchParams.set('VideoCodec', 'copy');
    url.searchParams.set('AudioCodec', 'copy');
    url.searchParams.set('AllowVideoStreamCopy', 'true');
    url.searchParams.set('AllowAudioStreamCopy', 'true');
    url.searchParams.set('AudioStreamIndex', String(audioStreamIndex));
    // EXPERIMENT 2.10.4: do not force 1-second HLS segments with copied
    // video. A stream-copied source has fixed GOP/IDR positions; forcing a
    // much shorter SegmentLength can conflict with the segment playlist
    // timing and leave the native LG decoder stalled for a long interval.
    // Omit SegmentLength entirely so Jellyfin can use its copy-mode
    // keyframe-aligned segment behavior. Do not break on P/B frames.
    url.searchParams.set('MinSegments', '2');
    url.searchParams.set('BreakOnNonKeyFrames', 'false');
    return url.pathname + url.search;
}

export function applyDolbyTsHlsCopy(mediaSource, params) {
    const url = buildDolbyTsHlsUrl({
        ...params, mediaSourceId: mediaSource?.Id,
        transcodingUrl: mediaSource?.TranscodingUrl
    });
    if (!url) return false;
    mediaSource.TranscodingUrl = url;
    mediaSource.TranscodingContainer = 'ts';
    mediaSource.TranscodingSubProtocol = 'hls';
    mediaSource._webosDolbyTsHlsCopy = true;
    mediaSource.SupportsDirectPlay = false;
    mediaSource.SupportsDirectStream = true;
    // Classify as DirectStream to make MediaHelper take the generated HLS URL,
    // not Static=true raw MKV. Actual FFmpeg copy behavior must be checked in
    // the Jellyfin transcode log for the tested server.
    mediaSource.TranscodingInfo = {
        IsVideoDirect: true,
        IsAudioDirect: false,
        VideoCodec: 'copy',
        AudioCodec: 'copy'
    };
    return true;
}
