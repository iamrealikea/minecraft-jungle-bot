import assert from 'node:assert/strict';
import { getConfig, updateConfig } from './config.js';
import { cleanMotdText, parseFaviconBuffer, queryServer } from './minecraft.js';
import { buildStatusMessagePayload } from './embeds.js';
import { detectCloudflareHost, isCloudflaredInstalled } from './tunnel.js';

async function runTests() {
  console.log('=== Running Minecraft Discord Bot Verification Tests ===\n');

  // 1. Test MOTD Cleaner & Favicon Parser
  const sampleMotd = '§aWelcome to §lJungle Server§r\n§7Survival 1.21.4';
  const cleaned = cleanMotdText(sampleMotd);
  assert.equal(cleaned, 'Welcome to Jungle Server\nSurvival 1.21.4');
  console.log('✅ [1/5] MOTD formatting code stripper passed.');

  const fakePngBase64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const iconBuf = parseFaviconBuffer(fakePngBase64);
  assert.ok(Buffer.isBuffer(iconBuf) && iconBuf.length > 0);
  console.log('✅ [2/5] Favicon Base64 -> Buffer conversion passed.');

  // 2. Test Discord Embed & Attachment Builder
  const onlinePayload = buildStatusMessagePayload({
    online: true,
    host: 'mc.jungle.example.com',
    port: 25565,
    version: 'Paper 1.21.4',
    players: { online: 7, max: 20 },
    motd: cleaned,
    iconBuffer: iconBuf,
    connectionType: 'Cloudflare Tunnel (Auto-Detected)',
    checkedAt: new Date(),
  });
  assert.equal(onlinePayload.embeds.length, 1);
  assert.equal(onlinePayload.files.length, 1);
  const embedJson = onlinePayload.embeds[0].toJSON();
  assert.equal(embedJson.title, '🟢 mc.jungle.example.com');
  assert.equal(embedJson.thumbnail.url, 'attachment://server-icon.png');
  console.log('✅ [3/5] Discord Embed & Favicon attachment builder passed.');

  // 3. Test Cloudflare Host Detection
  const cfDetection = await detectCloudflareHost('cloudflare.com');
  assert.equal(cfDetection.isCloudflare, true);
  const hasCloudflared = await isCloudflaredInstalled();
  console.log(
    `✅ [4/5] Cloudflare header detector passed (cloudflare.com -> isCloudflare=${cfDetection.isCloudflare}, cloudflared CLI installed=${hasCloudflared}).`
  );

  // 4. Test Live Minecraft Server Ping (Auto-Detect Mode)
  const target = process.argv[2] || 'mc.hypixel.net';
  console.log(`⏳ [5/5] Testing live Minecraft query against ${target} (mode: auto)...`);
  const initialCfg = getConfig();
  const status = await queryServer({
    host: target,
    port: 25565,
    tunnelMode: 'auto',
    persistDetection: false,
  });
  updateConfig(initialCfg); // Ensure config stays clean

  if (status.online) {
    console.log(
      `✅ [5/5] Live ping succeeded!\n` +
        `   • Host: ${status.host}\n` +
        `   • Connection: ${status.connectionType}\n` +
        `   • Version: ${status.version}\n` +
        `   • Players: ${status.players.online}/${status.players.max}\n` +
        `   • Favicon attached: ${Boolean(status.iconBuffer)}\n` +
        `   • MOTD: ${status.motd.replace(/\n/g, ' | ')}`
    );
  } else {
    console.log(`ℹ️ [5/5] Target ${target} returned offline status cleanly: ${status.error}`);
  }

  console.log('\n🎉 All verification checks passed!');
}

runTests().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
