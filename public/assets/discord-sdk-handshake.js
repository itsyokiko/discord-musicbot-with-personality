/**
 * Discord Embedded App SDK Standalone Handshake (Native RPC)
 * Menjalankan handshake resmi Discord Activity Opcode 0 tanpa dependensi eksternal / CDN.
 * Menyimpan parameter Discord ke sessionStorage agar tidak hilang saat navigasi antar rute.
 */
(function() {
  if (typeof window === 'undefined') return;

  const sp = new URLSearchParams(window.location.search);
  const dcParams = ['frame_id', 'instance_id', 'client_id', 'platform', 'channel_id', 'guild_id'];

  // Simpan parameter Discord jika ada di URL saat ini
  dcParams.forEach(function(param) {
    const val = sp.get(param);
    if (val) {
      try { sessionStorage.setItem('dc_' + param, val); } catch (_) {}
    }
  });

  const frameId = sp.get('frame_id') || (function() {
    try { return sessionStorage.getItem('dc_frame_id'); } catch (_) { return null; }
  })();

  if (!frameId) return; // Bukan Discord Activity

  const clientId = sp.get('client_id') || (function() {
    try { return sessionStorage.getItem('dc_client_id'); } catch (_) { return null; }
  })() || '1561650922281762836';

  const rpcSource = (window.parent && window.parent.opener) ? window.parent.opener : window.parent;
  if (!rpcSource) return;

  const handshakePayload = [
    0, // Opcode 0: HANDSHAKE
    {
      v: 1,
      encoding: 'json',
      client_id: clientId,
      frame_id: frameId,
      sdk_version: '1.1.0'
    }
  ];

  // Kirim handshake ke parent window (Discord client)
  try {
    rpcSource.postMessage(handshakePayload, '*');
    if (document.referrer) {
      try {
        const refOrigin = new URL(document.referrer).origin;
        if (refOrigin && refOrigin !== 'null') {
          rpcSource.postMessage(handshakePayload, refOrigin);
        }
      } catch (_) {}
    }
    console.log('[DISCORD_SDK] Native handshake Opcode 0 sent to Discord client.');
  } catch (err) {
    console.warn('[DISCORD_SDK] Failed to postMessage handshake:', err);
  }

  // Handle incoming reply dari Discord Client
  window.addEventListener('message', function onDiscordMsg(ev) {
    if (!Array.isArray(ev.data)) return;
    const opcode = ev.data[0];
    const data = ev.data[1];
    if (opcode === 0 || (opcode === 1 && data && data.evt === 'READY')) {
      console.log('[DISCORD_SDK] Discord client successfully initialized activity!');
    }
  });
})();
