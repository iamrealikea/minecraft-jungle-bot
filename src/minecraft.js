import net from 'node:net';
import dns from 'node:dns/promises';
import { getConfig, updateConfig } from './config.js';
import { detectCloudflareHost, ensureTunnel } from './tunnel.js';

/**
 * Strips legacy Minecraft formatting codes (§a, §l, etc.) and normalizes whitespace.
 */
export function cleanMotdText(motdObj) {
  if (!motdObj) return 'A Minecraft Server';
  let raw = '';
  if (typeof motdObj === 'string') {
    raw = motdObj;
  } else if (typeof motdObj === 'object') {
    if (motdObj.text) raw += motdObj.text;
    if (Array.isArray(motdObj.extra)) {
      raw += motdObj.extra.map((part) => (typeof part === 'string' ? part : part.text || '')).join('');
    }
    if (!raw && motdObj.clean) raw = motdObj.clean;
    if (!raw && motdObj.raw) raw = motdObj.raw;
  }

  const stripped = raw
    .replace(/\u00A7[0-9A-FK-ORa-fk-or]/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  return stripped || 'A Minecraft Server';
}

/**
 * Extracts a PNG Buffer from a base64 data URI (`data:image/png;base64,...`).
 */
export function parseFaviconBuffer(favicon) {
  if (!favicon || typeof favicon !== 'string') return null;
  const match = favicon.match(/^data:image\/png;base64,(.+)$/);
  const base64Data = match ? match[1] : favicon;
  try {
    return Buffer.from(base64Data, 'base64');
  } catch {
    return null;
  }
}

/**
 * Resolves Minecraft SRV records (_minecraft._tcp.<host>) if available.
 */
async function resolveSRV(host, port) {
  if (net.isIP(host) !== 0 || host === 'localhost') {
    return { host, port };
  }
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (records && records.length > 0) {
      records.sort((a, b) => a.priority - b.priority);
      return { host: records[0].name, port: records[0].port };
    }
  } catch {
    // No SRV record found, continue with default
  }
  return { host, port };
}

/**
 * Encodes an integer as a Minecraft VarInt Buffer.
 */
function writeVarInt(value) {
  const bytes = [];
  let v = value;
  do {
    let byte = v & 0x7F;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}

/**
 * Native, resilient Minecraft Java Server List Ping (SLP).
 *
 * Fully supports modern Fabric/Forge/Modded servers that attach extra modpack metadata
 * (e.g. Prominence II / Connectivity mod) without triggering Netty DecoderException
 * (Index 101 out of bounds for length 2).
 */
export function nativePing(host, port, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const cleanup = () => {
      if (!settled) {
        settled = true;
        socket.destroy();
      }
    };

    socket.setTimeout(timeout);
    socket.once('timeout', () => {
      cleanup();
      reject(new Error('Connection timed out'));
    });
    socket.once('error', (err) => {
      cleanup();
      reject(err);
    });

    const startTime = Date.now();
    let buffer = Buffer.alloc(0);

    socket.connect(port, host, () => {
      const hostBuf = Buffer.from(host, 'utf8');

      // Handshake packet (Packet ID 0x00, protocol version 763 = 1.20.1, Next State = 1 Status)
      const handshakeBody = Buffer.concat([
        writeVarInt(0x00),
        writeVarInt(763),
        writeVarInt(hostBuf.length),
        hostBuf,
        Buffer.from([(port >> 8) & 0xFF, port & 0xFF]),
        writeVarInt(0x01),
      ]);
      const handshakePacket = Buffer.concat([writeVarInt(handshakeBody.length), handshakeBody]);

      // Status Request packet (Packet ID 0x00)
      const requestPacket = Buffer.concat([writeVarInt(1), writeVarInt(0x00)]);

      socket.write(Buffer.concat([handshakePacket, requestPacket]));
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      let offset = 0;
      function readVarInt() {
        let result = 0;
        let shift = 0;
        let byte;
        do {
          if (offset >= buffer.length) return null;
          byte = buffer[offset++];
          result |= (byte & 0x7F) << shift;
          shift += 7;
        } while (byte & 0x80);
        return result;
      }

      const pLen = readVarInt();
      if (pLen === null) return;
      const pLenBytes = offset;

      // Wait until the full packet arrives
      if (buffer.length < pLenBytes + pLen) return;

      const pType = readVarInt();
      const strLen = readVarInt();
      const jsonStart = offset;

      if (buffer.length < jsonStart + strLen) return;

      const latency = Date.now() - startTime;
      const jsonStr = buffer.slice(jsonStart, jsonStart + strLen).toString('utf8');

      // Clean disconnect: close socket cleanly without sending redundant packets that trip modded decoders
      cleanup();

      try {
        const response = JSON.parse(jsonStr);
        resolve({
          version: response.version?.name ? response.version.name.replace(/\u00A7[0-9A-FK-ORa-fk-or]/g, '') : 'Unknown',
          protocol: response.version?.protocol ?? null,
          players: {
            online: response.players?.online ?? 0,
            max: response.players?.max ?? 0,
          },
          motd: cleanMotdText(response.description),
          iconBuffer: parseFaviconBuffer(response.favicon),
          latency,
        });
      } catch (err) {
        reject(new Error(`Failed to parse server status JSON: ${err.message}`));
      }
    });
  });
}

/**
 * Pings target host with fallback between IPv6 localhost (::1), IPv4 (127.0.0.1), and SRV resolution.
 */
async function pingTarget(targetHost, targetPort, enableSRV = true, timeout = 5000) {
  let finalHost = targetHost;
  let finalPort = targetPort;

  if (enableSRV) {
    const srv = await resolveSRV(targetHost, targetPort);
    finalHost = srv.host;
    finalPort = srv.port;
  }

  // If localhost, try ::1 first to avoid local temporary rate-limits on 127.0.0.1
  if (finalHost === '127.0.0.1' || finalHost === 'localhost') {
    try {
      return await nativePing('::1', finalPort, Math.min(timeout, 2000));
    } catch {
      // Fallback to 127.0.0.1
      return await nativePing('127.0.0.1', finalPort, timeout);
    }
  }

  return await nativePing(finalHost, finalPort, timeout);
}

/**
 * Queries a Minecraft Java server supporting Direct, Cloudflare Tunnel, or Auto-Detection.
 */
export async function queryServer(options = {}) {
  const cfg = getConfig();
  const host = (options.host ?? cfg.serverHost ?? '').trim();
  const port = Number(options.port ?? cfg.serverPort ?? 25565);
  const tunnelMode = options.tunnelMode ?? cfg.tunnelMode ?? 'auto';
  const localTunnelHost = options.localTunnelHost ?? cfg.localTunnelHost ?? '127.0.0.1';
  const localTunnelPort = Number(options.localTunnelPort ?? cfg.localTunnelPort ?? 25565);
  const persistDetection = options.persistDetection ?? (host === cfg.serverHost);

  if (!host) {
    return {
      online: false,
      host: 'Not Configured',
      port,
      tunnelMode,
      connectionType: 'Unconfigured',
      error: 'No Minecraft server host is configured yet. Use `/setup server` to set one.',
      checkedAt: new Date(),
    };
  }

  const tryCloudflareTunnel = async (labelPrefix = 'Cloudflare Tunnel') => {
    // If the Minecraft server is hosted on the same PC, ping local interface directly
    try {
      const localDirect = await pingTarget('localhost', localTunnelPort, false, 2500);
      return {
        online: true,
        host,
        port,
        tunnelMode,
        resolvedMode: 'cloudflare',
        connectionType: `${labelPrefix} (Local Server Host)`,
        ...localDirect,
        checkedAt: new Date(),
      };
    } catch {
      // Otherwise use the cloudflared TCP bridge
      const tunnel = await ensureTunnel(host, localTunnelHost, localTunnelPort);
      if (!tunnel.active) {
        throw new Error(tunnel.error || 'Could not establish local cloudflared TCP bridge');
      }
      const result = await pingTarget(tunnel.host, tunnel.port, false, 6000);
      const bridgeType = tunnel.mode === 'external' ? 'Local Bridge' : 'Auto-Bridged';
      return {
        online: true,
        host,
        port,
        tunnelMode,
        resolvedMode: 'cloudflare',
        connectionType: `${labelPrefix} (${bridgeType})`,
        ...result,
        checkedAt: new Date(),
      };
    }
  };

  const tryDirect = async (label = 'Direct TCP') => {
    const result = await pingTarget(host, port, true, 5000);
    return {
      online: true,
      host,
      port,
      tunnelMode,
      resolvedMode: 'direct',
      connectionType: label,
      ...result,
      checkedAt: new Date(),
    };
  };

  // 1. Forced Direct Mode
  if (tunnelMode === 'direct') {
    try {
      return await tryDirect('Direct TCP');
    } catch (err) {
      return {
        online: false,
        host,
        port,
        tunnelMode,
        connectionType: 'Direct TCP',
        error: err.message || 'Connection failed',
        checkedAt: new Date(),
      };
    }
  }

  // 2. Forced Cloudflare Tunnel Mode
  if (tunnelMode === 'cloudflare') {
    try {
      return await tryCloudflareTunnel('Cloudflare Tunnel');
    } catch (err) {
      return {
        online: false,
        host,
        port,
        tunnelMode,
        connectionType: 'Cloudflare Tunnel',
        error: err.message || 'Tunnel connection failed',
        checkedAt: new Date(),
      };
    }
  }

  // 3. Auto-Detect Mode ('auto')
  const cachedMode = host === cfg.serverHost ? cfg.detectedMode : null;

  if (cachedMode === 'cloudflare') {
    try {
      return await tryCloudflareTunnel('Cloudflare Tunnel [Auto]');
    } catch {
      try {
        const directRes = await tryDirect('Direct TCP [Auto]');
        if (persistDetection) updateConfig({ detectedMode: 'direct' });
        return directRes;
      } catch (directErr) {
        return {
          online: false,
          host,
          port,
          tunnelMode: 'auto',
          connectionType: 'Cloudflare Tunnel [Auto]',
          error: directErr.message || 'Server unreachable',
          checkedAt: new Date(),
        };
      }
    }
  }

  try {
    const directRes = await tryDirect('Direct TCP [Auto]');
    if (persistDetection && cfg.detectedMode !== 'direct') {
      updateConfig({ detectedMode: 'direct' });
    }
    return directRes;
  } catch (directErr) {
    const cfCheck = await detectCloudflareHost(host);
    try {
      const tunnelRes = await tryCloudflareTunnel('Cloudflare Tunnel [Auto-Detected]');
      if (persistDetection) {
        updateConfig({ detectedMode: 'cloudflare' });
      }
      return tunnelRes;
    } catch (tunnelErr) {
      const reason = cfCheck.isCloudflare
        ? `Cloudflare host detected (${cfCheck.reason}), but tunnel ping failed: ${tunnelErr.message}`
        : `Direct ping failed (${directErr.message}); Cloudflare fallback failed (${tunnelErr.message})`;

      return {
        online: false,
        host,
        port,
        tunnelMode: 'auto',
        connectionType: cfCheck.isCloudflare ? 'Cloudflare Tunnel (Detected)' : 'Auto-Detect',
        error: reason,
        checkedAt: new Date(),
      };
    }
  }
}
