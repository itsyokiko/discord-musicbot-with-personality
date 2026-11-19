const fs = require('fs');
let src = fs.readFileSync('src/movieActivity.js', 'utf8');

// 1. Hapus blok inline SDK script + tambah movie-player.js
const sdk1 = '  <script>\r\n    (async function initOfficialDiscordSdk()';
const sdkEnd = '  </script>\r\n  <style>';
const i1 = src.indexOf(sdk1);
const i1end = src.indexOf(sdkEnd, i1);
if (i1 !== -1 && i1end !== -1) {
  src = src.substring(0, i1) +
    '  <!-- Movie Player: semua client JS eksternal, CSP-compliant untuk Discord Desktop -->\r\n' +
    '  <script src="/assets/movie-player.js"></script>\r\n' +
    src.substring(i1end + '  </script>'.length);
  console.log('OK: blok SDK inline dihapus, movie-player.js ditambah');
} else {
  console.log('SKIP: blok SDK inline tidak ditemukan');
}

// 2. Hapus blok inline player script
const sdk2 = '  <script>\r\n    // Auto-detect Discord Activity environment';
const sdk2close = '  </script>\r\n</body>';
const i2 = src.indexOf(sdk2);
const i2end = src.indexOf(sdk2close, i2);
if (i2 !== -1 && i2end !== -1) {
  src = src.substring(0, i2) +
    '  <!-- movie-player.js sudah di-load di head; semua JS ada di sana -->\r\n' +
    src.substring(i2end + '  </script>'.length);
  console.log('OK: blok player inline dihapus');
} else {
  console.log('SKIP: blok player inline tidak ditemukan');
}

// 3. Ganti inline event handlers (simple, no args)
const reps = [
  ['onclick="toggleSidebar()"',         'data-action="toggleSidebar"'],
  ['onclick="closeSidebar()"',          'data-action="closeSidebar"'],
  ['onclick="toggleEpisodePanel()"',    'data-action="toggleEpisodePanel"'],
  ['onclick="openSettingsModal()"',     'data-action="openSettingsModal"'],
  ['onclick="closeSettingsModal()"',    'data-action="closeSettingsModal"'],
  ['onclick="saveDomainSettings()"',    'data-action="saveDomainSettings"'],
  ['onclick="toggleTheme()"',           'data-action="toggleTheme"'],
  ['onclick="toggleAdShield()"',        'data-action="toggleAdShield"'],
  ['onclick="reloadPlayer()"',          'data-action="reloadPlayer"'],
  ['onclick="toggleVideoFullscreen()"', 'data-action="toggleVideoFullscreen"'],
  ['onclick="toggleViewerMute()"',      'data-action="toggleViewerMute"'],
  ["onclick=\"setPlayerMode('local')\"", 'data-action="setPlayerModeLocal"'],
  ["onclick=\"setPlayerMode('embed')\"", 'data-action="setPlayerModeEmbed"'],
  ['oninput="setViewerVolume(this.value)"', ''],
  ['onload="onFrameLoad()"',            ''],
];
let changed = 0;
for (const [from, to] of reps) {
  const before = src;
  src = src.split(from).join(to);
  if (src !== before) changed++;
}
console.log('OK: simple handlers diganti:', changed);

// 4. sendReaction dengan emoji
src = src.replace(/onclick="sendReaction\('([^']+)'\)"/g, (_, emoji) => {
  return `data-action="sendReaction" data-emoji="${emoji}"`;
});

// 5. changeServer di template literal
src = src.replace(
  /onclick="changeServer\(this,'(\$\{[^}]+\})'\)"/g,
  'data-action="changeServer" data-src="$1"'
);

console.log('OK: sendReaction + changeServer diganti');

// 6. Simpan
fs.writeFileSync('src/movieActivity.js', src, 'utf8');
console.log('File saved. Length:', src.length);

// 7. Self-check dalam template HTML saja
const tmplStart = src.indexOf('return `');
const tmpl = tmplStart !== -1 ? src.substring(tmplStart) : src;
const scripts  = [...tmpl.matchAll(/<script>/g)].length;
const handlers = [...tmpl.matchAll(/\bonclick=|\boninput=/g)].length;
const onloads  = [...tmpl.matchAll(/\bonload=/g)].filter(m => {
  const ctx = tmpl.substring(Math.max(0, m.index - 40), m.index + 10);
  return !ctx.includes('<link');
}).length;

console.log('\nSelf-check in template HTML:');
console.log('  Inline <script>  :', scripts);
console.log('  onclick/oninput  :', handlers);
console.log('  onload (non-link):', onloads);
if (scripts === 0 && handlers === 0 && onloads === 0) {
  console.log('\n✅ CLEAN — Discord Desktop CSP compliant');
} else {
  console.log('\n❌ Masih ada yang perlu diperbaiki');
}
