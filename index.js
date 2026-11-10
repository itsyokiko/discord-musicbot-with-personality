const fs = require('node:fs');
const path = require('node:path');

const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const storage = require('./src/storage');
const { startServer } = require('./src/server');
const { startBot } = require('./src/bot');

const config = storage.getConfig();
const port = process.env.PORT || config.port || 3001;
startServer(port);

const token = process.env.DISCORD_TOKEN;
if (token) {
  startBot(token);
} else {
  console.error('Missing DISCORD_TOKEN in .env or environment');
}

// Auto daily context: start generator daemon (non-blocking)
require('./src/dailyLifeGenerator');
