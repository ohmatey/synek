---
name: setup
description: "Check and fix the Synek connection from Claude Code. Use when the user runs /synek:setup, when Synek MCP tools fail with connection or auth errors, or when first wiring this plugin up. Verifies the Synek server (local OR a hosted origin) is reachable and the user is authorized, and walks them through whichever step is broken."
argument-hint: (no arguments)
allowed-tools: ["mcp__plugin_synek_synek__list_timelines", "Bash"]
---

# /synek:setup — verify the Synek connection

The plugin connects Claude Code to a Synek server over HTTP and authenticates with **OAuth** (no token to paste): the first call returns `401`, Claude Code discovers the OAuth endpoints, and the user clicks **Authorize** in the browser once. This skill confirms each link in that chain.

**Two ways to run Synek — same plugin, same OAuth flow:**

- **Local (default).** Synek runs on the user's machine at `http://localhost:3001`. The plugin points there out of the box; nothing to configure.
- **Hosted (power user).** Synek is deployed to a public HTTPS origin (e.g. `https://synek.sector137.io`). The user points the plugin at it by setting **`SYNEK_MCP_URL`** to `https://their-host/api/mcp` before launching Claude Code. Everything else — the 401 → Authorize → token flow — is identical; only the origin changes.

Determine which one applies (is `SYNEK_MCP_URL` set in their environment? are they running a local server?) and diagnose against that origin.

## Steps

1. **Test the live connection.** Call `list_timelines`.
   - **Succeeds** → you're connected and authorized. Report success, show the count of timelines, print the viewer base URL (`http://localhost:3001` locally, or the hosted origin from `SYNEK_MCP_URL` minus the `/api/mcp` suffix), and suggest `/synek:map <topic>`. Done.
   - **Fails** → diagnose below.

2. **Diagnose, in order:**

   a. **Is the server reachable?** Find the origin first. If `SYNEK_MCP_URL` is set, that's the endpoint; otherwise it's the local default `http://localhost:3001/api/mcp`. Probe it:

   Local default:
   ```bash
   curl -sS -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/api/mcp
   ```

   Hosted origin (substitute the real host):
   ```bash
   curl -sS -o /dev/null -w "%{http_code}" -X POST "$SYNEK_MCP_URL"
   ```

   `401` means the server is up and is correctly asking you to authorize → go to 2b. A connection-refused / empty response means: locally, the server isn't running — start it from the Synek repo with `bun run dev`; hosted, the origin is wrong or the deploy is down — check the URL and the deploy's health.

   b. **Authorize (the usual fix).** The plugin uses OAuth, so the user grants access in the browser — there is no key to export:
   - First, make sure you're **logged into the same origin the plugin points at** — `http://localhost:3001` locally, or the hosted URL (sign up / log in — email + password). The OAuth consent uses that session.
   - In Claude Code, run **`/mcp`**, select **synek**, and choose **Authenticate**. A browser opens → approve → done. Tokens refresh automatically after that.
   - If the server was just (re)started, the origin changed, or the plugin reinstalled, run `/mcp` and re-authenticate.

   c. **Point at a hosted Synek (the power-user path).** To connect to a deployed Synek instead of localhost, set `SYNEK_MCP_URL` to its MCP endpoint **before launching Claude Code**, then restart Claude Code so the plugin picks it up:
   ```bash
   export SYNEK_MCP_URL=https://YOUR_HOST/api/mcp
   ```
   The URL is the deploy's public origin plus `/api/mcp` (no trailing slash). After restarting, run `/mcp` → **synek** → **Authenticate** and approve in the browser against that hosted origin. Same one-click flow, just a different origin. (A non-default local port works the same way — `export SYNEK_MCP_URL=http://localhost:4000/api/mcp`.)

   d. **Static-key fallback (optional).** OAuth is the default, but a `synek_…` API key still works: create one in the app's **"Connect an MCP client"** panel (or `bun run issue:key`) and add an `Authorization: Bearer <key>` header to the `synek` server in your `.mcp.json`. Mainly useful for the Claude Desktop (stdio) path.

3. **Re-verify.** After any fix, re-run `/synek:setup` — `list_timelines` should now succeed.

## Notes

- **Local-first by default.** With nothing configured, the plugin talks to your own machine at `http://localhost:3001` — `http://localhost` (not HTTPS) is correct there; it's a loopback to your own box and Claude Code supports OAuth over localhost. The local path is unchanged.
- **Hosted is opt-in, same plugin.** Setting `SYNEK_MCP_URL` to a public `https://…/api/mcp` origin points the *same* plugin at a deployed Synek; the OAuth flow is identical (the browser "Authorize" lands on the hosted origin instead of localhost). This is the connect path for a power user who deploys Synek to the cloud — see the deploy runbook's "Connect a power user's MCP client" section.
