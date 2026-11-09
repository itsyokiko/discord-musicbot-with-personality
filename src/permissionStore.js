/**
 * Daftar user yang diizinkan memerintah Callista (perintah musik, playlist,
 * pencarian, dan voice). Ditambahkan lewat `>permit @user` oleh Mas Joy.
 *
 * Disimpan terpisah dari config.json supaya tidak ikut tertimpa saat dashboard
 * menyimpan config atau saat `npm test` menulis ulang config.
 */

const fs = require('node:fs');
const path = require('node:path');

const filePath = path.resolve(__dirname, '../data/permissions.json');

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data && typeof data.users === 'object' && data.users) return { users: data.users };
  } catch (e) {
    // file belum ada / rusak -> mulai kosong
  }
  return { users: {} };
}

function save(data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  } catch (e) {
    console.error('[PERMIT] Gagal menyimpan permissions.json:', e.message);
  }
}

const permissions = load();

function isPermitted(userId) {
  return Boolean(userId && permissions.users[userId]);
}

function grant(userId, name, addedBy) {
  if (!userId) return false;
  permissions.users[userId] = {
    name: name || null,
    addedBy: addedBy || null,
    addedAt: new Date().toISOString(),
  };
  save(permissions);
  return true;
}

function revoke(userId) {
  if (!permissions.users[userId]) return false;
  delete permissions.users[userId];
  save(permissions);
  return true;
}

function list() {
  return Object.entries(permissions.users).map(([id, info]) => ({ id, ...info }));
}

module.exports = {
  isPermitted,
  grant,
  revoke,
  list,
};
