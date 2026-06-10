---
name: setup
description: "Check and fix the Synek connection from Claude Code. Use when the user runs /synek:setup, when Synek MCP tools fail with connection or auth errors, or when first wiring this plugin up. Verifies the local server is reachable and the user is authorized, and walks them through whichever step is broken."
argument-hint: (no arguments)
allowed-tools: ["mcp__plugin_synek_synek__list_timelines", "Bash"]
---

# /synek:setup — verify the Synek connection

The plugin connects Claude Code to the user's **local** Synek server over HTTP and authenticates with **OAuth** (no token to paste): the first call returns `401`, Claude Code discovers the OAuth endpoints, and the user clicks **Authorize** in the browser once. This skill confirms each link in that chain.

## Steps

1. **Test the live connection.** Call `list_timelines`.
   - **Succeeds** → you're connected and authorized. Report success, show the count of timelines, print the viewer base URL (`http://localhost:3001` by default), and suggest `/synek:map <topic>`. Done.
   - **Fails** → diagnose below.

2. **Diagnose, in order:**

   a. **Is the local server running?** The plugin talks to `http://localhost:3001/api/mcp`:
   ```bash
   curl -sS -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/api/mcp
   ```
   `401` means the server is up (and is correctly asking you to authorize → go to 2b). A connection-refused / empty response means it isn't running — start it from the Synek repo:
   ```bash
   bun run dev
   ```

   b. **Authorize (the usual fix).** The plugin uses OAuth, so the user grants access in the browser — there is no key to export:
   - First, make sure you're **logged into** `http://localhost:3001` (sign up / log in — local email + password). The OAuth consent uses that session.
   - In Claude Code, run **`/mcp`**, select **synek**, and choose **Authenticate**. A browser opens → approve → done. Tokens refresh automatically after that.
   - If the server was just (re)started or the plugin reinstalled, run `/mcp` and re-authenticate.

   c. **Non-default host/port?** If Synek runs on a different port (e.g. `PORT=4000`), point the plugin at it and restart Claude Code:
   ```bash
   export SYNEK_MCP_URL=http://localhost:4000/api/mcp
   ```

   d. **Static-key fallback (optional).** OAuth is the default, but a `synek_…` API key still works: create one in the app's **"Connect an MCP client"** panel (or `bun run issue:key`) and add an `Authorization: Bearer <key>` header to the `synek` server in your `.mcp.json`. Mainly useful for the Claude Desktop (stdio) path.

3. **Re-verify.** After any fix, re-run `/synek:setup` — `list_timelines` should now succeed.

## Notes

- **Local-first:** one local server, your own account, OAuth on the loopback. There's a login (local email/password) but no cloud endpoint and no hosted/team setup — don't suggest any.
- `http://localhost` (not HTTPS) is correct here — it's a loopback connection to the user's own machine, and Claude Code supports OAuth over localhost.
