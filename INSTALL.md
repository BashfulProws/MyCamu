# Install guide

> Never used a terminal, Git or Node? Use the [beginner guide](BEGINNERS.md) instead. It is the same setup with every step spelled out.

This guide takes you from nothing to Claude (or another AI app) answering "What's my attendance?" from your own
MyCamu account. Read "Before you start" first. It explains the one idea that makes everything else make sense.

## Before you start

**You run your own copy.** There is no shared MyCamu server. You put a small program (a Cloudflare Worker) on your own free
Cloudflare account, give it your MyCamu login, and connect your AI app to it. This means:

- Your Camu password lives only in **your** Cloudflare account, as an encrypted secret. Nobody else can see it,
  including the author of this repo.
- Nobody else can use your copy. Connecting an app needs a passphrase that only you know.
- You are responsible for your own copy. If MyCamu changes its internals, it may stop working until the code is updated.

**You need:**

| What | Notes |
|---|---|
| A MyCamu student login | The email and password you use on the MyCamu site. Single sign-on logins (for example "Sign in with Google" only) may not work, because the Worker logs in with email and password. |
| A free Cloudflare account | https://dash.cloudflare.com/sign-up. The free plan is enough. |
| Node.js 20 or newer | Step 0 shows how to install it. Check with `node -v`. |
| Git | Step 0 shows how to install it. Optional: you can download the repo as a ZIP instead. |
| An AI app that supports custom remote MCP connectors | See "Connect your AI app" below. Claude is the one this was built and tested with. |

**Time:** about 10 to 15 minutes. **Cost:** nothing on the free tiers.

**Not for everyone:** do not use this with someone else's login, and do not share your Worker address or passphrase.
This tool talks to MyCamu's undocumented internal API. It is not made or approved by Camu or your college.

## Step 0: Install Node.js and Git (skip if you already have them)

You need both programs before anything else. Check first, in a terminal (on Windows, PowerShell):

```bash
node -v
git --version
```

If both print a version number (Node 20 or higher), go to Step 1. If you see "not recognized" or "command not found",
install what is missing.

**Windows 10 or 11.** Easiest is winget, which is built in. Run in PowerShell:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

If `winget` is not available, download and run the installers instead, accepting the defaults:
Node.js (the "LTS" button) from https://nodejs.org and Git from https://git-scm.com/download/win.

**Mac:** install the same two from those websites, or with Homebrew: `brew install node git`.

**Linux:** use your package manager, or the Node.js installer instructions at https://nodejs.org. For example on Ubuntu or Debian: `sudo apt install git` and install Node 20 or newer from https://nodejs.org (the `nodejs` package in many distributions is too old). Check with `node -v`.

**Important: close the terminal and open a new one** after installing. An already-open terminal does not see newly installed
programs, which is the most common reason `node` or `git` is "not recognized" right after installing. Then run
`node -v` and `git --version` again to confirm.

No Git? You can skip it. On the repo page, click **Code > Download ZIP**, unzip it, and open a terminal in the unzipped
`MyCamu-main` folder instead of running `git clone`.

## Step 1: Get the code

```bash
git clone https://github.com/BashfulProws/MyCamu.git
cd MyCamu
npm install
```

## Step 2: Deploy it to your Cloudflare account

```bash
npx wrangler login
npx wrangler deploy
```

- `wrangler login` opens a browser tab. Approve the request for your own Cloudflare account.
- The first deploy may ask you to choose a free `workers.dev` subdomain. Pick anything you like.
- On Windows PowerShell, if you see "running scripts is disabled on this system", use `npx.cmd` instead of `npx`
  for every command in this guide. Nothing needs to be changed in Windows settings.

When it finishes it prints your address:

```
https://mycamu.<your-subdomain>.workers.dev
```

Copy it. You need it in the next step.

## Step 3: Tell the Worker its own public address

This step is the one people forget, and without it, connecting will fail with an "audience does not match" error.

Open `wrangler.jsonc` and change the `MCP_SERVER_URL` line to your address **plus `/mcp`**:

```jsonc
"MCP_SERVER_URL": "https://mycamu.<your-subdomain>.workers.dev/mcp"
```

Do not save the file with the `YOUR-SUBDOMAIN` placeholder still in it.

## Step 4: Add your three secrets

Run each command. It asks you to paste the value, and what you type is not shown.

```bash
npx wrangler secret put CAMU_EMAIL
npx wrangler secret put CAMU_PASSWORD
npx wrangler secret put OWNER_PASSPHRASE
```

- `CAMU_EMAIL` and `CAMU_PASSWORD`: your MyCamu login.
- `OWNER_PASSPHRASE`: **make up** a long random passphrase (a password manager can generate one). You will type it once
  per AI app to approve the connection. Save it in your password manager. It is not your Camu password.

Then deploy again so the new address takes effect:

```bash
npx wrangler deploy
```

**Check it:** open `https://mycamu.<your-subdomain>.workers.dev` in a browser. You should see
"Camu MCP is running. Add /mcp as a connector."

## Step 5: Connect your AI app

Your connector address is `https://mycamu.<your-subdomain>.workers.dev/mcp` (with `/mcp` on the end). When an app opens
a page asking for a passphrase, enter your `OWNER_PASSPHRASE`.

**Will my app work?** It needs to support a **custom remote MCP server** over HTTPS with **OAuth sign-in** and automatic
client registration. This server provides all of that. Apps that only support local servers, or that make you paste a
fixed client ID and secret, will not work. Support in each app changes often, so check the app's own docs if a menu
below does not match.

| App | Status | Where |
|---|---|---|
| Claude (web, desktop, mobile) | Tested | below |
| Claude Code | Same server as Claude, untested here | below |
| ChatGPT | Untested | below |
| Gemini CLI | Untested | below |
| Cursor | Untested | below |
| VS Code (GitHub Copilot) | Untested | below |
| Codex CLI | Untested | below |
| Anything else | Untested | "Any other app" below |

"Untested" means the author has not tried it. The steps come from each app's public documentation. If one does not work,
please open an issue and say which app, which plan and the exact error.

### Claude (claude.ai, Claude Desktop, mobile)

Custom connectors are available on Free, Pro, Max, Team and Enterprise plans. Free accounts are limited to one custom
connector. Official guide:
https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp

1. Open **Settings > Connectors** (the menu is sometimes labelled **Customize > Connectors**).
2. Choose **Add custom connector**.
3. Name it `MyCamu` and paste the address ending in `/mcp`. Leave any advanced OAuth fields empty.
4. Click **Add**, then **Connect**. A page opens asking for your passphrase. Enter it and press Approve.
5. In a new chat, switch the connector on from the tools menu if it is not already on.

**Team or Enterprise plans:** an organization Owner must first add the connector under **Organization settings >
Connectors**. Members then connect it from **Settings > Connectors**. A custom connector added by an Owner is visible to
the organization, so consider a personal Claude account for your own college login.

Once connected on the web, the connector also appears in the mobile app on the same account.

### Claude Code (terminal)

```bash
claude mcp add --transport http mycamu https://mycamu.<your-subdomain>.workers.dev/mcp
```

Then run `/mcp` inside Claude Code and authenticate it. A browser page asks for your passphrase.

### ChatGPT

ChatGPT supports remote MCP servers as custom connectors (OpenAI also calls them "apps"), usually behind **Developer
mode**. The plans that offer it and the menu names change often, and sources disagree on which plans can use write-capable
connectors (this server is read-only). Free plans generally do not offer custom connectors. Check OpenAI's current help
article first. The general path:

1. In ChatGPT, open **Settings > Connectors > Advanced** and turn on **Developer mode** (on Business and Enterprise
   workspaces an admin may need to allow it first).
2. Create a new connector, paste the address ending in `/mcp`, and choose **OAuth** as the authentication.
3. When the passphrase page opens, enter your `OWNER_PASSPHRASE`.

### Gemini CLI

Gemini CLI reads servers from `~/.gemini/settings.json`. Either run:

```bash
gemini mcp add --transport http mycamu https://mycamu.<your-subdomain>.workers.dev/mcp
```

or add this to the settings file yourself:

```json
{
  "mcpServers": {
    "mycamu": { "httpUrl": "https://mycamu.<your-subdomain>.workers.dev/mcp" }
  }
}
```

Then start `gemini`, run `/mcp auth mycamu` and approve with your passphrase in the browser page. `/mcp list` shows whether
it is connected. The regular Gemini app and website may not allow custom connectors. Check Google's current docs.

### Cursor

Add to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "mycamu": { "url": "https://mycamu.<your-subdomain>.workers.dev/mcp" }
  }
}
```

Restart Cursor, open **Settings > MCP**, and click **Connect** or **Authenticate** next to `mycamu`. A browser page asks for
your passphrase.

### VS Code (GitHub Copilot)

Create `.vscode/mcp.json` in a workspace, or run **MCP: Open User Configuration** from the Command Palette for all
workspaces. Note that this file uses `servers`, not `mcpServers`:

```json
{
  "servers": {
    "mycamu": { "type": "http", "url": "https://mycamu.<your-subdomain>.workers.dev/mcp" }
  }
}
```

VS Code shows a **Start** button above the entry. Click it, and a browser window opens for the passphrase. Then use Copilot
Chat in **Agent** mode.

### Codex CLI

```bash
codex mcp add mycamu --url https://mycamu.<your-subdomain>.workers.dev/mcp
codex mcp login mycamu
```

Or add this to `~/.codex/config.toml`:

```toml
[mcp_servers.mycamu]
url = "https://mycamu.<your-subdomain>.workers.dev/mcp"
```

### Any other app

If your app can add a custom remote MCP server, give it:

- **URL:** `https://mycamu.<your-subdomain>.workers.dev/mcp`
- **Transport:** Streamable HTTP ("HTTP", not "SSE" and not "stdio")
- **Authentication:** OAuth, with automatic ("dynamic") client registration. No client ID or secret is needed.

Useful addresses if an app asks for them: authorization server metadata at
`https://mycamu.<your-subdomain>.workers.dev/.well-known/oauth-authorization-server`, and client registration at
`https://mycamu.<your-subdomain>.workers.dev/register`.

If an app cannot do any of this, you can still use the Worker from a script or tool that speaks MCP. See the MCP
documentation at https://modelcontextprotocol.io.

## Step 6: Try it

Ask your AI app:

- "What's my attendance in each subject? Can I skip tomorrow's class?"
- "What classes do I have this week?"
- "What has been uploaded for <subject name>?"
- "Summarize the file called <file title> for <subject>."
- "Give me the link for the file called <file title>."

The first request after you connect can take a few seconds, because the Worker logs in to MyCamu. After that it
reuses the session for about 6 hours.

## Optional: file downloads into your own folders

If your AI app also has a storage connector with a **save from URL** tool, you can say "get the new files for
<subject> and put them in the right folders". See the README section "Saving files to your cloud storage".
Without one, ask for the file link and open it in your browser. The link expires after about 5 minutes.

## Troubleshooting

| What you see | Why, and what to do |
|---|---|
| "running scripts is disabled on this system" | Use `npx.cmd` instead of `npx` (Windows PowerShell). |
| Connecting fails with "Token audience does not match resource server" | `MCP_SERVER_URL` in `wrangler.jsonc` is wrong. It must be exactly your public address ending in `/mcp`, with no trailing slash. Fix it and run `npx wrangler deploy` again, then remove and re-add the connector. |
| The passphrase page says "Wrong passphrase" | Use the value you set for `OWNER_PASSPHRASE`, not your Camu password. After 5 wrong tries from one network you are locked out for 15 minutes. To reset it, run `npx wrangler secret put OWNER_PASSPHRASE` again. |
| "Camu login failed", "Camu login is paused" or "Camu is rate-limiting logins" | The Camu email or password is wrong, or MyCamu rate-limited the login. The Worker waits 5 to 15 minutes before it tries again. **Do not keep retrying**, because repeated failed logins could lock your MyCamu account. Check the email and password on the MyCamu website first, then fix the secret with `npx wrangler secret put CAMU_PASSWORD` and wait. |
| It worked, then stopped working | You may have changed your Camu password (update the secret), or MyCamu changed its internals. Check the repo for an update. |
| "Cannot read ... files as text", or a summary fails on a scanned PDF | `read_file` handles PDF, PowerPoint (.pptx), Word (.docx), Excel (.xlsx), text and HTML. Scanned PDFs, images, videos and old .ppt/.doc/.xls files cannot be read. Download those with `get_file` instead. |
| No subjects or empty timetable | The term may not have started, or classes are not scheduled for that date. Try a different date range. |
| The connector is missing from a chat | Turn it on from the tools or connectors menu of that chat. |

## Updating

```bash
cd MyCamu
git pull
npm install
npx wrangler deploy
```

Your secrets and your address stay as they are. If `git pull` complains about `wrangler.jsonc`, keep your own
`MCP_SERVER_URL` line.

## Removing it

1. Remove the connector in your AI app (Settings > Connectors).
2. Delete the Worker: `npx wrangler delete`.
3. Optionally delete the key-value store named `mycamu-oauth-kv` in the Cloudflare dashboard (Storage & Databases > KV).
4. Change your MyCamu password if you ever shared your Worker address or passphrase with anyone.
