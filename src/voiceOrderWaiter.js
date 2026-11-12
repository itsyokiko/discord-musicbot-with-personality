'use strict';
/**
 * Voice Order Waiter — Mengelola interaksi saat Callista disuruh masuk VC oleh user:
 * 1. 15 template alami saat disuruh join duluan ke VC.
 * 2. Timer 5 menit menunggu si penyuruh.
 * 3. 20 template jika penyuruh tidak masuk dalam 5 menit -> Callista ngeluh & leave VC.
 * 4. 20 template jika orang lain yang masuk di masa tunggu -> Callista komen, tapi tidak leave.
 */

const voiceUtils = require('./voiceUtils');
const storage = require('./storage');
const naturalTyping = require('./naturalTyping');

const WAIT_DURATION_MS = 5 * 60 * 1000; // 5 menit

// 15 Template respon alami saat disuruh masuk ke VC
const JOIN_ORDER_TEMPLATES = [
  (channel, caller) => `otw meluncur ke **${channel}**, buruan masuk ya ${caller} wkwk`,
  (channel, caller) => `siap, aku masuk ke **${channel}** duluan nih. jangan lama-lama ya ${caller}`,
  (channel, caller) => `gass, udah di **${channel}** yaa. ditungguin awas kalo ga nongol wkwk`,
  (channel, caller) => `oke deh, aku tunggu di **${channel}** ya ${caller}!`,
  (channel, caller) => `meluncur ke **${channel}**~ buruan nyusul, awas aja lu ninggalin sendirian`,
  (channel, caller) => `sip, udah nimbrung di **${channel}**. cepetan masuk ya ${caller}!`,
  (channel, caller) => `oke siap, aku duluan ke **${channel}** ya, jangan bikin aku bengong sendiri wkwk`,
  (channel, caller) => `otw **${channel}**! awas kalo cuma nyuruh doang ya ${caller} 😭`,
  (channel, caller) => `udah di **${channel}** nih, cepetan masuk yaa`,
  (channel, caller) => `yowis aku masuk ke **${channel}** duluan, ditunggu awas lu wkwk`,
  (channel, caller) => `gaskeun, udah standby di **${channel}** nih. cepet masuk!`,
  (channel, caller) => `oke meluncur ke **${channel}**, jangan lama ya ${caller}, males sendirian`,
  (channel, caller) => `siaap, aku udah nongkrong di **${channel}**. buru masuk dong!`,
  (channel, caller) => `udah join ke **${channel}** yaa, kutungguin nih ${caller}`,
  (channel, caller) => `otw standby di **${channel}**, cepet nyusul wkwk`
];

// 20 Template jika yang menyuruh TIDAK masuk selama 5 menit
const TIMEOUT_TEMPLATES = [
  (channel, caller) => `dih nyuruh doang orangnya ga masuk juga wkwk, cabut ah`,
  (channel, caller) => `5 menit bengong sendirian di VC, lu malah ga nongol bjir 😭 cabut lah`,
  (channel, caller) => `PHP banget jir nyuruh masuk tapi ga disamperin, dadah`,
  (channel, caller) => `malah ditinggal sendiri wkwk, gamau ah cabut aja`,
  (channel, caller) => `capek nungguin ${caller} ga masuk-masuk, aku left ya wkwk`,
  (channel, caller) => `dih dikira aku patung apa ya disuruh nungguin sendirian, cabut!`,
  (channel, caller) => `lah katanya suruh masuk **${channel}**, orangnya malah ngilang wkwk. bye!`,
  (channel, caller) => `udah 5 menit nih ${caller}, php bgt asli wkwk. aku cabut ya`,
  (channel, caller) => `males ah ditinggal sendirian di **${channel}**, keluar aja mendingan`,
  (channel, caller) => `suruh-suruh doang giliran disamperin ga masuk, kebiasaan deh 😭 cabut ah`,
  (channel, caller) => `ditinggalin di VC sendirian ga asik bgt, mending aku cabut`,
  (channel, caller) => `ngantuk nungguin ${caller} di **${channel}**, gaada tanda-tanda masuk wkwk, dadah`,
  (channel, caller) => `bener-bener ya ${caller}, disuruh standby malah ga dateng 😭 left ah`,
  (channel, caller) => `aku keluar ya, gaada yang nemenin malah bengong wkwk`,
  (channel, caller) => `ghosting jalur voice channel ini mah wkwk, cabut dulu ya!`,
  (channel, caller) => `dih boongin anak orang, katanya suruh masuk taunya sepi, cabut!`,
  (channel, caller) => `5 menit berlalu dan nihil... fix dikerjain wkwk, aku left ya`,
  (channel, caller) => `males bgt dianggurin di VC, cabut ah mau rebahan aja`,
  (channel, caller) => `ditinggal sendirian di room sepi amat, cabut ah ga seru`,
  (channel, caller) => `dah 5 menit ga nongol-nongol, cabut dulu ah daripada lumutan di sini wkwk`
];

// 20 Template jika yang masuk ORANG LAIN di masa tunggu 5 menit
const OTHER_USER_TEMPLATES = [
  (channel, caller, other) => `lah yang masuk malah yang lain wkwk`,
  (channel, caller, other) => `lah kok lu yang masuk wkwk, yang nyuruh mana coba`,
  (channel, caller, other) => `eh halo? kok malah orang lain yang nimbrung duluan wkwk`,
  (channel, caller, other) => `lah yang nyuruh siapa yang masuk siapa wkwk`,
  (channel, caller, other) => `plot twist bgt, yang nyuruh ${caller} tapi yang nongol malah ${other} wkwk`,
  (channel, caller, other) => `lah kok lu wkwk, ${caller}-nya mana dah?`,
  (channel, caller, other) => `eh ada orang lain masuk wkwk, yang nyuruh tadi malah belum dateng`,
  (channel, caller, other) => `wkwk lah kok bukan yang nyuruh yang masuk, halo deh`,
  (channel, caller, other) => `nyasar apa gimana nih wkwk, tapi halo deh`,
  (channel, caller, other) => `lah yang punya hajat belum dateng, yang lain udah nyampe duluan wkwk`,
  (channel, caller, other) => `eh halo, kirain tadi ${caller} yang masuk taunya orang lain wkwk`,
  (channel, caller, other) => `lah kok beda orang wkwk, tapi gapapa deh ada temennya`,
  (channel, caller, other) => `wkwk yang nyuruh ${caller}, yang nongol malah lu`,
  (channel, caller, other) => `lah yang nyuruh tadi kemana ya wkwk, malah orang lain yang masuk`,
  (channel, caller, other) => `eh nongol juga orang lain wkwk, yang nyuruh masih otw kali ya`,
  (channel, caller, other) => `lah bukan ${caller} wkwk, tapi halo deh daripada sepi`,
  (channel, caller, other) => `halo wkwk, kirain siapa taunya bukan yang nyuruh tadi`,
  (channel, caller, other) => `lah kok yang masuk yang lain sih wkwk, tapi yaudah deh nemenin lu dulu`,
  (channel, caller, other) => `wkwk malah orang lain yang join duluan, ${caller} masih tidur apa ya`,
  (channel, caller, other) => `eh ada tamu lain wkwk, yang nyuruh tadi entah kemana`
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Map: guildId -> orderState
const pendingOrders = new Map();

/**
 * Daftarkan order Callista disuruh masuk VC.
 * Mengembalikan string respon alami (1 dari 15 template).
 */
function registerOrder({ client, guildId, voiceChannel, textChannel, callerId, callerName, isJoy }) {
  if (!guildId || !voiceChannel) return '';

  // Batalkan order lama jika ada
  cancelOrder(guildId);

  const displayName = isJoy ? 'Mas Joy' : (callerName || 'kamu');
  const channelName = voiceChannel.name || 'VC';

  const timer = setTimeout(async () => {
    try {
      const order = pendingOrders.get(guildId);
      if (!order) return;

      // Cek apakah bot masih di VC tersebut
      const currentVc = voiceUtils.getCurrentVoiceChannel(client, guildId);
      if (!currentVc || currentVc.id !== voiceChannel.id) {
        pendingOrders.delete(guildId);
        return;
      }

      // Cek apakah si penyuruh sudah ada di VC
      const callerPresent = currentVc.members?.has(callerId);
      if (!callerPresent) {
        // Penyuruh tidak masuk selama 5 menit -> kirim komplain & leave
        const complaint = naturalTyping.humanizeTyping(pick(TIMEOUT_TEMPLATES)(channelName, displayName));
        if (textChannel && typeof textChannel.send === 'function') {
          await textChannel.send({ content: complaint, allowedMentions: { repliedUser: false } }).catch(() => {});
          storage.addHistory(textChannel.id, {
            id: `waiter_${Date.now()}`,
            channelId: textChannel.id,
            userId: client.user.id,
            authorName: 'Callista',
            content: complaint,
            timestamp: Date.now(),
            isBot: true
          });
        }
        console.log(`[VOICE_WAITER] 5 menit timeout nunggu ${displayName} di #${channelName}. Leaving VC.`);
        voiceUtils.leaveVoice(guildId, client.user.id);
      }
    } catch (e) {
      console.error('[VOICE_WAITER TIMEOUT ERROR]', e.message);
    } finally {
      pendingOrders.delete(guildId);
    }
  }, WAIT_DURATION_MS);

  pendingOrders.set(guildId, {
    voiceChannelId: voiceChannel.id,
    channelName,
    textChannelId: textChannel?.id || null,
    textChannel,
    callerId,
    callerName: displayName,
    isJoy,
    joinedAt: Date.now(),
    otherUserGreeted: false,
    timer
  });

  console.log(`[VOICE_WAITER] Callista disuruh masuk #${channelName} oleh ${displayName}. Menunggu 5 menit...`);
  return pick(JOIN_ORDER_TEMPLATES)(channelName, displayName);
}

function cancelOrder(guildId) {
  if (pendingOrders.has(guildId)) {
    const order = pendingOrders.get(guildId);
    if (order.timer) clearTimeout(order.timer);
    pendingOrders.delete(guildId);
  }
}

function hasPendingOrder(guildId) {
  return pendingOrders.has(guildId);
}

function getPendingOrder(guildId) {
  return pendingOrders.get(guildId) || null;
}

/**
 * Dipanggil dari voiceStateUpdate ketika ada perubahan state di voice channel.
 */
async function handleVoiceStateUpdate(oldState, newState, client) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;
  const guildId = guild.id;
  const order = pendingOrders.get(guildId);
  if (!order) return;

  const currentVc = voiceUtils.getCurrentVoiceChannel(client, guildId);
  // Jika Callista sudah tidak ada di VC tujuan, bersihkan
  if (!currentVc || currentVc.id !== order.voiceChannelId) {
    cancelOrder(guildId);
    return;
  }

  // Cek jika member baru saja bergabung ke VC tujuan Callista
  if (newState.channelId === order.voiceChannelId && oldState.channelId !== order.voiceChannelId) {
    const member = newState.member;
    if (!member || member.id === client.user.id || member.user?.bot) return;

    // KASUS 1: Si penyuruh akhirnya masuk!
    if (member.id === order.callerId) {
      console.log(`[VOICE_WAITER] Penyuruh (${order.callerName}) sudah masuk ke #${order.channelName}! Waiter selesai.`);
      cancelOrder(guildId);
      return;
    }

    // KASUS 2: Orang lain yang masuk duluan!
    if (!order.otherUserGreeted) {
      order.otherUserGreeted = true;
      const otherName = member.displayName || member.user?.globalName || member.user?.username || 'member lain';
      const comment = naturalTyping.humanizeTyping(pick(OTHER_USER_TEMPLATES)(order.channelName, order.callerName, otherName));
      console.log(`[VOICE_WAITER] Orang lain (${otherName}) masuk ke #${order.channelName} saat nunggu ${order.callerName}. Komen: "${comment}"`);

      if (order.textChannel && typeof order.textChannel.send === 'function') {
        try {
          await order.textChannel.send({ content: comment, allowedMentions: { repliedUser: false } });
          storage.addHistory(order.textChannel.id, {
            id: `waiter_other_${Date.now()}`,
            channelId: order.textChannel.id,
            userId: client.user.id,
            authorName: 'Callista',
            content: comment,
            timestamp: Date.now(),
            isBot: true
          });
        } catch (_) {}
      }
    }
  }
}

module.exports = {
  WAIT_DURATION_MS,
  JOIN_ORDER_TEMPLATES,
  TIMEOUT_TEMPLATES,
  OTHER_USER_TEMPLATES,
  registerOrder,
  cancelOrder,
  hasPendingOrder,
  getPendingOrder,
  handleVoiceStateUpdate
};
