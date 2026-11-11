# Install guide

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
| Node.js 20 or newer | https://nodejs.org. Check with `node -v`. |
| Git | https://git-scm.com. Or download the repo as a ZIP from GitHub instead. |
| An AI app that supports custom remote MCP connectors | See "Connect your AI app" below. Claude is the one this was built and tested with. |

**Time:** about 10 to 15 minutes. **Cost:** nothing on the free tiers.

**Not for everyone:** do not use this with someone else's login, and do not share your Worker address or passphrase.
This tool talks to MyCamu's undocumented internal API. It is not made or approved by Camu or your college.

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

Use this address as the connector URL: `https://mycamu.<your-subdomain>.workers.dev/mcp`
(with `/mcp` on the end). When the app opens a page asking for a passphrase, enter your `OWNER_PASSPHRASE`.

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
Connectors**. Members then connect it from **Settings > Connectors**. If you are a member and cannot see the
"Add custom connector" button, ask your Owner. Note that a custom connector added by an Owner is visible
to the organization, so consider using a personal Claude account instead for your own college login.

### Claude Code (terminal)

```bash
claude mcp add --transport http mycamu https://mycamu.<your-subdomain>.workers.dev/mcp
```

Then run `/mcp` inside Claude Code and authenticate it. A browser page asks for your passphrase.

### ChatGPT

This has not been tested by the author. ChatGPT supports remote MCP servers as custom connectors (which OpenAI also
calls "apps"), usually behind **Developer mode**, and the plans that offer it and the menu names change
often. Check OpenAI's current help article before you start. The general path is:

1. In ChatGPT, open **Settings > Connectors > Advanced** and turn on **Developer mode** (on Business and
   Enterprise workspaces an admin may need to allow it first).
2. Create a new connector, paste the address ending in `/mcp`, and choose **OAuth** as the authentication.
3. When the passphrase page opens, enter your `OWNER_PASSPHRASE`.

Free ChatGPT plans generally do not offer custom connectors. If it does not work, open an issue and say which plan
and which error you saw.

### Gemini and other apps

Gemini's developer tools (such as the Gemini CLI) and editors like Cursor and VS Code can connect to remote MCP servers.
Use the same address and choose OAuth or "remote HTTP" when asked. The regular Gemini app may not allow custom
connectors. Anything that can add a custom remote MCP server with OAuth should work, but only Claude has been tested.

## Step 6: Try it

Ask your AI app:

- "What's my attendance in each subject? Can I skip tomorrow's class?"
- "What classes do I have this week?"
- "What has been uploaded for <subject name>?"
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
