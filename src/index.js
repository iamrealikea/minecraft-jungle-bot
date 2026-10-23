import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  MessageFlags,
} from 'discord.js';
import { ENV } from './config.js';
import { commands, registerSlashCommands } from './deploy-commands.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { stopTunnel } from './tunnel.js';

if (!ENV.DISCORD_TOKEN) {
  console.error(
    '❌ Error: DISCORD_TOKEN is missing!\n' +
      'Please copy .env.example to .env and fill in your Discord Bot Token.'
  );
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commandMap = new Collection();
for (const cmd of commands) {
  commandMap.set(cmd.data.name, cmd);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);

  // Auto-register slash commands using client's own Application ID if DISCORD_CLIENT_ID is omitted
  const appId = ENV.DISCORD_CLIENT_ID || readyClient.user.id;
  try {
    await registerSlashCommands(ENV.DISCORD_TOKEN, appId);
  } catch (err) {
    console.warn('[Commands] Could not auto-register slash commands:', err.message);
  }

  // Start the 2-minute status polling and presence loop
  startScheduler(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commandMap.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[Command:${interaction.commandName}] Execution error:`, err);
    const errorReply = {
      content: `❌ An error occurred while executing \`/${interaction.commandName}\`: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(errorReply).catch(() => {});
    } else {
      await interaction.reply(errorReply).catch(() => {});
    }
  }
});

// Graceful shutdown cleanup
function handleShutdown(signal) {
  console.log(`\n[System] Received ${signal}. Cleaning up...`);
  stopScheduler();
  stopTunnel();
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

client.login(ENV.DISCORD_TOKEN);
