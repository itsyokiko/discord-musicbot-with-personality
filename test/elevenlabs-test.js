/**
 * Cek preprocessing voice note ElevenLabs: tag ekspresi, singkatan,
 * ketawa, waveform, dan payload voice message.
 * Jalankan: node test/elevenlabs-test.js
 */

const assert = require('node:assert');
const el = require('../src/elevenLabs');

// Tag ekspresi: satu tag, tanpa spasi di dalamnya.
assert.strictEqual(el.resolveExpressionTag('marah', 80), '[怒り]');
assert.strictEqual(el.resolveExpressionTag('ketawa', 80), '[笑いながら]');
assert.strictEqual(el.resolveExpressionTag('', 10), '[疲れた・小声]');
assert.strictEqual(el.resolveExpressionTag('', 50), '[普段の声]');
assert.strictEqual(el.resolveExpressionTag('', 90), '[明るく・楽しそう]');
console.log('ok   resolveExpressionTag');

// Preprocessing: tag di depan, singkatan dibaca penuh, ketawa jadi [笑],
// emoji/link/custom emoji dibuang.
const out = el.preprocessTextForVN(
  'wkwk yg bgt lucu 😂 https://contoh.test <:emote:123> gpp',
  { emotion: 'ketawa', mood: 80 }
);
assert.match(out, /^\[[^\]\s]+\]/);
assert.ok(out.startsWith('[笑いながら]'), out);
assert.ok(!/wkwk/i.test(out), out);
assert.ok(!/https?:/.test(out), out);
assert.ok(!/😂/.test(out), out);
assert.ok(!/<:/.test(out), out);
assert.ok(/yang banget lucu/.test(out), out);
assert.ok(/nggak apa-apa/.test(out), out);
assert.ok(!out.startsWith('[笑いながら][笑]'), 'ketawa di awal jangan dobel tag: ' + out);
assert.ok(/\[笑\]/.test(el.preprocessTextForVN('lucu wkwk', { emotion: 'senang' })));
console.log('ok   preprocessTextForVN');

// Teks kosong / hanya emoji tidak menghasilkan voice note kosong.
assert.strictEqual(el.preprocessTextForVN('   '), '');
assert.strictEqual(el.preprocessTextForVN('😂😂'), '');
console.log('ok   teks kosong');

// Kredit dihitung per karakter (bukan code unit), cocok untuk teks Jepang.
assert.strictEqual(el.countBillableChars('日本'), 2);
assert.strictEqual(el.countBillableChars('😂'), 1);
assert.strictEqual(el.countBillableChars(''), 0);
console.log('ok   countBillableChars');

// Waveform selalu 256 byte, full-scale PCM jadi 255.
assert.strictEqual(el.sampleWaveform(Buffer.alloc(0)).length, 256);
const loud = Buffer.alloc(512);
for (let i = 0; i < loud.length; i += 4) {
  loud.writeInt16LE(32767, i);
  loud.writeInt16LE(-32768, i + 2);
}
const wave = el.sampleWaveform(loud);
assert.strictEqual(wave.length, 256);
assert.ok(wave.every(v => v === 255), [...wave].slice(0, 8).join(','));
console.log('ok   sampleWaveform');

// Payload voice message: flag 8192 + metadata durasi/waveform.
assert.strictEqual(el.buildVoicePayload({ buffer: Buffer.from('x') }), null);
const payload = el.buildVoicePayload({
  voice: { buffer: Buffer.from('ogg'), duration: 3.2, waveform: 'AAAA' },
});
assert.strictEqual(payload.flags, 8192);
assert.strictEqual(payload.files[0].duration, 3.2);
assert.strictEqual(payload.files[0].waveform, 'AAAA');
console.log('ok   buildVoicePayload');

console.log('ALL PASS');
