export function getNextIndex(currentIndex, length) {
    if (!Number.isInteger(length) || length <= 0) return -1;
    if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= length) return 0;
    return (currentIndex + 1) % length;
}

export function createSeededRandom(seed) {
    let state = 2166136261;
    for (const char of String(seed ?? '')) {
        state ^= char.codePointAt(0);
        state = Math.imul(state, 16777619);
    }
    return () => {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

export function shuffleIndices(length, random = Math.random, previousIndex = -1) {
    if (!Number.isInteger(length) || length <= 0) return [];
    const indices = Array.from({ length }, (_, index) => index);
    for (let index = indices.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
    }

    // A new cycle must not repeat the item that ended the previous cycle.
    if (length > 1 && indices[0] === previousIndex) {
        const replacementIndex = 1 + Math.floor(random() * (length - 1));
        [indices[0], indices[replacementIndex]] = [indices[replacementIndex], indices[0]];
    }
    return indices;
}

export function getYouTubeVideoId(url) {
    if (!url) return null;
    const match = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
    return match?.[1] ?? null;
}

export function getMediaKind(item) {
    const url = item?.source_url ?? '';
    const path = url.split(/[?#]/, 1)[0].toLowerCase();
    if (getYouTubeVideoId(url)) return 'iframe';
    if (item?.content_type === 'video' || /\.(mp4|webm|mkv|mov|ogv|m4v|mpeg|mpg|3gp)$/.test(path)) return 'video';
    if (['image', 'img'].includes(item?.content_type) || item?.source_type === 'image'
        || /\.(avif|gif|jpe?g|png|svg|webp|bmp)$/.test(path)) return 'image';
    if (['power_bi', 'url', 'iframe', 'external_url', 'youtube'].includes(item?.content_type)) return 'iframe';
    return 'image';
}

export function playbackDurationMs(item) {
    const duration = Number(item?.duration_seconds);
    const kind = item?.content_type;
    const url = item?.source_url ?? '';
    const isImage = ['image', 'img'].includes(kind) || item?.source_type === 'image'
        || /\.(avif|gif|jpe?g|png|svg|webp|bmp)(?:[?#]|$)/i.test(url);
    const isYouTubeVideo = Boolean(getYouTubeVideoId(url));

    if (isImage && (!Number.isFinite(duration) || duration <= 0 || duration >= 3600)) return 12_000;
    if (isYouTubeVideo && (!Number.isFinite(duration) || duration <= 0 || duration >= 3600)) return 30_000;
    if (!Number.isFinite(duration) || duration <= 0) return 12_000;
    return duration * 1000;
}
