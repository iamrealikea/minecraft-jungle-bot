import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.resolve(__dirname, '..', 'config.json');

const DEFAULT_CONFIG = {
  serverHost: '',
  serverPort: 25565,
  tunnelMode: 'auto', // 'auto' | 'cloudflare' | 'direct'
  detectedMode: null, // 'direct' | 'cloudflare' | null
  localTunnelHost: '127.0.0.1',
  localTunnelPort: 25565,
  statusChannelId: null,
  statusMessageId: null,
};

export const ENV = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN || '',
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
  GUILD_ID: process.env.GUILD_ID || '',
  CLOUDFLARED_PATH: process.env.CLOUDFLARED_PATH || 'cloudflared',
};

/**
 * Reads the current configuration from config.json, merging with defaults.
 */
export function getConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch (err) {
    console.error('[Config] Error reading config.json, falling back to defaults:', err.message);
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Updates config.json with partial updates and returns the updated config.
 */
export function updateConfig(updates) {
  const current = getConfig();
  const next = { ...current, ...updates };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.error('[Config] Failed to save config.json:', err.message);
  }
  return next;
}
