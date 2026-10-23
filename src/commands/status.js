import { SlashCommandBuilder } from 'discord.js';
import { queryServer } from '../minecraft.js';
import { buildStatusMessagePayload } from '../embeds.js';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Ping the Minecraft server and display its live status')
  .addStringOption((opt) =>
    opt
      .setName('host')
      .setDescription('Optional custom server address to check (defaults to configured server)')
      .setRequired(false)
  )
  .addIntegerOption((opt) =>
    opt
      .setName('port')
      .setDescription('Optional server port (default: 25565)')
      .setMinValue(1)
      .setMaxValue(65535)
      .setRequired(false)
  )
  .addStringOption((opt) =>
    opt
      .setName('tunnel')
      .setDescription('Connection mode (Auto-Detect, Cloudflare Tunnel, or Direct)')
      .addChoices(
        { name: 'Auto-Detect (Recommended)', value: 'auto' },
        { name: 'Cloudflare Tunnel', value: 'cloudflare' },
        { name: 'Direct Connection', value: 'direct' }
      )
      .setRequired(false)
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const customHost = interaction.options.getString('host');
  const customPort = interaction.options.getInteger('port');
  const customTunnel = interaction.options.getString('tunnel');

  const queryOptions = {};
  if (customHost) queryOptions.host = customHost;
  if (customPort) queryOptions.port = customPort;
  if (customTunnel) queryOptions.tunnelMode = customTunnel;

  const status = await queryServer(queryOptions);
  const payload = buildStatusMessagePayload(status);

  await interaction.editReply(payload);
}
