'use strict';
const assert = require('node:assert');
const activityContext = require('../src/activityContext');

console.log('--- Testing Activity Context & Rolling Synthesizer ---');

// 0. Reset state for clean test & disable auto-trigger during unit checks
activityContext.clearState();
activityContext.setAutoTrigger(false);

// Test A: cleanActivityText sanitization
console.log('Checking cleanActivityText...');
assert.strictEqual(
  activityContext.cleanActivityText('[voice_note] Halo <@833196669940138004> cek <#12345678> di https://example.com/file.zip?id=1'),
  'Halo @user cek #channel di [link]',
  'Should sanitize voice_note tag, user mention, channel mention, and URL'
);

// Test B: isMeaningfulActivity filtering
console.log('Checking isMeaningfulActivity...');
assert.strictEqual(activityContext.isMeaningfulActivity({ type: 'chat', text: '>p radwimps sparkle' }), false, 'Prefix > should be filtered');
assert.strictEqual(activityContext.isMeaningfulActivity({ type: 'chat', text: '!play song' }), false, 'Prefix ! should be filtered');
assert.strictEqual(activityContext.isMeaningfulActivity({ type: 'chat', text: '/skip' }), false, 'Prefix / should be filtered');
assert.strictEqual(activityContext.isMeaningfulActivity({ type: 'chat', text: 'wkwkwkwk' }), false, 'Laugh spam should be filtered');
assert.strictEqual(activityContext.isMeaningfulActivity({ type: 'chat', text: 'hahaha' }), false, 'Laugh spam should be filtered');
assert.strictEqual(activityContext.isMeaningfulActivity({ type: 'chat', text: 'p' }), false, 'Single letter ping should be filtered');
assert.strictEqual(activityContext.isMeaningfulActivity({ type: 'chat', text: 'tes' }), false, 'Test ping should be filtered');
assert.strictEqual(activityContext.isMeaningfulActivity({ type: 'chat', text: 'ok' }), false, 'Under 3 chars should be filtered');
assert.strictEqual(activityContext.isMeaningfulActivity({ type: 'music', text: 'Memutar lagu' }), true, 'Music events must be kept');
assert.strictEqual(activityContext.isMeaningfulActivity({ type: 'voice', text: 'User DC' }), true, 'Voice events must be kept');
assert.strictEqual(activityContext.isMeaningfulActivity({ type: 'chat', text: 'Tugas praktikum DKV dikumpulkan besok jam 12' }), true, 'Meaningful chat must pass');

// Test C: Command and noise do NOT increment synthesis counter
console.log('Checking noise rejection on counter...');
activityContext.clearState();
activityContext.recordActivity({ type: 'chat', text: '>p naruto silhouette' });
activityContext.recordActivity({ type: 'chat', text: 'wkwkwk' });
activityContext.recordActivity({ type: 'chat', text: 'tes' });
activityContext.recordActivity({ type: 'chat', text: '?' });
assert.strictEqual(activityContext.getState().newActivitiesSinceSynthesis, 0, 'Spam & noise must NOT increment new activities counter');
activityContext.clearState();

// 1. Initial empty checks
assert.strictEqual(activityContext.shouldSynthesize(15), false, 'Empty buffer should not synthesize');
assert.strictEqual(activityContext.buildPromptSnippet(), '', 'Empty state should produce empty prompt snippet');

// 2. Record 10 activities (chat, music, voice)
for (let i = 1; i <= 8; i++) {
  activityContext.recordActivity({
    type: 'chat',
    channelLabel: '#general',
    authorName: `User_${i}`,
    text: `Chat pesan nomor ${i}`,
    isBot: false,
    timestamp: Date.now() + i * 1000
  });
}

activityContext.recordActivity({
  type: 'music',
  channelLabel: '#bot-command',
  authorName: 'Mas Joy',
  text: 'Memutar lagu "Sparkle - RADWIMPS" (04:12) di VC',
  isJoy: true,
  timestamp: Date.now() + 9000
});

activityContext.recordActivity({
  type: 'voice',
  channelLabel: '#serba serbi',
  authorName: 'Fusyu',
  text: 'User Fusyu bawa MusicBot ke VC (Callista dicuekin)',
  timestamp: Date.now() + 10000
});

const hist = activityContext.getActivityHistory();
assert.strictEqual(hist.length, 10, 'Activity history should contain 10 items');
assert.strictEqual(hist[8].type, 'music', '9th item should be music');
assert.strictEqual(hist[9].type, 'voice', '10th item should be voice');

// First-time threshold (has >= 8 items without summary)
assert.strictEqual(activityContext.shouldSynthesize(15), true, 'First-time buffer >= 8 should trigger initial synthesis');

// 3. Test initial synthesis with mock LLM
let llmCalls = 0;
let lastCapturedPrompt = null;
const mockLlm = async ({ systemPrompt, userPrompt }) => {
  llmCalls++;
  lastCapturedPrompt = { systemPrompt, userPrompt };
  return '- Mas Joy memutar Sparkle di #bot-command.\n- Anggota server sedang aktif mengobrol di #general.\n- Callista mengeluh soal bot musik lain di #serba serbi.';
};

(async () => {
  const summary1 = await activityContext.synthesizeContext({ llmClient: mockLlm, deltaThreshold: 15 });
  assert.strictEqual(llmCalls, 1, 'LLM should be called once');
  assert.ok(summary1.includes('Mas Joy memutar Sparkle'), 'Summary should contain generated facts');
  assert.ok(lastCapturedPrompt.userPrompt.includes('[AKTIVITAS & OBROLAN SERVER TERAKHIR]'), 'Initial synthesis uses from-scratch template');

  const state1 = activityContext.getState();
  assert.strictEqual(state1.newActivitiesSinceSynthesis, 0, 'newActivitiesSinceSynthesis should reset to 0');
  assert.ok(state1.last_synthesized_at > 0, 'last_synthesized_at should be recorded');

  // 4. Test Token-Saving Skip: No new activities -> 0 tokens, 0 LLM calls!
  assert.strictEqual(activityContext.shouldSynthesize(15), false, 'Should not synthesize without new activities');
  const summaryCached = await activityContext.synthesizeContext({ llmClient: mockLlm, deltaThreshold: 15 });
  assert.strictEqual(llmCalls, 1, 'LLM must NOT be called again when data is unchanged (0 token cost)');
  assert.strictEqual(summaryCached, summary1, 'Cached summary must be returned');

  // 5. Add small number of new activities (< threshold 15) -> Still skips!
  for (let i = 1; i <= 5; i++) {
    activityContext.recordActivity({
      type: 'chat',
      channelLabel: '#talk-bout-nothin',
      authorName: 'Budi',
      text: `Chat obrolan santai ${i}`
    });
  }
  assert.strictEqual(activityContext.shouldSynthesize(15), false, '5 new activities should not meet threshold of 15');
  await activityContext.synthesizeContext({ llmClient: mockLlm, deltaThreshold: 15 });
  assert.strictEqual(llmCalls, 1, 'LLM still not called below threshold (0 tokens burned)');

  // 6. Cross threshold with 10 more activities (total 15 new) -> Triggers Incremental Delta Synthesis!
  for (let i = 6; i <= 15; i++) {
    activityContext.recordActivity({
      type: 'chat',
      channelLabel: '#talk-bout-nothin',
      authorName: 'Rian',
      text: `Chat tugas DKV deadline besok ${i}`
    });
  }
  assert.strictEqual(activityContext.shouldSynthesize(15), true, '15 new activities should meet threshold');

  const mockIncrementalLlm = async ({ systemPrompt, userPrompt }) => {
    llmCalls++;
    lastCapturedPrompt = { systemPrompt, userPrompt };
    return '- Budi dan Rian sedang membahas tugas DKV deadline besok di #talk-bout-nothin.\n- Mas Joy sebelumnya memutar lagu Sparkle.';
  };

  const summary2 = await activityContext.synthesizeContext({ llmClient: mockIncrementalLlm, deltaThreshold: 15 });
  assert.strictEqual(llmCalls, 2, 'LLM called for incremental update');
  assert.ok(lastCapturedPrompt.userPrompt.includes('[RINGKASAN SITUASI SEBELUMNYA]'), 'Incremental update must include previous summary');
  assert.ok(lastCapturedPrompt.userPrompt.includes('[AKTIVITAS & OBROLAN TERBARU BARU SAJA]'), 'Incremental update must only feed delta');
  assert.ok(!lastCapturedPrompt.userPrompt.includes('Chat pesan nomor 1'), 'Old raw chat messages should NOT be re-fed');

  // 7. Verify prompt snippet generation for src/ai.js
  const snippet = activityContext.buildPromptSnippet();
  assert.ok(snippet.includes('[KONTEKS SITUASI & AKTIVITAS SERVER TERKINI]'), 'Snippet has clear header');
  assert.ok(snippet.includes('tugas DKV deadline besok'), 'Snippet contains current distilled summary');

  // 8. Test sliding window buffer capped at 100
  for (let i = 0; i < 150; i++) {
    activityContext.recordActivity({
      type: 'chat',
      channelLabel: '#spam',
      authorName: `Spammer_${i}`,
      text: `Spam ${i}`
    });
  }
  assert.strictEqual(activityContext.getActivityHistory().length, 100, 'Buffer must be capped at 100 activities');

  // 9. Test Event-Driven Auto-Trigger with Debounce
  console.log('Checking event-driven auto-trigger with debounce...');
  activityContext.clearState();
  let autoTriggerCalled = false;
  activityContext.setAutoTrigger(true, 50); // 50ms debounce
  // Record 8 items to reach initial threshold
  for (let i = 1; i <= 8; i++) {
    activityContext.recordActivity({
      type: 'chat',
      channelLabel: '#auto',
      authorName: `User_${i}`,
      text: `Topik perkuliahan materi bab ${i}`
    });
  }
  // Schedule synthesis using mock
  activityContext.scheduleBackgroundSynthesis(30, {
    llmClient: async () => {
      autoTriggerCalled = true;
      return '- Percakapan otomatis tentang materi kuliah bab 1-8.';
    }
  });

  await new Promise(r => setTimeout(r, 80));
  assert.strictEqual(autoTriggerCalled, true, 'Debounced auto-trigger should execute in background');
  assert.ok(activityContext.getState().summary.includes('materi kuliah bab 1-8'), 'Summary should be saved from background auto-trigger');

  // Cleanup
  activityContext.clearState();
  activityContext.stopPeriodicSynthesizer();
  console.log('All Activity Context & Rolling Synthesizer tests passed successfully!');
})();
