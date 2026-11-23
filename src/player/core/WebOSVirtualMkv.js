/**
 * webOS-only virtual MKV selection. The existing bundled webOS Node service
 * serves an opaque localhost URL, masking all but one Matroska audio TrackEntry.
 * No server-side remux or on-disk copy is involved.
 */

const ELIGIBLE_CODECS = /^(ac3|eac3|dts|dca|dtshd|dts-hd|dts-ma|aac|mp3|flac|opus)$/i;
const BLOCKED_MODES = new Set(['remux', 'transcode', 'transcodeAudio', 'transcodeVideo']);

export function canVirtualizeMkv(mediaSource, audioIndex, backendType, playbackMode) {
    if (backendType !== 'webos' || !mediaSource ||
        BLOCKED_MODES.has(playbackMode) ||
        !/^(mkv|matroska)$/i.test(mediaSource.Container || '') ||
        mediaSource.IsRemote || mediaSource.RequiresOpening || mediaSource.LiveStreamId) return false;
    const tracks = (mediaSource.MediaStreams || []).filter(t => t.Type === 'Audio');
    if (tracks.length < 2) return false;
    const selected = tracks.find(t => Number(t.Index) === Number(audioIndex));
    return Boolean(selected && ELIGIBLE_CODECS.test(selected.Codec || ''));
}

/** 1-based ordinal of selected audio track in the raw container's audio list. */
export function virtualAudioOrdinal(mediaSource, audioIndex) {
    const streams = (mediaSource?.MediaStreams || []).filter(t => t.Type === 'Audio');
    const pos = streams.findIndex(t => Number(t.Index) === Number(audioIndex));
    return pos < 0 ? null : pos + 1;
}

/**
 * Start a subscribed Luna call to keep Node alive while the native <video>
 * fetches ranges from http://127.0.0.1:8123. Caller MUST call cancel() on
 * playback stop or track change. Failure returns null (normal DirectPlay).
 */
export function prepareVirtualMkv(sourceUrl, audioOrdinal, headers = {}) {
    return new Promise(resolve => {
        if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl) ||
            !Number.isSafeInteger(audioOrdinal) || audioOrdinal < 1 ||
            typeof window === 'undefined' || !window.webOS?.service?.request) {
            resolve(null);
            return;
        }
        let done = false;
        let request = null;
        const finish = result => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            resolve(result);
        };
        const timeout = setTimeout(() => {
            try { request?.cancel?.(); } catch (_) {}
            finish(null);
        }, 15000);
        try {
            request = window.webOS.service.request('luna://org.litefin.app.service', {
                method: 'virtualMkv',
                parameters: {
                    subscribe: true,
                    sourceUrl,
                    audioOrdinal,
                    headers
                },
                onSuccess(response) {
                    if (response?.returnValue && /^http:\/\/127\.0\.0\.1:8123\/virtual-mkv\//.test(response.url || '')) {
                        finish({
                            url: response.url,
                            cancel() { try { request?.cancel?.(); } catch (_) {} }
                        });
                    } else {
                        try { request?.cancel?.(); } catch (_) {}
                        finish(null);
                    }
                },
                onFailure(error) {
                    console.warn('[VirtualMKV] Service unavailable:', error?.errorText || 'unknown error');
                    try { request?.cancel?.(); } catch (_) {}
                    finish(null);
                }
            });
        } catch (e) {
            console.warn('[VirtualMKV] Cannot call webOS service:', e.message);
            finish(null);
        }
    });
}
