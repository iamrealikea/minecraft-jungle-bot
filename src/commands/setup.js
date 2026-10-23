import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getConfig, updateConfig } from '../config.js';
import { queryServer } from '../minecraft.js';
import { buildStatusMessagePayload } from '../embeds.js';
import { runStatusUpdate } from '../scheduler.js';
import { stopTunnel } from '../tunnel.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure the Minecraft server and live status channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('server')
      .setDescription('Set the Minecraft server address and Cloudflare Tunnel mode')
      .addStringOption((opt) =>
        opt
          .setName('host')
          .setDescription('Minecraft server domain or IP (e.g. mc.yourdomain.com)')
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('tunnel')
          .setDescription('Connection method (Auto-Detect or explicit Cloudflare Tunnel / Direct)')
          .addChoices(
            { name: 'Auto-Detect (Recommended)', value: 'auto' },
            { name: 'Cloudflare Tunnel', value: 'cloudflare' },
            { name: 'Direct Connection', value: 'direct' }
          )
          .setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt
          .setName('port')
          .setDescription('Minecraft server port (default: 25565)')
          .setMinValue(1)
          .setMaxValue(65535)
          .setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt
          .setName('local_port')
          .setDescription('Local port for cloudflared access tcp bridge (default: 25565)')
          .setMinValue(1)
          .setMaxValue(65535)
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('channel')
      .setDescription('Set the Discord channel for the 2-minute auto-updating status embed')
      .addChannelOption((opt) =>
        opt
          .setName('target')
          .setDescription('Text channel where the live status embed will be posted')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('info')
      .setDescription('View the current bot configuration and detected tunnel mode')
  );

export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'server') {
    await interaction.deferReply();

    const host = interaction.options.getString('host', true).trim();
    const tunnelMode = interaction.options.getString('tunnel') ?? 'auto';
    const port = interaction.options.getInteger('port') ?? 25565;
    const localTunnelPort = interaction.options.getInteger('local_port') ?? 25565;

    // Stop any previous managed tunnel before switching settings
    stopTunnel();

    // Save the new configuration (resetting detectedMode so auto-detection runs fresh)
    updateConfig({
      serverHost: host,
      serverPort: port,
      tunnelMode,
      detectedMode: null,
      localTunnelPort,
    });

    // Immediately query the server to test & run auto-detection
    const status = await queryServer({
      host,
      port,
      tunnelMode,
      localTunnelPort,
      persistDetection: true,
    });

    const payload = buildStatusMessagePayload(status);

    // Also trigger the live channel & presence update in the background
    runStatusUpdate(interaction.client).catch(() => {});

    const updatedCfg = getConfig();
    const modeSummary =
      tunnelMode === 'auto'
        ? `Auto-Detect → **${updatedCfg.detectedMode ? updatedCfg.detectedMode.toUpperCase() : status.connectionType}**`
        : `**${tunnelMode.toUpperCase()}**`;

    await interaction.editReply({
      content:
        `✅ **Server configuration saved!**\n` +
        `• **Address:** \`${host}:${port}\`\n` +
        `• **Tunnel Mode:** ${modeSummary}\n` +
        `• **Local Bridge Port:** \`127.0.0.1:${localTunnelPort}\``,
      embeds: payload.embeds,
      files: payload.files,
    });
    return;
  }

  if (subcommand === 'channel') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.options.getChannel('target', true);

    // Reset statusMessageId so a new message is posted in the selected channel
    updateConfig({
      statusChannelId: channel.id,
      statusMessageId: null,
    });

    await runStatusUpdate(interaction.client);

    await interaction.editReply({
      content: `✅ Live status channel set to <#${channel.id}>! The status embed has been posted and will automatically update every **2 minutes**.`,
    });
    return;
  }

  if (subcommand === 'info') {
    const cfg = getConfig();
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content:
        `⚙️ **Current Bot Configuration**\n` +
        `• **Server Host:** \`${cfg.serverHost || 'Not set'}\`\n` +
        `• **Server Port:** \`${cfg.serverPort}\`\n` +
        `• **Tunnel Mode:** \`${cfg.tunnelMode}\`\n` +
        `• **Detected Mode:** \`${cfg.detectedMode || 'None'}\`\n` +
        `• **Local Tunnel Bridge:** \`${cfg.localTunnelHost}:${cfg.localTunnelPort}\`\n` +
        `• **Status Channel:** ${cfg.statusChannelId ? `<#${cfg.statusChannelId}>` : '`Not set`'}\n` +
        `• **Tracked Message ID:** \`${cfg.statusMessageId || 'None'}\``,
    });
  }
}
