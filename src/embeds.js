import { AttachmentBuilder, EmbedBuilder } from 'discord.js';

const COLOR_ONLINE = 0x57f287; // Discord Green
const COLOR_OFFLINE = 0xed4245; // Discord Red

/**
 * Builds the Discord message payload ({ embeds, files }) from a queryServer() result.
 */
export function buildStatusMessagePayload(status) {
  const displayAddress =
    status.port && status.port !== 25565 ? `${status.host}:${status.port}` : status.host;

  const embed = new EmbedBuilder().setTimestamp(status.checkedAt || new Date());
  const files = [];

  if (status.online) {
    embed
      .setColor(COLOR_ONLINE)
      .setTitle(`🟢 ${displayAddress}`)
      .setDescription(`\`\`\`\n${status.motd || 'A Minecraft Server'}\n\`\`\``)
      .addFields(
        {
          name: 'Status',
          value: 'Online',
          inline: true,
        },
        {
          name: 'Players',
          value: `**${status.players.online}** / **${status.players.max}**`,
          inline: true,
        },
        {
          name: 'Version',
          value: `\`${status.version}\``,
          inline: true,
        },
        {
          name: 'Connection',
          value: status.connectionType || 'Direct TCP',
          inline: true,
        }
      )
      .setFooter({ text: 'Minecraft Server Status • Updates every 2 minutes' });

    if (status.iconBuffer && Buffer.isBuffer(status.iconBuffer)) {
      const attachment = new AttachmentBuilder(status.iconBuffer, { name: 'server-icon.png' });
      files.push(attachment);
      embed.setThumbnail('attachment://server-icon.png');
    }
  } else {
    embed
      .setColor(COLOR_OFFLINE)
      .setTitle(`🔴 ${displayAddress}`)
      .setDescription('**Server is currently offline or unreachable.**')
      .addFields(
        {
          name: 'Status',
          value: 'Offline',
          inline: true,
        },
        {
          name: 'Connection Mode',
          value: status.connectionType || status.tunnelMode || 'Auto-Detect',
          inline: true,
        }
      )
      .setFooter({ text: 'Minecraft Server Status • Updates every 2 minutes' });

    if (status.error) {
      embed.addFields({
        name: 'Details',
        value: `\`${status.error.slice(0, 500)}\``,
        inline: false,
      });
    }
  }

  return { embeds: [embed], files };
}
