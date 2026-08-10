# Synek

**Type an idea to Claude. Watch its history draw itself.**

Synek is a living timeline you build *by talking to Claude*. Ask about something — the Stoics, the space race, the rise of deep learning — and Claude fills a visual canvas with the people, events, and eras involved, laid out along time and connected by how they influenced each other. It's a calm, permanent place for the things you're learning and researching.

Synek runs **entirely on your own computer**. Your timelines live in a single file on your machine — no cloud, no account in someone else's database, and nothing leaves your machine unless you explicitly turn it on. Synek has no AI of its own; the intelligence comes from **your** Claude (Claude Code or Claude Desktop), which you connect in a couple of clicks.

> *Synek — from the Greek* synecheia*, "continuity."*

---

## What you'll need

- **A computer** (macOS, Linux, or Windows) where you can open a terminal.
- **[Bun](https://bun.sh)** — the tool that runs Synek. Install it with one command from [bun.sh](https://bun.sh) (e.g. `curl -fsSL https://bun.sh/install | bash` on macOS/Linux).
- **Claude** — either [Claude Code](https://www.claude.com/product/claude-code) or the [Claude Desktop](https://claude.ai/download) app. This is what actually builds your timelines.

You do **not** need an AI API key, an OpenAI key, or anything to sign up for. Synek uses the Claude you already have.

---

## Get it running (about 5 minutes)

Open a terminal in this folder and run these three commands:

**1. Install Synek's pieces**
```bash
bun install
```

**2. Set everything up in one step**
```bash
bun run setup
```
This prepares your private database, fills it with a starter **Stoicism** timeline so your canvas isn't empty, creates your personal access key, and prints the exact settings to connect Claude. **Copy the key it shows you — you'll see it only once.**

**3. Start Synek**
```bash
bun run dev
```
Now open **http://localhost:3001** in your browser. You'll see your canvas with the Stoicism timeline already on it. 🎉

(Prefer one command? `bun run setup --start` does steps 2 and 3 together.)

---

## Connect Claude

Synek is the canvas; Claude is how you draw on it. Pick whichever you use:

### Claude Code

Install the **Synek plugin** (it connects Claude Code to your canvas and teaches it how to build good timelines):

```
/plugin marketplace add ohmatey/synek
/plugin install synek@synek
```

Then connect with **one click — no key to copy:**

1. Make sure you're logged into `http://localhost:3001` (you set up your account above).
2. Run `/mcp` → select **synek** → **Authenticate**. A browser opens; approve it.
3. Now just type:

```
/synek:map the history of jazz
```

…and watch the canvas fill in. If anything seems off, run `/synek:setup` and it'll tell you exactly what to fix.

### Claude Desktop

`bun run setup` also printed a small settings block for Claude Desktop. Open Claude Desktop's config file (**Settings → Developer → Edit Config**), paste that block in, and restart Claude Desktop. Then just ask Claude in plain language:

> *"Map the history of the space race onto my Synek timeline."*

---

## Make your first timeline

However you connected Claude, the magic is the same: **talk about a topic**, and Synek builds it.

- *"Map the Stoic philosophers and how they influenced each other."*
- *"Add the major space missions of the 1960s to a new timeline."*
- *"Put the key moments in the history of vaccines on a timeline, with sources."*

Claude creates the people, events, and eras; positions everything by date; draws the connections; and hands you a link to open the canvas. Every change is one tidy step you can undo.

---

## Your data is yours

- Everything lives in a single file on your computer (`local.db` by default).
- There's a simple local login (email + password) so only you can manage your timelines and keys — but it's all on **your** machine.
- **Nothing is sent anywhere by default.** Optional analytics (PostHog) and an optional self-hoster heartbeat are both **off unless you set keys/flags** for them. The heartbeat — when you opt in with `SYNEK_TELEMETRY=1` — sends a single anonymous ping per startup (a hashed install id, the app version, and which database you use), and **never** any timeline content. See `.env.example`.
- Want a clean slate? Delete `local.db` and run `bun run setup` again.

---

## If something's not working

| Symptom | Fix |
|---|---|
| Claude says it can't reach Synek | Make sure `bun run dev` is running (you should be able to open http://localhost:3001). |
| "Unauthorized" / key errors | Your key is set in the wrong place or missing. In Claude Code, run `/synek:setup`. Or open http://localhost:3001, sign in, and create a fresh key in the **Connect an MCP client** panel. |
| The canvas is blank | Run `bun run setup` again — it re-adds the starter Stoicism timeline. |
| Lost your key | Keys are shown only once. Just create a new one in the **Connect an MCP client** panel and revoke the old one. |

---

## Handy commands

```bash
bun run setup        # one-step setup: database + starter timeline + access key + connection settings
bun run dev          # start Synek at http://localhost:3001
bun run issue:key    # create a new access key from the terminal
bun run db:seed      # add more example timelines
```

---

## For developers

Curious about the internals — the architecture, the MCP server, the data model, the "one edit = one undoable Patch" mechanic? See **[CLAUDE.md](CLAUDE.md)** for the full technical overview, and **[synek-plugin/](synek-plugin/)** for the Claude Code plugin.

## License

[MIT](./LICENSE) © 2026 Aaron McPherson

<!-- loha-m3-verify: 2026-07-29T04:14:36Z -->
<!-- loha-m3-verify-2: 2026-07-29T04:21:33Z -->
