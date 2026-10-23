import { REST, Routes } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { ENV } from './config.js';
import * as statusCommand from './commands/status.js';
import * as setupCommand from './commands/setup.js';

export const commands = [statusCommand, setupCommand];

/**
 * Registers slash commands with Discord REST API (Guild-scoped if GUILD_ID is set, otherwise Global).
 */
export async function registerSlashCommands(token = ENV.DISCORD_TOKEN, clientId = ENV.DISCORD_CLIENT_ID) {
  if (!token || !clientId) {
    throw new Error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in environment (.env).');
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const body = commands.map((cmd) => cmd.data.toJSON());

  if (ENV.GUILD_ID) {
    console.log(`[Commands] Registering ${body.length} slash commands to guild ${ENV.GUILD_ID}...`);
    await rest.put(Routes.applicationGuildCommands(clientId, ENV.GUILD_ID), { body });
    console.log('[Commands] Successfully registered guild slash commands.');
  } else {
    console.log(`[Commands] Registering ${body.length} global slash commands...`);
    await rest.put(Routes.applicationCommands(clientId), { body });
    console.log('[Commands] Successfully registered global slash commands.');
  }
}

// Run directly if invoked via `npm run deploy-commands`
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  registerSlashCommands().catch((err) => {
    console.error('[Commands] Failed to deploy slash commands:', err.message);
    process.exit(1);
  });
}
