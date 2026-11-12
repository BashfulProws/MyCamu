# Beginner install guide (Windows, Mac and Linux)

This guide assumes you have never used a terminal, Git or Node. Follow it top to bottom, copy and paste the commands
exactly, and you will end up with Claude able to answer "What's my attendance?" from your own MyCamu account.

Time: about 20 to 30 minutes the first time. Cost: nothing.

## What you are actually doing (read this once)

- **MyCamu has no official way for AI apps to read your data.** This project is a small program that logs in to MyCamu
  as you and gives your AI app a few read-only abilities: check attendance, check the timetable, list and fetch files.
- **You put your own copy on your own free Cloudflare account.** Cloudflare is a company that runs small programs on the
  internet for free. Your MyCamu password is stored there, encrypted, in **your** account. Nobody else can see it, and
  nobody else can use your copy.
- **Node.js** is a tool that runs the setup commands. **Terminal** (Windows calls it Command Prompt) is a window where you
  type those commands. You do not need to understand them. You only paste them.
- You do **not** need Git. You will download the project as a ZIP file.

You will need: your MyCamu email and password, an email address for Cloudflare, and a Claude account (or another AI app
that supports custom connectors, see Part 10).

---

## Part 1: Create your free Cloudflare account

1. Go to https://dash.cloudflare.com/sign-up
2. Sign up with your email and a password, then confirm your email when Cloudflare sends you a message.
3. If it asks which plan, choose **Free**. If it asks you to add a website or domain, skip that. You do not need one.

## Part 2: Install Node.js

Node.js is the one program you need to install.

### On Windows

1. Go to https://nodejs.org and click the big green button labelled **LTS**. A file ending in `.msi` downloads.
2. Open the downloaded file, click **Next** through the screens and accept the defaults. If it asks about "tools for native
   modules", you can leave that box unticked.
3. Click **Finish**.

### On Mac

1. Go to https://nodejs.org and click the big green button labelled **LTS**. A file ending in `.pkg` downloads.
2. Open it, click **Continue** through the screens, and **Install** (enter your Mac password if it asks).
3. Click **Close**.

### On Linux

Go to https://nodejs.org and follow its instructions for your system. You need Node **version 20 or newer**. (The `nodejs`
package in some Linux distributions is too old, so check with `node -v` after installing.) Then continue with Part 3.

## Part 3: Download the project

1. Go to https://github.com/BashfulProws/MyCamu
2. Click the green **Code** button, then **Download ZIP**.
3. Unzip it:
   - **Windows:** right-click the ZIP in your Downloads folder and choose **Extract All**, then **Extract**.
   - **Mac:** double-click the ZIP in your Downloads folder.
   - **Linux:** right-click the ZIP and choose **Extract Here**, or run `unzip` on it.
4. You now have a folder named `MyCamu-main`. Open it. You should see files such as `package.json`, `README.md` and a folder
   called `src`. (On Windows, sometimes there is a second `MyCamu-main` folder inside the first. If you do not see
   `package.json`, open the inner one.)

## Part 4: Open a terminal inside that folder

This is the step that confuses most people, so go slowly. The terminal has to be pointed at the folder from Part 3.

### On Windows

1. Open the folder that contains `package.json` in File Explorer.
2. Click once in the **address bar** at the top of the window (where the folder path is shown).
3. Type `cmd` and press **Enter**.

A black window opens. This is Command Prompt, and it is already pointed at the right folder. Keep it open.

> Use **Command Prompt** (`cmd`), not PowerShell. PowerShell often blocks these commands with a red error saying
> "running scripts is disabled on this system". Command Prompt does not have that problem.

### On Mac

1. Press **Cmd + Space**, type `Terminal`, and press **Enter**.
2. In the Terminal window type `cd ` (the letters c, d, then **one space**) but do **not** press Enter yet.
3. Drag the `MyCamu-main` folder from Finder into the Terminal window. Its path is filled in for you.
4. Press **Enter**.

### On Linux

Open your file manager, right-click inside the `MyCamu-main` folder, and choose **Open in Terminal**. (If you do not see
that option, open any terminal and type `cd ` followed by the folder path.)

### Check that it worked

Type this and press **Enter**:

```
node -v
```

You should see a version such as `v22.11.0`. It must be **v20 or higher**. If you see "not recognized" or "command not
found", close the terminal window, open a new one (Part 4 again), and try again. If it still fails, redo Part 2.

Now check you are in the right folder. Type:

- Windows: `dir`
- Mac or Linux: `ls`

You should see `package.json` in the list. If not, you are in the wrong folder. Redo Part 4.

## Part 5: Install the project's parts

In the same terminal window, type this and press **Enter**. It prints a lot of text and takes a minute or two.
Wait until you get the cursor back.

```
npm install
```

(Warnings in yellow are normal. Red lines that say `ERR!` mean something failed. If that happens, check your internet
connection and run the command again.)

## Part 6: Log in to Cloudflare and deploy

1. Type this and press **Enter**:

   ```
   npx wrangler login
   ```

   If it asks "Need to install the following packages... Ok to proceed?", type `y` and press Enter.

2. A browser tab opens. Log in to Cloudflare if asked and click **Allow**. The terminal then says you are logged in.

3. Deploy your copy:

   ```
   npx wrangler deploy
   ```

   - If it asks you to choose a **workers.dev subdomain**, type any name you like (letters and numbers), for example your
     first name plus some digits, and press Enter.
   - If it asks to create something called a KV namespace, say **yes**.

4. At the end it prints a line like this:

   ```
   https://mycamu.somename.workers.dev
   ```

   **Copy that address** (select it with the mouse, then Ctrl+C on Windows or Cmd+C on Mac) and paste it somewhere safe,
   such as Notepad or Notes. You need it in the next part.

## Part 7: Tell your copy its own address

Your copy needs to know its public address. Skipping this causes a connection error later.

1. In the `MyCamu-main` folder, find the file `wrangler.jsonc`.
2. Open it with:
   - **Windows:** right-click > **Open with** > **Notepad**.
   - **Mac:** right-click > **Open With** > **TextEdit**. If TextEdit shows rich text, choose **Format > Make Plain Text** first.
   - **Linux:** open it with any text editor, such as Text Editor, gedit or Kate.
3. Find the line that says:

   ```
   "MCP_SERVER_URL": "https://mycamu.YOUR-SUBDOMAIN.workers.dev/mcp"
   ```

4. Replace the whole address inside the quotes with **your** address from Part 6, and keep `/mcp` on the end. For example:

   ```
   "MCP_SERVER_URL": "https://mycamu.somename.workers.dev/mcp"
   ```

   Keep the quote marks and the comma exactly as they were. Change nothing else.
5. Save the file (Ctrl+S on Windows, Cmd+S on Mac) and close it.

## Part 8: Save your MyCamu login (privately)

Back in the terminal, run these three commands one at a time. Each one asks you to type or paste a value. **What you type
is not shown on screen. That is normal**, so just type or paste it and press **Enter**.

1. Your MyCamu email:

   ```
   npx wrangler secret put CAMU_EMAIL
   ```

2. Your MyCamu password:

   ```
   npx wrangler secret put CAMU_PASSWORD
   ```

3. A **new passphrase that you make up** for approving connections. Make it long, for example four random words joined
   together. This is **not** your Camu password. Save it in your password manager or somewhere safe, because you will
   type it once when you connect your AI app.

   ```
   npx wrangler secret put OWNER_PASSPHRASE
   ```

(To paste in Command Prompt, right-click inside the window. In Mac Terminal, press Cmd+V. In a Linux terminal, press Ctrl+Shift+V.)

Each command should end with a message saying the secret was uploaded successfully.

## Part 9: Deploy once more

```
npx wrangler deploy
```

Now check that it is alive: open your address (for example `https://mycamu.somename.workers.dev`, **without** `/mcp`) in a
browser. You should see the text **"Camu MCP is running. Add /mcp as a connector."**

## Part 10: Connect your AI app

Your connector address is your address **with `/mcp`** on the end, for example
`https://mycamu.somename.workers.dev/mcp`. When an app opens a page asking for a passphrase, type the one you made up
in Part 8 and click **Approve**.

Which app do you use?

### Claude (website, desktop app or phone app) - tested

1. Open Claude (claude.ai in a browser, or the app).
2. Go to **Settings > Connectors** (it may be labelled **Customize > Connectors**).
3. Click **Add custom connector**.
4. Name: `MyCamu`. URL: your address with `/mcp`. Leave any advanced fields empty.
5. Click **Add**, then **Connect**. Enter your passphrase and click **Approve**.
6. Start a new chat and make sure the MyCamu connector is switched on in the tools menu.

Once it works on the website, it also shows up in the phone app on the same account.

> **Team or Enterprise Claude plan?** Only an organization Owner can add custom connectors. If you cannot see the Add
> button, ask your Owner, or use a personal Claude account.

### ChatGPT - untested

ChatGPT lets some paid plans add custom connectors ("apps"), using **Developer mode**. Free plans usually cannot. Go to
**Settings > Connectors > Advanced**, turn on **Developer mode**, create a new connector, paste your address with `/mcp`,
choose **OAuth**, and enter your passphrase when the page opens. Menus and plans change often, so check OpenAI's current
help page if yours looks different.

### Gemini, Cursor, VS Code, Codex and other apps - untested

Some of these are for programmers (they use a terminal or a settings file). The exact steps for each are in
[INSTALL.md, Step 5](INSTALL.md#step-5-connect-your-ai-app). The regular Gemini website and app may not allow custom
connectors. Any app that can add a custom **remote MCP server** with **OAuth** can work, using the same address.

**Not sure if your app works?** Look in its settings for "connectors", "tools", "MCP" or "integrations", and for an option
to add a custom or remote one. If there is none, your app cannot use this.

---

### Try it

Start a new chat with the MyCamu connector switched on, and ask:

- "What's my attendance in each subject? Can I skip tomorrow's class?"
- "What classes do I have this week?"
- "What has been uploaded for Pricing?"

The first answer can take a few seconds because your copy has to log in to MyCamu. After that it is quick.

## If something goes wrong

| What you see | What to do |
|---|---|
| `'node' is not recognized` or `command not found: node` | Close the terminal, open a new one (Part 4), try again. Still failing: reinstall Node (Part 2). |
| `npm install` shows `ERR!` | Check your internet, run it again. Make sure `dir`/`ls` showed `package.json` (Part 4). |
| Red text: "running scripts is disabled on this system" (Windows) | You are in PowerShell. Close it and use Command Prompt (Part 4). |
| "Token audience does not match resource server" when connecting | Part 7 was skipped or has a typo. The address must end in `/mcp`, with no trailing `/`. Fix it, run `npx wrangler deploy` again, then remove and re-add the connector. |
| "Wrong passphrase" | Use the passphrase from Part 8, not your Camu password. Five wrong tries lock you out for 15 minutes. To reset it, run `npx wrangler secret put OWNER_PASSPHRASE` again. |
| "Camu login failed" / "login is paused" / "rate-limiting logins" | Your Camu email or password is wrong, or MyCamu paused logins. **Do not keep retrying**, since too many failed logins can lock your MyCamu account. Check that you can log in on the MyCamu website, fix the secret with `npx wrangler secret put CAMU_PASSWORD`, then wait 15 minutes before trying again. |
| The browser does not open for `wrangler login` | Copy the link the terminal prints and paste it into your browser. |

More help and details: [INSTALL.md](INSTALL.md).

## Removing it later

1. In Claude, remove the connector (Settings > Connectors).
2. In the terminal, in the same folder: `npx wrangler delete`.
3. If you ever shared your address or passphrase with anyone, change your MyCamu password.
