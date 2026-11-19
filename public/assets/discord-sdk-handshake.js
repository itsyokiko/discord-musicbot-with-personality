/**
 * Discord Embedded App SDK Standalone Handshake (Native RPC)
 * Menjalankan handshake resmi Discord Activity Opcode 0 tanpa dependensi eksternal / CDN
 */
(function() {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams(window.location.search);
  const frameId = sp.get('frame_id');
  if (!frameId) return; // Bukan Discord Activity

  const clientId = sp.get('client_id') || '1347881958286262334';
  const instanceId = sp.get('instance_id');
  const platform = sp.get('platform') || 'DESKTOP';

  const rpcSource = (window.parent && window.parent.opener) ? window.parent.opener : window.parent;
  if (!rpcSource) return;

  const targetOrigin = document.referrer ? document.referrer : '*';
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

  try {
    rpcSource.postMessage(handshakePayload, targetOrigin);
    console.log('[DISCORD_SDK] Native handshake Opcode 0 sent to Discord client.');
  } catch (err) {
    console.warn('[DISCORD_SDK] Failed to postMessage handshake:', err);
  }

  // Handle incoming reply from Discord
  window.addEventListener('message', function onDiscordMsg(ev) {
    if (!Array.isArray(ev.data)) return;
    const [opcode, data] = ev.data;
    if (opcode === 0 || (opcode === 1 && data && data.evt === 'READY')) {
      console.log('[DISCORD_SDK] Discord client successfully initialized activity!');
    }
  });
})();
