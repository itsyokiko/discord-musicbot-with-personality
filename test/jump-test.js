/**
 * Cek parser `>jump <menit>` dan keberadaan seekMusic.
 * Jalankan: node test/jump-test.js
 */

const assert = require('node:assert');
const mc = require('../src/musicCommands');
const musicPlayer = require('../src/musicPlayer');

assert.deepStrictEqual(mc.parseJumpCommand('>jump 5'), { minutes: 5 });
assert.deepStrictEqual(mc.parseJumpCommand('>JUMP 12'), { minutes: 12 });
assert.deepStrictEqual(mc.parseJumpCommand('>jump 1.5'), { minutes: 1.5 });
assert.deepStrictEqual(mc.parseJumpCommand('>jump 1,5'), { minutes: 1.5 });
assert.deepStrictEqual(mc.parseJumpCommand('>jump 0'), { minutes: 0 });
assert.deepStrictEqual(mc.parseJumpCommand('>jump'), { minutes: null });
assert.deepStrictEqual(mc.parseJumpCommand('>jump   '), { minutes: null });
assert.strictEqual(mc.parseJumpCommand('>jump abc'), null);
assert.strictEqual(mc.parseJumpCommand('>jump -1'), null);
assert.strictEqual(mc.parseJumpCommand('>jump 5 please'), null);
assert.strictEqual(mc.parseJumpCommand('>jumping 5'), null);
assert.strictEqual(mc.parseJumpCommand('cal, jump 5'), null);
assert.strictEqual(mc.parseJumpCommand('>play lagu'), null);
console.log('ok   parseJumpCommand');

assert.strictEqual(typeof musicPlayer.seekMusic, 'function');
console.log('ok   seekMusic ter-export');

// Singkatan prefix: >p / >sk / >l / >h dll.
const P = (content) => mc.parseDirectCommand(content, { hasQueue: true });
assert.deepStrictEqual(P('>p renegades'), { command: 'play', args: 'renegades', source: 'prefix' });
assert.deepStrictEqual(P('>p https://youtu.be/abc'), { command: 'play', args: 'https://youtu.be/abc', source: 'prefix' });
assert.strictEqual(P('>p').bare, true);
assert.strictEqual(P('>sk').command, 'skip');
assert.strictEqual(P('>st').command, 'stop');
assert.strictEqual(P('>pa').command, 'pause');
assert.strictEqual(P('>rs').command, 'resume');
assert.strictEqual(P('>sh').command, 'shuffle');
assert.strictEqual(P('>l').command, 'loop');
assert.strictEqual(P('>ul').command, 'unloop');
assert.strictEqual(P('>j').command, 'join');
assert.strictEqual(P('>lv').command, 'leave');
assert.strictEqual(P('>h').command, 'help');
assert.strictEqual(P('>q').command, 'queue');
assert.strictEqual(P('>pl abcd').command, 'playlist');

// >p with filler words = bare play (random from playlist)
assert.strictEqual(P('>p lagu').bare, true);
assert.strictEqual(P('>p musik').bare, true);
assert.strictEqual(P('>p random').bare, true);

// Singkatan TIDAK berlaku di chat natural, supaya "cal, p" bukan perintah.
assert.strictEqual(mc.parseDirectCommand('cal, p', { hasQueue: true }), null);
assert.strictEqual(mc.parseDirectCommand('cal, l', { hasQueue: true }), null);
assert.strictEqual(mc.parseDirectCommand('cal, p lagu', { hasQueue: true }), null);
console.log('ok   singkatan prefix');

console.log('ALL PASS');
