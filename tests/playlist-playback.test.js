const test = require('node:test');
const assert = require('node:assert/strict');

async function loadPlaybackHelpers() {
    return import('../frontend/src/utils/playlistPlayback.mjs');
}

test('continuous rotation wraps for one and multiple playlist entries', async () => {
    const { getNextIndex } = await loadPlaybackHelpers();

    assert.equal(getNextIndex(0, 1), 0);
    assert.equal(getNextIndex(0, 3), 1);
    assert.equal(getNextIndex(2, 3), 0);
    assert.equal(getNextIndex(0, 0), -1);
});

test('shuffle returns each index once and avoids adjacent and cycle-boundary repeats', async () => {
    const { createSeededRandom, shuffleIndices } = await loadPlaybackHelpers();
    const order = shuffleIndices(20, createSeededRandom('PT101-uuid-cycle-2'), 7);

    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: 20 }, (_, index) => index));
    assert.notEqual(order[0], 7);
    for (let index = 1; index < order.length; index += 1) {
        assert.notEqual(order[index], order[index - 1]);
    }
});

test('shuffle handles a single entry and seeded TV ordering is repeatable but decorrelated', async () => {
    const { createSeededRandom, shuffleIndices } = await loadPlaybackHelpers();

    assert.deepEqual(shuffleIndices(1, createSeededRandom('PT101'), 0), [0]);
    assert.deepEqual(shuffleIndices(0), []);
    const first = shuffleIndices(32, createSeededRandom('PT101'));
    assert.deepEqual(first, shuffleIndices(32, createSeededRandom('PT101')));
    assert.notDeepEqual(first, shuffleIndices(32, createSeededRandom('PT102')));
});

test('image schedules replace zero and legacy one-hour durations with 12 seconds', async () => {
    const { playbackDurationMs } = await loadPlaybackHelpers();

    assert.equal(playbackDurationMs({ content_type: 'image', duration_seconds: 0 }), 12_000);
    assert.equal(playbackDurationMs({ source_url: '/media/ad.jpg', duration_seconds: 3600 }), 12_000);
    assert.equal(playbackDurationMs({ source_type: 'image', duration_seconds: 3600 }), 12_000);
    assert.equal(playbackDurationMs({ source_url: 'https://youtu.be/abcdefghijk', duration_seconds: 3600 }), 30_000);
});

test('media type detection handles image aliases, file extensions, and YouTube URLs', async () => {
    const { getMediaKind } = await loadPlaybackHelpers();

    assert.equal(getMediaKind({ source_type: 'image', source_url: '/media/ad.bin' }), 'image');
    assert.equal(getMediaKind({ content_type: 'img', source_url: '/media/ad.bin' }), 'image');
    assert.equal(getMediaKind({ source_url: '/media/clip.MP4?token=abc' }), 'video');
    assert.equal(getMediaKind({ content_type: 'video', source_url: 'https://youtu.be/abcdefghijk' }), 'iframe');
    assert.equal(getMediaKind({ content_type: 'external_url', source_url: 'https://metrics.example.com' }), 'iframe');
});
