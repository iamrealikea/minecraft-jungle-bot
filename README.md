# Minecraft Jungle Discord Bot

A Discord bot built with Node.js (ES Modules) and `discord.js` v14 that monitors a Minecraft Java Edition server—supporting both **Direct TCP** and **Cloudflare Tunnel (`cloudflared access tcp`)** with automatic detection.

## Features
- **Hybrid Status Display**:
  - **Slash Command (`/status`)**: On-demand server check (for the configured server or any custom address).
  - **Live Status Channel**: Auto-updates a message in a dedicated Discord channel every **2 minutes**.
  - **Bot Presence**: Shows live player counts (`Playing mc.domain.com: 4/20 online`).
- **Cloudflare Tunnel Support (Auto-Detect & Explicit Mode)**:
  - **Auto-Detect (`auto`)**: Attempts a direct Minecraft ping first. If unreachable or behind Cloudflare edge headers, automatically bridges via `cloudflared access tcp` (or reuses an already-running local bridge) and caches the working connection mode.
  - **Forced Cloudflare Tunnel (`cloudflare`)**: Always connects through the local `cloudflared access tcp` bridge.
  - **Forced Direct (`direct`)**: Standard direct TCP ping.
- **Rich Discord Embeds**:
  - Server MOTD (formatted cleanly), Minecraft version, online/max player count, connection badge, and the server's custom favicon rendered natively as an attachment thumbnail.
- **In-Discord Setup (`/setup`)**:
  - Configure the server address, tunnel mode, and status channel directly in Discord without restarting the bot.

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure `.env`
Copy `.env.example` to `.env` and fill in your Discord bot credentials from the [Discord Developer Portal](https://discord.com/developers/applications):
```bash
cp .env.example .env
```
```env
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_application_client_id_here
GUILD_ID=optional_guild_id_for_instant_command_updates
```

> **Bot Invite Permissions**: When inviting the bot to your Discord server via OAuth2 URL Generator, select scopes **`bot`** and **`applications.commands`**, and grant permissions: **`View Channels`**, **`Send Messages`**, **`Embed Links`**, and **`Attach Files`**.

### 3. Cloudflare Tunnel Requirement (If your server uses Cloudflare Tunnel)
If your Minecraft server is hosted on a different network behind a Cloudflare Tunnel:
1. Ensure [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) is installed on the machine running this bot (`cloudflared --version`).
2. You can either:
   - **Let the bot manage the bridge automatically** (default—the bot spawns `cloudflared access tcp --hostname <your-domain> --url 127.0.0.1:25565` when needed), **OR**
   - **Run the bridge yourself** in another terminal (`cloudflared access tcp --hostname <your-domain> --url 127.0.0.1:25565`), and the bot will automatically detect and reuse your listening port.

### 4. Start the Bot
```bash
npm start
```
*(Slash commands are automatically registered on startup, or you can run `npm run deploy-commands` manually).*

---

## Slash Commands

| Command | Description |
| :--- | :--- |
| `/setup server host:<domain> [tunnel:auto\|cloudflare\|direct] [port:25565] [local_port:25565]` | Sets the Minecraft server to monitor, runs connection & tunnel detection immediately, and saves to `config.json`. |
| `/setup channel target:<#channel>` | Sets the text channel where the live status embed will be posted and updated every 2 minutes. |
| `/setup info` | Displays the current configuration and detected tunnel mode. |
| `/status [host] [port] [tunnel]` | Checks the status of the configured server (or any custom server on the fly). |

---

## Testing
Run the built-in verification and live ping test suite:
```bash
npm run test:ping
```
