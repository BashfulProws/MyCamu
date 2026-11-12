# Updating MyCamu

You already installed MyCamu and want the newest version. Your own Cloudflare Worker keeps running the version you
deployed until you deploy a newer one, so nothing changes on its own. Updating takes about five minutes.

**You keep everything that matters.** Your MyCamu login, your passphrase, your Worker address and your connector in Claude all
stay as they are. You do not need to enter the secrets again.

## 1. Which version do I have?

Open your Worker address in a browser (for example `https://mycamu.<your-subdomain>.workers.dev`, without `/mcp`).

| It says | Version |
|---|---|
| `MyCamu 0.2.0 is running...` (or a higher number) | Check the number against the [latest release](https://github.com/BashfulProws/MyCamu/releases/latest) |
| `Camu MCP is running...` | 0.1.x, the first version. Update to get the newer features |

See [CHANGELOG.md](CHANGELOG.md) for what changed. The big one in 0.2.0: Claude can now **read and summarize** your files
(PDF, PowerPoint, Word, Excel and more), not just give you a download link.

## 2. Update

Pick the way you originally installed it.

### A. You used Git (`git clone`)

Open a terminal in your `MyCamu` folder and run:

```bash
git pull
npm install
npx wrangler deploy
```

(On Windows PowerShell use `npx.cmd`, or use Command Prompt.)

If `git pull` stops with a message about `wrangler.jsonc`, it is because you edited the `MCP_SERVER_URL` line. Either:

- run `git stash`, then `git pull`, then `git stash pop`, which puts your edit back, or
- run `git pull`, open `wrangler.jsonc`, keep the version of the file that has **your** address on the `MCP_SERVER_URL` line,
  and save.

Then run `npm install` and `npx wrangler deploy`.

### B. You downloaded the ZIP

You cannot update a ZIP in place, so you make a fresh copy and deploy it over the old one. Your old folder is not needed
afterwards.

1. Download the newest ZIP: go to https://github.com/BashfulProws/MyCamu/releases/latest and click **Source code (zip)**
   (or use **Code > Download ZIP** on the main page).
2. Unzip it into a **new folder**. Do not unzip over the old one.
3. Open a terminal in the new folder that contains `package.json`.
   - **Windows:** open the folder in File Explorer, click the address bar, type `cmd` and press Enter.
   - **Mac:** type `cd ` in Terminal, then drag the folder into the window and press Enter.
   - **Linux:** right-click in the folder and choose **Open in Terminal**.
4. Install the parts:

   ```
   npm install
   ```

5. **Put your address back.** Open `wrangler.jsonc` in the new folder and change this line to **your** address, the same one
   you used before, with `/mcp` on the end:

   ```
   "MCP_SERVER_URL": "https://mycamu.<your-subdomain>.workers.dev/mcp"
   ```

   Do not change the `"name": "mycamu"` line. The name is how Cloudflare knows to update your existing Worker instead of
   making a second one. If you forgot your address, it is in the Cloudflare dashboard under **Workers & Pages > mycamu**.
6. Deploy:

   ```
   npx wrangler deploy
   ```

   If it says you are not logged in, run `npx wrangler login` first and approve it in the browser.

## 3. Check it worked

1. Open your Worker address in a browser again. The text should now start with `MyCamu 0.2.0` (or newer).
2. **Start a new chat in Claude.** Claude remembers the list of tools when you connect, so a new tool such as `read_file` may
   not appear in an old chat.
3. If the new tool still does not show up, remove the MyCamu connector in Settings > Connectors, add it again with the same
   address (ending in `/mcp`) and approve with your passphrase.

## If something goes wrong

| What you see | What to do |
|---|---|
| The Claude connector says it needs to reconnect, or asks for your passphrase again | Normal after an update sometimes. Remove the connector, add it again, enter your passphrase. |
| "Token audience does not match resource server" | The `MCP_SERVER_URL` line is wrong or still the placeholder (`your-subdomain`). Fix it (step 5 above) and deploy again. |
| `npx wrangler deploy` says the Worker was created as a new one | You changed the `name` line. Set it back to `mycamu`, deploy again, and delete the extra Worker in the Cloudflare dashboard. |
| Login errors from MyCamu | Not caused by the update. See the troubleshooting table in [INSTALL.md](INSTALL.md). Do not keep retrying failed logins. |
| You want the old version back | Download an older ZIP from https://github.com/BashfulProws/MyCamu/releases (for example `v0.1.0`) and deploy that the same way. |

## Good to know

- **Check for updates from time to time.** MyCamu uses an undocumented MyCamu API, so if MyCamu changes something and your
  copy stops working, a new release here is the likely fix.
- **If you changed the code yourself**, `git pull` may report conflicts in the files you edited. Resolve those like any
  Git merge, or keep your changes in a branch.
- Updating never touches your MyCamu account. The Worker only reads from it.
