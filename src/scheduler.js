import { ActivityType } from 'discord.js';
import { getConfig, updateConfig } from './config.js';
import { queryServer } from './minecraft.js';
import { buildStatusMessagePayload } from './embeds.js';

const UPDATE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
let intervalHandle = null;
let isUpdating = false;

/**
 * Queries the configured Minecraft server, updates bot presence,
 * and updates (or creates) the live status message in the configured channel.
 */
export async function runStatusUpdate(client) {
  if (isUpdating || !client?.isReady()) return null;
  isUpdating = true;

  try {
    const cfg = getConfig();

    if (!cfg.serverHost) {
      client.user.setPresence({
        activities: [{ name: 'Use /setup server', type: ActivityType.Playing }],
        status: 'idle',
      });
      return null;
    }

    const status = await queryServer();

    // 1. Update Bot Presence
    if (status.online) {
      client.user.setPresence({
        activities: [
          {
            name: `${status.host}: ${status.players.online}/${status.players.max} online`,
            type: ActivityType.Playing,
          },
        ],
        status: 'online',
      });
    } else {
      client.user.setPresence({
        activities: [
          {
            name: `${status.host} (Offline)`,
            type: ActivityType.Playing,
          },
        ],
        status: 'dnd',
      });
    }

    // 2. Update Live Status Channel Message (if configured)
    if (cfg.statusChannelId) {
      try {
        const channel = await client.channels.fetch(cfg.statusChannelId);
        if (channel && channel.isTextBased()) {
          const payload = buildStatusMessagePayload(status);
          let updatedExisting = false;

          if (cfg.statusMessageId) {
            try {
              const existingMsg = await channel.messages.fetch(cfg.statusMessageId);
              if (existingMsg) {
                await existingMsg.edit({
                  embeds: payload.embeds,
                  files: payload.files,
                  attachments: [],
                });
                updatedExisting = true;
              }
            } catch {
              // Message was likely deleted; we will send a fresh one below
            }
          }

          if (!updatedExisting) {
            const newMsg = await channel.send(payload);
            updateConfig({ statusMessageId: newMsg.id });
          }
        }
      } catch (channelErr) {
        console.error('[Scheduler] Failed to update status channel message:', channelErr.message);
      }
    }

    return status;
  } catch (err) {
    console.error('[Scheduler] Error during status update:', err.message);
    return null;
  } finally {
    isUpdating = false;
  }
}

/**
 * Starts the 2-minute recurring scheduler loop.
 */
export function startScheduler(client) {
  if (intervalHandle) {
    clearInterval(intervalHandle);
  }

  console.log('[Scheduler] Starting 2-minute server status polling loop...');
  runStatusUpdate(client);

  intervalHandle = setInterval(() => {
    runStatusUpdate(client);
  }, UPDATE_INTERVAL_MS);
}

/**
 * Stops the recurring scheduler loop.
 */
export function stopScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
