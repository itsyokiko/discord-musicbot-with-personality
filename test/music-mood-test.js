'use strict';

const assert = require('node:assert');
const musicMood = require('../src/musicMoodTracker');

console.log('--- Testing Music Mood & Freqblog Tracker ---');

// 1. Test cleanSongTitle & parseTrackAndArtist
console.log('Checking song title & artist parsing...');
assert.strictEqual(
  musicMood.cleanSongTitle('AURORA - Everything Matters (Official Audio)'),
  'AURORA - Everything Matters'
);
assert.strictEqual(
  musicMood.cleanSongTitle('Mark Ronson - Uptown Funk [Official Video] | HD'),
  'Mark Ronson - Uptown Funk'
);

const p1 = musicMood.parseTrackAndArtist('AURORA - Everything Matters (Official Video)', 'AURORA');
assert.strictEqual(p1.artist, 'AURORA');
assert.strictEqual(p1.track, 'Everything Matters');

const p2 = musicMood.parseTrackAndArtist('Satu Bulan', 'Bernadya - Topic');
assert.strictEqual(p2.artist, 'Bernadya');
assert.strictEqual(p2.track, 'Satu Bulan');

const p3 = musicMood.parseTrackAndArtist('Mark Ronson - Uptown Funk (feat. Bruno Mars)', 'Mark Ronson');
assert.strictEqual(p3.artist, 'Mark Ronson');
assert.strictEqual(p3.track, 'Uptown Funk');

// 2. Test classifyMood
console.log('Checking classifyMood algorithm...');

// 2a. Mellow / Galau Sendu (e.g. AURORA, Bernadya)
const mellowFeatures = {
  bpm: 106,
  energy: 0.32,
  valence: 0.36,
  acousticness: 0.99,
  danceability: 0.66,
  loudness_db: -15.0,
  mood: 'sad',
  mood_vector: { happy: 0.07, sad: 0.91, relaxed: 0.99, party: 0.02, aggressive: 0 }
};
const resMellow = musicMood.classifyMood(mellowFeatures);
assert.strictEqual(resMellow.moodKey, 'mellow', 'Low energy + high sad should be classified as mellow');
assert.strictEqual(resMellow.moodLabel, 'Melow & Sendu');
assert.ok(musicMood.STATUS_TEMPLATES.mellow.includes(resMellow.suggestedVcStatus), 'VC status should use mellow templates');

// 2b. Cozy / Chill (e.g. Akustik santai)
const chillFeatures = {
  bpm: 95,
  energy: 0.42,
  valence: 0.65,
  acousticness: 0.85,
  danceability: 0.55,
  loudness_db: -12.0,
  mood: 'relaxed',
  mood_vector: { happy: 0.5, sad: 0.1, relaxed: 0.85, party: 0.1, aggressive: 0 }
};
const resChill = musicMood.classifyMood(chillFeatures);
assert.strictEqual(resChill.moodKey, 'chill', 'Moderate energy + high relaxed/acoustic should be chill');
assert.strictEqual(resChill.moodLabel, 'Adem & Santai');

// 2c. Hype / Enerjik (e.g. Uptown Funk, EDM, Pop ceria)
const hypeFeatures = {
  bpm: 128,
  energy: 0.85,
  valence: 0.88,
  acousticness: 0.05,
  danceability: 0.80,
  loudness_db: -4.5,
  mood: 'happy',
  mood_vector: { happy: 0.85, sad: 0.02, relaxed: 0.1, party: 0.82, aggressive: 0.1 }
};
const resHype = musicMood.classifyMood(hypeFeatures);
assert.strictEqual(resHype.moodKey, 'hype', 'High energy + high valence/bpm should be hype');
assert.strictEqual(resHype.moodLabel, 'Hype & Enerjik');

// 2d. Intense / Cadas (e.g. Heavy Rock / Metal)
const intenseFeatures = {
  bpm: 140,
  energy: 0.92,
  valence: 0.30,
  acousticness: 0.01,
  danceability: 0.40,
  loudness_db: -4.0,
  mood: 'aggressive',
  mood_vector: { happy: 0.1, sad: 0.2, relaxed: 0, party: 0.1, aggressive: 0.88 }
};
const resIntense = musicMood.classifyMood(intenseFeatures);
assert.strictEqual(resIntense.moodKey, 'intense', 'High energy + aggressive should be intense');
assert.strictEqual(resIntense.moodLabel, 'Cadas & Intens');

// 2e. Null / Fallback
const resNeutral = musicMood.classifyMood(null);
assert.strictEqual(resNeutral.moodKey, 'neutral');

// 3. Test maskApiKey
console.log('Checking maskApiKey...');
assert.strictEqual(musicMood.maskApiKey('fb_live_77c92e071c4f9e96e090c7a603287fd0bd3ae74e6e287979'), 'fb_live_77...7979');
assert.strictEqual(musicMood.maskApiKey('short_key'), '********');
assert.strictEqual(musicMood.maskApiKey(''), '');

// 4. Test lookupMood with Mock & Caching
(async () => {
  console.log('Checking lookupMood and caching...');
  musicMood.clearCache();
  let apiCallCount = 0;
  const mockApi = async (track, artist) => {
    apiCallCount++;
    return {
      track_name: track,
      artist_name: artist,
      energy: 0.35,
      valence: 0.30,
      acousticness: 0.95,
      mood: 'sad',
      mood_vector: { sad: 0.88, relaxed: 0.90 }
    };
  };

  const trackA = 'Mock Test Track ' + Date.now();
  const artistA = 'Mock Artist';

  const lookup1 = await musicMood.lookupMood(trackA, artistA, { mockApi });
  assert.strictEqual(apiCallCount, 1, 'API should be called on first lookup');
  assert.strictEqual(lookup1.moodKey, 'mellow');

  const lookup2 = await musicMood.lookupMood(trackA, artistA, { mockApi });
  assert.strictEqual(apiCallCount, 1, 'API must NOT be called again due to caching (0 latency / 0 network cost)');
  assert.strictEqual(lookup2.moodKey, 'mellow');

  // 5. Test Settings Update
  console.log('Checking settings update...');
  const updated = musicMood.updateSettings({ autoSetVoiceStatus: true });
  assert.strictEqual(updated.autoSetVoiceStatus, true);

  musicMood.clearCache();
  console.log('All Music Mood & Freqblog Tracker tests passed successfully!');
})();
