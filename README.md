# MyCamu

Let Claude check your **timetable**, **attendance** and **course files** on MyCamu. You run your own copy
on a free Cloudflare account, with your own login. Nobody else, including the author, ever sees your credentials.

```
Claude (any device) --OAuth--> your Worker (/mcp) --> MyCamu portal + LMS
```

Tools: `get_timetable`, `get_attendance` (with "how many classes can I still miss" maths), `list_subjects`,
`list_course_files`, `get_file`. Everything is read-only. Nothing marks attendance or submits assignments.

**New here? Follow the full [install guide](INSTALL.md)** (Claude, Claude Code, ChatGPT, troubleshooting).

## Read this first

- This uses MyCamu's **undocumented internal API**. It is not affiliated with or endorsed by Camu or your college,
  and it can break without warning.
- Use it **only with your own account**. Never share your Worker, your passphrase or your credentials.
- The Worker logs in to MyCamu as you, from Cloudflare's servers. It caches the session for 6 hours and pauses
  logins for 5 to 15 minutes after a failure, because Camu rate-limits logins.
- Your Camu password is stored as a Cloudflare secret in **your** account. There is no shared server.

## Deploy (about 10 minutes)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and Node.js 20 or newer.

```bash
git clone https://github.com/BashfulProws/MyCamu.git
cd MyCamu
npm install
npx wrangler login
npx wrangler deploy
```

The deploy prints your address, `https://mycamu.<your-subdomain>.workers.dev`.

1. Open `wrangler.jsonc` and set `MCP_SERVER_URL` to `https://mycamu.<your-subdomain>.workers.dev/mcp`.
2. Set three secrets. Each command asks you to paste the value:

```bash
npx wrangler secret put CAMU_EMAIL
npx wrangler secret put CAMU_PASSWORD
npx wrangler secret put OWNER_PASSPHRASE   # a long random passphrase only you know
npx wrangler deploy
```

On Windows PowerShell, if `npx` is blocked by the execution policy, use `npx.cmd` instead.

3. In Claude: Settings > Connectors > Add custom connector, URL `https://mycamu.<your-subdomain>.workers.dev/mcp`.
   A page opens asking for your passphrase. Enter it once to approve.

Then try: "What's my attendance?", "What classes do I have tomorrow?", "What has been uploaded for Pricing?"

## Saving files to your cloud storage (optional)

Everything above works without this. To have Claude file course files into folders for you, add a second
connector for your storage that has a tool to **save a file from a URL** (look for "save from URL" or
"upload from link"). I have not tested any specific product, so check that yours offers it.

Then ask Claude: "Get the new files for Pricing and put them in the right folders." Claude will read your
folder layout, pick a folder for each file, call `get_file` for a temporary download link and pass that link
to your storage connector. The storage service downloads the file itself, so nothing large passes through the
chat, and this Worker keeps no copy of your files.

The link expires after about 5 minutes. With no storage connector, `get_file` still gives you that link, and you
can open it in a browser to download the file yourself.

## Settings

In `wrangler.jsonc`:

| Variable | Meaning |
|---|---|
| `MIN_ATTENDANCE` | Attendance target used for the "can I skip?" maths (default 75) |
| `CAMU_BASE_URL`, `CAMU_LMS_URL` | MyCamu portal and LMS hosts (change only if your college uses different ones) |

Times are Indian Standard Time.

## Local development

```bash
cp .dev.vars.example .dev.vars    # fill in your own values; never commit this file
npx wrangler dev --var MCP_SERVER_URL:http://127.0.0.1:8787/mcp
npm run typecheck
```

## Security notes

- Only someone with your passphrase can approve a connector. Wrong guesses are rate limited per IP.
- Rotate the passphrase with `wrangler secret put OWNER_PASSPHRASE` if you think it leaked. If you change your
  Camu password, update `CAMU_PASSWORD` the same way.
- To remove everything: `npx wrangler delete` and remove the connector in Claude.

## License

MIT. Provided as is, with no warranty. You are responsible for how you use your own account.
