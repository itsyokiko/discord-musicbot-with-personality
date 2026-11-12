'use strict';
const assert = require('node:assert');
const vow = require('../src/voiceOrderWaiter');

console.log('--- Testing Voice Order Waiter ---');

// 1. Template counts
assert.strictEqual(vow.JOIN_ORDER_TEMPLATES.length, 15, 'JOIN_ORDER_TEMPLATES harus tepat 15');
assert.strictEqual(vow.TIMEOUT_TEMPLATES.length, 20, 'TIMEOUT_TEMPLATES harus tepat 20');
assert.strictEqual(vow.OTHER_USER_TEMPLATES.length, 20, 'OTHER_USER_TEMPLATES harus tepat 20');

// 2. Sample template evaluation
const joinSample = vow.JOIN_ORDER_TEMPLATES[0]('serba serbi', 'Budi');
assert.ok(joinSample.includes('serba serbi') && joinSample.includes('Budi'), 'Join sample formatting check');

const timeoutSample = vow.TIMEOUT_TEMPLATES[4]('serba serbi', 'Budi');
assert.ok(timeoutSample.includes('Budi'), 'Timeout sample check');

const otherSample = vow.OTHER_USER_TEMPLATES[4]('serba serbi', 'Budi', 'Rian');
assert.ok(otherSample.includes('Budi') && otherSample.includes('Rian'), 'Other user sample check');

// 3. Register and state
const mockVc = { id: 'vc123', name: 'serba serbi', members: new Map() };
const mockGuild = {
  id: 'guild123',
  members: {
    me: {
      voice: { channel: mockVc }
    }
  }
};
const mockClient = {
  user: { id: 'bot123' },
  guilds: {
    cache: new Map([['guild123', mockGuild]])
  }
};
let sentMessages = [];
const mockTc = {
  id: 'tc123',
  send: async (payload) => { sentMessages.push(payload); }
};

const resp = vow.registerOrder({
  client: mockClient,
  guildId: 'guild123',
  voiceChannel: mockVc,
  textChannel: mockTc,
  callerId: 'userBudi',
  callerName: 'Budi',
  isJoy: false
});

assert.ok(typeof resp === 'string' && resp.length > 5, 'Response join order terbentuk');
assert.strictEqual(vow.hasPendingOrder('guild123'), true, 'Pending order aktif');

// 4. Test user lain join ke VC
(async () => {
  await vow.handleVoiceStateUpdate(
    { channelId: null },
    { guild: mockGuild, channelId: 'vc123', member: { id: 'userRian', displayName: 'Rian', user: { bot: false } } },
    mockClient
  );

  assert.strictEqual(sentMessages.length, 1, 'Pesan saat orang lain masuk terkirim');
  assert.strictEqual(vow.hasPendingOrder('guild123'), true, 'Callista tidak leave saat orang lain masuk');

  // 5. Test si pemanggil masuk -> waiter selesai
  await vow.handleVoiceStateUpdate(
    { channelId: null },
    { guild: mockGuild, channelId: 'vc123', member: { id: 'userBudi', displayName: 'Budi', user: { bot: false } } },
    mockClient
  );

  assert.strictEqual(vow.hasPendingOrder('guild123'), false, 'Waiter selesai saat pemanggil masuk');

  // 6. Test cancel order
  vow.registerOrder({
    client: mockClient,
    guildId: 'guild123',
    voiceChannel: mockVc,
    textChannel: mockTc,
    callerId: 'userBudi',
    callerName: 'Budi',
    isJoy: false
  });
  vow.cancelOrder('guild123');
  assert.strictEqual(vow.hasPendingOrder('guild123'), false, 'Order berhasil di-cancel');

  console.log('All Voice Order Waiter tests passed successfully!');
})();
