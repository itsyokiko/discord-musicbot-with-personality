'use strict';

/**
 * Music Audio Filters Module
 *
 * Mengelola filter audio DisTube / ffmpeg (Nightcore, Bassboost, Vaporwave, 3D, Lo-Fi, Karaoke, dll),
 * menyediakan panel interaktif ber-tombol yang real-time editable,
 * mendukung tombol Hide/Show untuk tampilan bersih,
 * serta mendukung eksekusi cepat via singkatan (>fl nc, >fl bb, >fl off).
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const musicPlayer = require('./musicPlayer');

// Map panel aktif per guild: guildId -> { message, channelId, isHidden, guildId }
const activePanels = new Map();

// Pemetaan singkatan filter ke nama internal DisTube
const FILTER_ALIASES = {
  nc: 'nightcore',
  nightcore: 'nightcore',
  speedup: 'nightcore',

  bb: 'bassboost',
  bass: 'bassboost',
  bassboost: 'bassboost',

  vw: 'vaporwave',
  vaporwave: 'vaporwave',
  slow: 'vaporwave',
  slowed: 'vaporwave',

  '3d': '3d',
  '8d': '3d',

  lofi: 'lofi',
  lf: 'lofi',

  k: 'karaoke',
  karaoke: 'karaoke',
  vocal: 'karaoke',

  sr: 'surround',
  surround: 'surround',

  ec: 'echo',
  echo: 'echo',

  fl: 'flanger',
  flanger: 'flanger',

  rev: 'reverse',
  reverse: 'reverse',

  off: 'clear',
  clear: 'clear',
  reset: 'clear',
  normal: 'clear',
  none: 'clear',
};

// Metadata filter untuk tampilan tombol dan embed
const FILTER_META = {
  nightcore: { label: 'Nightcore', emoji: '⚡', desc: 'Tempo dipercepat + vokal imut' },
  bassboost: { label: 'Bassboost', emoji: '🔊', desc: 'Dentuman bass maksimal' },
  vaporwave: { label: 'Vaporwave', emoji: '📻', desc: 'Slowed & retro aesthetic' },
  '3d': { label: '3D Audio', emoji: '🌀', desc: 'Stereo berputar (pakai headset)' },
  lofi: { label: 'Lo-Fi', emoji: '🍃', desc: 'Low-pass warm ala radio santai' },
  karaoke: { label: 'Karaoke', emoji: '🎤', desc: 'Meredam vokal tengah' },
  surround: { label: 'Surround', emoji: '🌌', desc: 'Panggung suara lebar' },
  echo: { label: 'Echo', emoji: '📢', desc: 'Gema audio berulang' },
};

/**
 * Terjemahkan input user ke nama filter resmi.
 */
function resolveFilterName(raw = '') {
  const clean = String(raw || '').toLowerCase().trim();
  return FILTER_ALIASES[clean] || null;
}

/**
 * Dapatkan DisTube queue untuk guildId.
 */
function getQueue(guildId) {
  try {
    return musicPlayer.safeGetQueue(guildId);
  } catch (_) {
    return null;
  }
}

/**
 * Toggle satu filter atau clear semua filter pada antrean lagu aktif.
 */
function toggleFilter(guildId, filterName) {
  const queue = getQueue(guildId);
  if (!queue) {
    return { ok: false, error: 'no_queue' };
  }

  if (filterName === 'clear') {
    queue.filters.clear();
    return { ok: true, action: 'cleared', active: [] };
  }

  if (queue.filters.has(filterName)) {
    queue.filters.remove(filterName);
    return { ok: true, action: 'removed', filter: filterName, active: queue.filters.names };
  }

  queue.filters.add(filterName);
  return { ok: true, action: 'added', filter: filterName, active: queue.filters.names };
}

/**
 * Buat payload embed dan buttons untuk panel filter.
 */
function buildFilterPanelPayload(queue, isHidden = false) {
  const activeFilters = queue?.filters?.names || [];
  const currentSong = queue?.songs?.[0];
  const songTitle = currentSong ? currentSong.name : 'Tidak ada lagu';

  // Mode Tersembunyi (Clean Minimalist View)
  if (isHidden) {
    const embed = new EmbedBuilder()
      .setColor(activeFilters.length ? 0x2ECC71 : 0x5865F2)
      .setDescription(
        `🎛️ **Audio Filter Panel (Disembunyikan)**\n` +
        `• Filter aktif: ${activeFilters.length ? activeFilters.map(f => `\`${f}\``).join(', ') : '`Normal (Off)`'}\n` +
        `• Lagu: *${songTitle.length > 50 ? songTitle.slice(0, 47) + '...' : songTitle}*`
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('filter_btn_show')
        .setLabel('🎛️ Buka Panel Filter')
        .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [embed], components: [row] };
  }

  // Mode Lengkap (Full Interactive Controls)
  const activeListStr = activeFilters.length
    ? activeFilters.map(f => `\`${f}\``).join(', ')
    : '`Normal (Off)`';

  const embed = new EmbedBuilder()
    .setColor(activeFilters.length ? 0x2ECC71 : 0x5865F2)
    .setTitle('🎛️ Audio Filter Control Panel')
    .setDescription(
      `Lagu: **${songTitle.length > 60 ? songTitle.slice(0, 57) + '...' : songTitle}**\n` +
      `Status: **${activeFilters.length ? '🟢 ' + activeListStr : '⚪ Normal (Tanpa Filter)'}**\n\n` +
      `*Klik tombol di bawah untuk toggle filter audio secara instan:*`
    )
    .setFooter({ text: 'Callista Music Engine • Realtime Editable' });

  // Baris 1: Filter Populer
  const row1 = new ActionRowBuilder().addComponents(
    ['nightcore', 'bassboost', 'vaporwave', '3d'].map(name => {
      const meta = FILTER_META[name];
      const isActive = activeFilters.includes(name);
      return new ButtonBuilder()
        .setCustomId(`filter_btn_${name}`)
        .setLabel(isActive ? `${meta.label} (ON)` : meta.label)
        .setEmoji(meta.emoji)
        .setStyle(isActive ? ButtonStyle.Success : ButtonStyle.Secondary);
    })
  );

  // Baris 2: Nuansa & Vokal
  const row2 = new ActionRowBuilder().addComponents(
    ['lofi', 'karaoke', 'surround', 'echo'].map(name => {
      const meta = FILTER_META[name];
      const isActive = activeFilters.includes(name);
      return new ButtonBuilder()
        .setCustomId(`filter_btn_${name}`)
        .setLabel(isActive ? `${meta.label} (ON)` : meta.label)
        .setEmoji(meta.emoji)
        .setStyle(isActive ? ButtonStyle.Success : ButtonStyle.Secondary);
    })
  );

  // Baris 3: Tombol Aksi (Reset / Off & Hide)
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('filter_btn_clear')
      .setLabel('Reset (Off)')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(activeFilters.length === 0),
    new ButtonBuilder()
      .setCustomId('filter_btn_hide')
      .setLabel('Sembunyikan')
      .setEmoji('👁️')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row1, row2, row3] };
}

/**
 * Kirim atau perbarui panel filter di text channel.
 */
async function sendOrUpdateFilterPanel(channel, guildId) {
  const queue = getQueue(guildId);
  if (!queue) {
    return { ok: false, error: 'no_queue' };
  }

  const existing = activePanels.get(guildId);
  const payload = buildFilterPanelPayload(queue, false);

  if (existing && existing.message && existing.channelId === channel.id) {
    try {
      await existing.message.edit(payload);
      existing.isHidden = false;
      return { ok: true, message: existing.message, reused: true };
    } catch (_) {
      activePanels.delete(guildId);
    }
  }

  // Jika belum ada atau pesan lama gagal diedit, kirim pesan baru
  try {
    const sent = await channel.send(payload);
    activePanels.set(guildId, {
      message: sent,
      messageId: sent.id,
      channelId: channel.id,
      guildId,
      isHidden: false,
    });
    return { ok: true, message: sent, reused: false };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Update panel yang sudah ada di guild (misal saat command singkatan >fl nc dijalankan).
 */
async function updateExistingPanel(guildId) {
  const panel = activePanels.get(guildId);
  if (!panel || !panel.message) return false;

  const queue = getQueue(guildId);
  if (!queue) {
    cleanupPanel(guildId);
    return false;
  }

  const payload = buildFilterPanelPayload(queue, Boolean(panel.isHidden));
  try {
    await panel.message.edit(payload);
    return true;
  } catch (_) {
    activePanels.delete(guildId);
    return false;
  }
}

/**
 * Handler saat tombol pada panel filter ditekan.
 */
async function handleButtonInteraction(interaction) {
  const customId = interaction.customId;
  const guildId = interaction.guildId;
  if (!guildId || !customId.startsWith('filter_btn_')) return false;

  const action = customId.slice('filter_btn_'.length);
  const queue = getQueue(guildId);

  if (!queue) {
    await interaction.reply({ content: 'lagu udah selesai atau ga ada yang diputer mas joy 😭', ephemeral: true }).catch(() => {});
    cleanupPanel(guildId);
    return true;
  }

  const panel = activePanels.get(guildId);

  // Tombol Sembunyikan (Hide)
  if (action === 'hide') {
    if (panel) panel.isHidden = true;
    const payload = buildFilterPanelPayload(queue, true);
    await interaction.update(payload).catch(() => {});
    return true;
  }

  // Tombol Tampilkan (Show)
  if (action === 'show') {
    if (panel) panel.isHidden = false;
    const payload = buildFilterPanelPayload(queue, false);
    await interaction.update(payload).catch(() => {});
    return true;
  }

  // Tombol Reset / Clear
  if (action === 'clear') {
    queue.filters.clear();
    const payload = buildFilterPanelPayload(queue, Boolean(panel?.isHidden));
    await interaction.update(payload).catch(() => {});
    return true;
  }

  // Tombol Toggle Filter Tertentu
  const targetFilter = action;
  if (queue.filters.has(targetFilter)) {
    queue.filters.remove(targetFilter);
  } else {
    queue.filters.add(targetFilter);
  }

  const payload = buildFilterPanelPayload(queue, Boolean(panel?.isHidden));
  await interaction.update(payload).catch(() => {});
  return true;
}

/**
 * Cek apakah ada box filter aktif di guild.
 */
function hasActivePanel(guildId) {
  return activePanels.has(guildId);
}

/**
 * Hapus referensi panel (misal saat musik stop).
 */
function cleanupPanel(guildId) {
  const panel = activePanels.get(guildId);
  if (panel && panel.message) {
    try {
      panel.message.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(0x7F8C8D)
            .setDescription('⏹ **Musik dihentikan.** Panel filter telah dinonaktifkan.')
        ],
        components: []
      }).catch(() => {});
    } catch (_) {}
  }
  activePanels.delete(guildId);
}

module.exports = {
  FILTER_ALIASES,
  FILTER_META,
  resolveFilterName,
  toggleFilter,
  buildFilterPanelPayload,
  sendOrUpdateFilterPanel,
  updateExistingPanel,
  handleButtonInteraction,
  hasActivePanel,
  cleanupPanel,
};
