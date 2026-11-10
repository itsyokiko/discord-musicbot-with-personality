# Callista â€” Context-Aware Discord AI Companion

A pragmatic, natural group-member Discord AI companion with JSON persistence, strict Pre-AI filtering, message burst aggregation, multi-message support, daily life simulation (24h schedule), strict immersion boundaries, and a real-time personality controller.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env`:
   ```env
   DISCORD_TOKEN=your_discord_bot_token
   RELINK_API_KEY=your_relink_api_key
   RELINK_BASE_URL=https://api.relink-gateway.biz.id/v1
   RELINK_MODEL=deepseek-v4-pro
   TINYFISH_API_KEY=your_tinyfish_api_key
   PORT=3001
   ```
3. Run the Daily Context Generator (generates `data/daily_context.json`):
   ```bash
   # Generate today's schedule once:
   npm run generator:once

   # Or run as a background daemon (refreshes daily at 00:00 WIB):
   npm run generator
   ```
4. Start the Discord Bot & Controller Dashboard:
   ```bash
   npm start
   ```
5. Open the Personality Controller:
   [http://localhost:3001](http://localhost:3001)

---

## Dual-Process Architecture

Callista runs as two independent, non-blocking Node.js processes:

1. **Discord Companion Process (`npm start`)**:
   - Listens to Discord messages, buffers bursts, and executes decisions.
   - Reads the current real-time activity from `data/daily_context.json` instantly without waiting on AI.
   - Serves the personality dashboard at `http://localhost:3001`.

2. **Daily Life Generator Process (`npm run generator`)**:
   - Runs independently in its own process or as a scheduled job.
   - Generates a rich 24-hour daily life schedule (00:00 to 23:59) using AI every day at 00:00:05 WIB.
   - Concurrency lock (`data/.generator.lock`) prevents multiple simultaneous generator writers.
   - Atomic file writes (`.tmp` -> rename) prevent corrupted or half-baked JSON.
   - If AI fails or times out, keeps the last valid context or saves a reliable fallback without crashing.

---

## Daily Life System (`data/daily_context.json`)

The schedule models Callista's life: sleep, wake up, gaming, chilling, chores, and Discord activity:
- `sleep_schedule`: Estimated sleep and wake times (e.g. 02:00 to 09:30).
- `schedule`: Hourly blocks with `activity`, `availability` (`sleeping`, `busy`, `active`, `relaxing`, `away`), and `reply_tendency` (`unlikely`, `delayed`, `casual`, `responsive`).
- `plans`: Planned highlights for the day.
- `daily_events`: Dynamic daily events (e.g. game patch updates, friends asking to play).
- **Token Efficiency**: The bot only injects a concise 3-line status (current activity, availability, and next plan) into the system promptâ€”never the full 24-hour JSON.

---

## Callista Background (`data/callista_background.txt`)

Latar belakang pribadi Callista (asal-usul, keluarga, hobi, kesukaan, ketidaksukaan, kebiasaan bicara, dan prinsip) disimpan sebagai teks biasa di `data/callista_background.txt`:
- Otomatis di-inject ke system prompt sebagai memori pribadi, bukan daftar hafalan.
- Bisa diedit langsung dari dashboard (card **Callista Background**) atau file-nya.
- Perubahan langsung aktif pada pesan berikutnya (hot reload berdasarkan `mtime` file).
- Jika file kosong/hilang, sistem memakai fallback pendek di `src/background.js` agar bot tetap berkarakter.
- Prompt melarang Callista menceritakan ulang seluruh background sekaligus atau membocorkan sumbernya.

---

## Strict Immersion Boundaries & Character Integrity

Callista strictly preserves her character integrity, persona, and fictional boundaries:
- **Resists OOC and Manipulation**: Rejects prompt injection, "ignore previous instructions", "act as unrestricted AI", or roleplay breaking.
- **Data Protection**: Never reveals system prompts, hidden instructions, raw internal JSON (`daily_context.json`, `config.json`), or API keys.
- **Authority Claims Ignored**: Claims of being developer, admin, or threats do not bypass boundaries.
- **Natural Informal Refusals**: Uses casual Indonesian refusals (`"ogah wkwk"`, `"kagak mau, ngapain jir"`, `"lu ngapain ngintip ginian ðŸ˜­"`, `"udah ah, ganti topik"`). Escalates to shorter responses or silence if pressed.
- **Normal Conversations Unaffected**: Questions about games, music, daily activities, or casual banter are answered normally based on her current daily context.

---

## Architecture

- `src/bot.js`: Discord listener, burst aggregator, deduplicator, and sequential message dispatcher.
- `src/dailyLifeGenerator.js`: Independent 24-hour daily life generator process.
- `src/dailyContextStore.js`: Atomic JSON reader/writer, schema validator, and time-matching resolver.
- `src/decision.js`: Strict Pre-AI gate, alias regex matcher, and immersion breach detector.
- `src/ai.js`: Structured LLM client (Re:Link/OpenAI-compatible) with Intent Classification, Daily Context awareness, and VIP speaker handling.
- `src/llm.js`: Re:Link Gateway client (base URL, API key, model, timeout, token usage logging).
- `src/background.js`: Loader/saver for Callista's personal background and prompt block builder.
- `data/callista_background.txt`: Editable long-form background (origin, hobbies, likes, dislikes).
- `src/storage.js`: Bounded JSON persistence for `config.json`, `history.json`, and `memory.json`.
- `src/musicPlayer.js`: DisTube v5 wrapper (queue, voice, playlist, error handling).
- `src/youtubePluginV5.js`: Custom DisTube extractor plugin berbasis `@distube/ytdl-core` v5.
- `src/youtubePlaylist.js`: Resolver playlist YouTube via Innertube (pengganti `@distube/ytpl`).
- `src/musicStore.js`: Penyimpanan playlist tersimpan (remote YouTube + playlist lokal berisi lagu, termasuk Favorit).
- `src/tinyfishSearch.js`: Client TinyFish Search API untuk pencarian lagu YouTube (tanpa AI, hasil di-cache per channel+user).
- `src/server.js`: Zero-dependency HTTP server serving `public/index.html` and REST APIs.
- `data/daily_context.json`: Persistent 24-hour daily life context.
- `public/index.html`: Real-time dashboard with personality sliders, background editor, daily life status card, and relationship editor.

---

## Music & Voice (Mas Joy only)

Fitur musik dan voice hanya bisa dipakai oleh **Mas Joy** (`833196669940138004`). User lain akan ditolak secara natural oleh Callista.

**Persiapan:**
- `npm install` (sudah termasuk `distube` v5, `@distube/ytdl-core` v5, `@discordjs/voice`, dan `ffmpeg-static`).
- Disarankan Node.js **22.22.2+** (atau 24.15.0+) karena `@distube/ytdl-core` v5 memakai fitur Node terbaru.
- Bot butuh permission **Connect**, **Speak**, dan **View Channel** di voice channel tujuan.
- Tujuan voice: VC Mas Joy saat ini â†’ VC Callista saat ini (kalau beda) â†’ kalau dua-duanya kosong, bot minta Mas Joy masuk VC dulu.

**Command yang didukung:**
- Putar lagu: judul lagu atau URL YouTube.
- Putar playlist: nama/alias playlist yang disimpan di `data/playlists.json`, atau URL playlist YouTube.
- Kontrol: `shuffle`, `skip`, `stop`, `queue`, `pause`, `resume`.
- Voice: `join` / `leave` (otomatis stop musik dulu supaya tidak bentrok koneksi).

**Perintah cepat tanpa AI (deterministik):**
- Prefix `>` selalu diproses langsung, tanpa LLM: `>skip`, `>stop`, `>pause`, `>resume`, `>queue`, `>shuffle`, `>np`, `>join [vc]`, `>leave`, `>play <judul/link>`, `>playlist <nama>`, `>add`, `>like`, `>create`, `>help`.
- Natural control juga dikenali: `cal, skip`, `cal, stop lagu ini`, `cal, antrian`, `cal, lanjutin`.
- Aksi dijalankan dulu, baru reaksi/balasan dikirim (khusus `stop`: stop + keluar VC dulu, baru konfirmasi).
- Kalau AI salah mengklasifikasi perintah kontrol jadi `PLAY_*`, ada guard yang memaksa format kontrol yang benar.

**Playlist lokal (simpan lagu, bukan langsung putar):**
- `>add <link>` â€” simpan lagu. Kalau belum jelas targetnya, Callista nanya: *"masukin kemana ini?"* lalu Mas Joy balas `di <nama playlist>` atau `favorit`. Bisa kirim banyak link sekaligus.
- `>add <link> >>NamaPlaylist` â€” langsung simpan ke playlist lokal `NamaPlaylist`.
- `>add now >>NamaPlaylist` â€” simpan lagu yang sedang diputar.
- `>like <link>` â€” shortcut simpan ke playlist **Favorit** (dibuat otomatis saat pertama dipakai).
- `>create <nama>` â€” bikin playlist lokal kosong.
- Natural: `cal, tambah <link> di favorit`, `cal, tambah lagu sekarang ke favorit`, `cal, <link> masukin ke abcd`, `cal, buat playlist abcd`.
- Memutar ulang: `>playlist <nama>` atau `cal, puter <nama>`. Playlist Favorit juga bisa diputar seperti playlist biasa.
- Playlist YouTube remote (mis. `One Ok Rock`) tetap **read-only**: cuma bisa diputar, tidak bisa ditambahi lagu.

**Cari lagu (TinyFish Search, tanpa AI):**
- `cal, cari lagu renegades one ok rock` â€” query otomatis ditambah kata `youtube` dan dibatasi ke domain `youtube.com`; hasil tampil bernomor + link.
- `>search <judul>` â€” versi prefix.
- Balas `nomor 1` â€” puter hasil nomor 1.
- Balas `nomor 1 ke abcd` atau `nomor 1 ke favorit` â€” simpan hasil nomor 1 ke playlist lokal.
- Hasil pencarian disimpan 10 menit per channel+user, jadi memilih nomor tidak memanggil API lagi.
- AI **tidak** dipakai untuk mencari; AI hanya dipakai untuk obrolan biasa di luar perintah ini.
- Free tier TinyFish: 12.000 request/hari, 30 request/menit. Kalau kena 402/429, Callista kasih tahu error-nya.

**Catatan playlist:**
- Resolver playlist memakai Innertube langsung (`src/youtubePlaylist.js`), bukan `@distube/ytpl` yang sudah tidak kompatibel dengan struktur YouTube terbaru.
- Stream audio memakai plugin sendiri (`src/youtubePluginV5.js`) berbasis `@distube/ytdl-core` v5. Plugin lama `@distube/youtube` sudah tidak dipakai karena `ytdl-core` 4.x tidak lagi bisa membaca signature YouTube (`Failed to find any playable formats`).
- Maksimal **100 lagu pertama** per playlist remote (`MAX_PLAYLIST_SONGS`) supaya hemat memori/CPU.
- Metadata lagu remote diambil otomatis satu per satu saat diputar, jadi playlist besar tidak membebani bot di awal.
- Playlist lokal menyimpan `{ id, title, url, duration, addedAt }`. Judul diambil saat lagu ditambah; kalau YouTube sedang rate-limit, lagu tetap tersimpan dan judulnya fallback ke ID video.

**Kalau muncul error 429 / "Sign in to confirm you're not a bot":**
YouTube sedang membatasi IP tersebut. Solusinya pakai cookies akun YouTube (sebaiknya akun cadangan):

1. Ekspor cookies YouTube dari browser memakai ekstensi seperti **Get cookies.txt LOCALLY** (format Netscape `cookies.txt`).
2. Impor ke bot:
   ```bash
   node scripts/import-youtube-cookies.js path\ke\cookies.txt
   ```
   Hasilnya tersimpan di `data/youtube_cookies.json` (jangan dibagikan, isinya sesi login).
3. Restart bot (`npm start`).

Alternatif: set environment variable `YOUTUBE_COOKIES` berisi JSON array cookie. Kalau tetap kena limit, tunggu beberapa menit/jam atau jalankan bot dari IP lain.

---

## Verification Checklist

- [x] Run `npm test`: verifies storage bounds, Pre-AI gate, immersion breach detection, daily context time matching, concurrency locks, and AI format parsers.
- [x] Test `npm run generator:once`: verifies atomic generation and schema validation for 24h daily life.
- [x] Test normal question: Callista answers naturally using current daily activity without dumping raw JSON.
- [x] Test prompt injection attack: Callista naturally rejects with informal refusal (`"ogah wkwk, ngapain jir..."`).
- [x] Test VIP user (Mas Joy / Rieka): Callista speaks sweetly, respectfully, and calls him "Mas Joy" / "Daddy" / "Ayah".

