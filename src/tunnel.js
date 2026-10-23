import { spawn, execFile } from 'node:child_process';
import net from 'node:net';
import { ENV } from './config.js';

let activeProcess = null;
let activeTunnelKey = null;

/**
 * Checks whether a TCP port is currently accepting connections on the given host.
 */
export function isPortListening(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    socket.connect(port, host);
  });
}

/**
 * Checks if `cloudflared` CLI is installed and accessible.
 */
export function isCloudflaredInstalled() {
  return new Promise((resolve) => {
    execFile(ENV.CLOUDFLARED_PATH, ['--version'], { timeout: 3000 }, (err) => {
      resolve(!err);
    });
  });
}

/**
 * Probes the hostname over HTTPS/HTTP to detect if it sits behind Cloudflare proxy/Tunnel.
 */
export async function detectCloudflareHost(hostname) {
  if (!hostname || hostname === 'localhost' || net.isIP(hostname) !== 0) {
    return { isCloudflare: false, reason: 'IP or localhost' };
  }

  for (const protocol of ['https', 'http']) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(`${protocol}://${hostname}`, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
      });
      clearTimeout(timer);

      const serverHeader = (response.headers.get('server') || '').toLowerCase();
      const cfRay = response.headers.get('cf-ray');
      const cfAccess = response.headers.get('cf-access-domain') || response.headers.get('location') || '';

      if (cfRay || serverHeader.includes('cloudflare') || cfAccess.includes('cloudflareaccess')) {
        return {
          isCloudflare: true,
          reason: `Detected Cloudflare edge headers (${cfRay ? `cf-ray: ${cfRay}` : 'server: cloudflare'})`,
        };
      }
    } catch {
      clearTimeout(timer);
    }
  }

  return { isCloudflare: false, reason: 'No Cloudflare HTTP headers detected' };
}

/**
 * Stops the bot-managed cloudflared process if one is running.
 */
export function stopTunnel() {
  if (activeProcess) {
    console.log(`[Tunnel] Stopping managed cloudflared tunnel (${activeTunnelKey})...`);
    try {
      activeProcess.kill();
    } catch {
      // Ignore kill errors
    }
    activeProcess = null;
    activeTunnelKey = null;
  }
}

/**
 * Ensures a local `cloudflared access tcp` bridge is running for the target hostname.
 * Can either reuse an already-listening local bridge (manual) or spawn one automatically.
 */
export async function ensureTunnel(hostname, localHost = '127.0.0.1', localPort = 25565) {
  const desiredKey = `${hostname}->${localHost}:${localPort}`;

  // 1. If we already manage this exact tunnel and the port is listening, reuse it
  if (activeProcess && activeTunnelKey === desiredKey) {
    const listening = await isPortListening(localHost, localPort, 800);
    if (listening) {
      return {
        active: true,
        mode: 'managed',
        host: localHost,
        port: localPort,
      };
    }
    // Process died or stopped listening, clean up and restart
    stopTunnel();
  }

  // 2. If we were managing a different tunnel, stop it first
  if (activeProcess && activeTunnelKey !== desiredKey) {
    stopTunnel();
  }

  // 3. Check if an external process (e.g. manual cloudflared access tcp) is already listening on localHost:localPort
  const alreadyListening = await isPortListening(localHost, localPort, 800);
  if (alreadyListening) {
    return {
      active: true,
      mode: 'external',
      host: localHost,
      port: localPort,
    };
  }

  // 4. Verify cloudflared CLI is available before spawning
  const installed = await isCloudflaredInstalled();
  if (!installed) {
    return {
      active: false,
      mode: 'none',
      host: localHost,
      port: localPort,
      error: `cloudflared CLI not found in PATH (tried "${ENV.CLOUDFLARED_PATH}") and no bridge listening on ${localHost}:${localPort}`,
    };
  }

  // 5. Spawn `cloudflared access tcp --hostname <hostname> --url <localHost>:<localPort>`
  const urlArg = `${localHost}:${localPort}`;
  console.log(`[Tunnel] Starting cloudflared bridge: ${ENV.CLOUDFLARED_PATH} access tcp --hostname ${hostname} --url ${urlArg}`);

  let stderrLog = '';
  const child = spawn(
    ENV.CLOUDFLARED_PATH,
    ['access', 'tcp', '--hostname', hostname, '--url', urlArg],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );

  activeProcess = child;
  activeTunnelKey = desiredKey;

  child.stderr.on('data', (chunk) => {
    stderrLog += chunk.toString();
    if (stderrLog.length > 1000) {
      stderrLog = stderrLog.slice(-1000);
    }
  });

  child.on('exit', (code) => {
    if (activeProcess === child) {
      console.warn(`[Tunnel] cloudflared process (${desiredKey}) exited with code ${code}`);
      activeProcess = null;
      activeTunnelKey = null;
    }
  });

  child.on('error', (err) => {
    console.error(`[Tunnel] Failed to spawn cloudflared:`, err.message);
  });

  // 6. Poll up to 5 seconds until the local port accepts TCP connections
  const maxAttempts = 20;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (!activeProcess) {
      break;
    }
    const listening = await isPortListening(localHost, localPort, 500);
    if (listening) {
      console.log(`[Tunnel] Bridge ready on ${localHost}:${localPort} for ${hostname}`);
      return {
        active: true,
        mode: 'managed',
        host: localHost,
        port: localPort,
      };
    }
  }

  // If it failed to listen in time, clean up
  stopTunnel();
  return {
    active: false,
    mode: 'none',
    host: localHost,
    port: localPort,
    error: stderrLog.trim() || `Timed out waiting for cloudflared bridge on ${localHost}:${localPort}`,
  };
}
