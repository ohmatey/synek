# Synek

**Type an idea. Watch an AI draw its history.** Synek turns a chat prompt into a living timeline — a visual mesh of events, people, and eras you can explore and grow.

It's **yours to self-host**: runs on your machine, stores everything in one local SQLite file, and uses your own AI API key. No cloud, no accounts, no telemetry. This guide gets you running in about five minutes.

> *Synek — a play on the Greek* synecheia*, "continuity."*

## How it works

1. Type a prompt (e.g. *"map the history of the space race"*).
2. The AI calls tools that write **nodes** (events, entities, periods) and **edges** to SQLite.
3. The canvas refetches and renders them along the timeline, positioned by date.
4. Every turn is one atomic, undoable change — `⌘Z` / `⌘⇧Z` walk the history.

## Run it yourself

You'll need [Bun](https://bun.sh) installed and an [OpenRouter](https://openrouter.ai/keys) API key (it's your key — you pay per use, Synek never proxies it).

```bash
# 1. Install dependencies
bun install

# 2. Configure your key
cp .env.example .env
# then edit .env and set OPENROUTER_API_KEY=...

# 3. (optional) seed example timelines
bun run db:seed

# 4. Run the dev server → http://localhost:3001
bun run dev
```

Chat works with just an OpenRouter key. Image generation ("enrich/visualize") additionally needs an `OPENAI_API_KEY` — `gpt-image-1` isn't served by OpenRouter.

## Configuration

Copy `.env.example` to `.env` and fill in:

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Default model gateway. **Required** to chat. |
| `SYNEK_MODEL` | OpenRouter model slug (default `anthropic/claude-sonnet-4-6`). |
| `SYNEK_STORY_MODEL` | Optional model for story generation; falls back to `SYNEK_MODEL`. |
| `OPENAI_API_KEY` | OpenAI key, **image generation only**. Chat works without it. |
| `SYNEK_IMAGE_MODEL` | OpenAI image model (default `gpt-image-1`). |
| `DATABASE_URL` | Local SQLite file (default `local.db`). |

## Commands

```bash
bun run dev          # dev server on http://localhost:3001 ($PORT overrides)
bun run build        # production build
bun run typecheck    # tsc --noEmit
bun run db:generate  # generate a migration from the schema
bun run db:migrate   # apply migrations (also applied on server start)
bun run db:seed      # seed example timelines (or one: bun run db:seed space-race)
bun run test:e2e     # Playwright e2e (first run: bunx playwright install chromium)
```

## Tech stack

| Concern | Choice |
|---|---|
| Framework | TanStack Start (SSR + server functions + file routing) + TanStack Query |
| UI / runtime | React 19, Bun, Vite |
| Canvas | React Flow (`@xyflow/react` v12) — client-only |
| AI | Vercel AI SDK v6, via `@ai-sdk/openai` pointed at OpenRouter |
| DB | SQLite via Drizzle (`better-sqlite3`) |
| Validation | Zod v4 |

## License

[MIT](./LICENSE) © 2026 Aaron McPherson
