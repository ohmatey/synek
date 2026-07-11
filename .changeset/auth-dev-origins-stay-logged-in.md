---
"synek": minor
---

Auth: fix "Invalid origin" in local dev, and add a "Stay logged in" control.

- **Dev loopback origins** — Better Auth rejected sign-in with `Invalid origin` whenever the
  browser's origin differed from `BETTER_AUTH_URL` (e.g. opening `127.0.0.1` or a different
  dev port like `:3456` while the URL is pinned to `localhost:3001`). In local dev only,
  trusted origins now include any loopback port (`http://localhost:*`, `127.0.0.1`, `[::1]`);
  exposed deploys stay strict at `BASE_URL` via `isExposedDeploy()`.
- **Stay logged in** — the login form gains a "Stay logged in" checkbox (Better Auth
  `rememberMe`): checked persists the session cookie, unchecked makes it a browser-session
  cookie cleared on close. Web sessions are now a **rolling 30-day** window (`expiresIn` 30d /
  `updateAge` 1d) instead of a fixed year. MCP `synek_…` keys are a separate system, unaffected.
