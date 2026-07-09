---
project: "Synek"
owner: Wren (design)
date: 2026-07-08
status: Active — pre-launch risk review of the public, no-auth sharing surfaces
scope: "/s/$slug reader (Flow A) + open signup / auth surfaces (Flow B)"
build: production build (`bun run build` + `serve-build`, port 3008, seeded preview.db)
links: [../design-principles.md, ../design-doc.md, ../../product/product-strategy.md]
---

# Public sharing surfaces — pre-launch review

## Framing

This was not a polish pass. It's a risk check on the exact surface Synek's growth bet depends on: **B3/B6 — the sharable story is the acquisition loop, and every shared link carries the full first impression to a stranger who has no context** (Principle 6). That means two things have to both be true before this ships wide: the reader has to *convert*, and the no-auth surface behind it has to not be a soft target. Right now, one of those is shaky and the other has a confirmed hole.

I read this against `design-principles.md` and `design-doc.md` (both current as of 2026-06-24) and Nielsen's heuristics where they sharpen the point. Severities use the standard scale: **Critical** (blocks the task / exposes the system) → **High** (significant friction or real risk) → **Medium** (noticeable, workaroundable) → **Low** (polish).

---

## Friction map

**Flow A — public story reader** (land → play → 6 beats → end panel → CTA → auth)

| Step | Effort | Emotional read | Notes |
|---|---|---|---|
| Land on `/s/from-shipwreck-to-throne` | low | inviting — cover, cast, clear Play | clean |
| Play → beats 1–5 | low | absorbed | globe/timeline widgets, narration all clean |
| Beat 6 (bleed layout) | low, but **legibility strain** | slightly uneasy | text over unscrimmed image — see Finding 4 |
| End panel ("THE END") | low | satisfied, one clear next step | best screen in the flow |
| Click "Make your own with Synek" | low click, **high confusion** | **the flow breaks here** | resolves to a "Sign in" wall, not an invitation |
| Auth screen | low | **mismatched** — "Welcome back" to someone who's never been here | see Finding 5 |

**Flow B — open signup** (weak-password reject → success → duplicate handling → reset)

| Step | Effort | Emotional read | Notes |
|---|---|---|---|
| Weak password reject | low | fine — clear copy | form-level not field-level (Finding 6) |
| Successful signup | very low | fast, frictionless | **too** frictionless — full write access pre-verification (Finding 2) |
| 5× rapid duplicate POST | n/a (scripted) | — | **zero throttle observed** (Finding 1) |
| Password reset, real vs. fake email | low | trustworthy — identical response | genuinely good; no client-facing enumeration |

The story reader is close to right. The seam between "convinced" and "converted" — the CTA and the auth wall behind it — is where the acquisition loop actually leaks. And behind the login form, the surface that will absorb every stranger this loop attracts has a confirmed, unthrottled write path.

---

## Findings, ranked by severity

### 1 — CRITICAL: Signup has no effective rate limit (confirmed)

**What happened:** 5 rapid, identical POSTs to `/api/auth/sign-up/email` all completed with clean 422 responses — no 429, no rate-limit headers, at any point. A server log line confirms *why*, not just observes the symptom: `WARN [Better Auth]: Rate limiting skipped: could not determine client IP address.` Rate limiting is configured but is a silent no-op because this deploy path doesn't resolve/forward a trusted client IP.

**Why this matters now, not later:** this surface is about to be the terminus of a growth loop designed to pull in strangers at volume (Principle 6, B3/B6). An unthrottled signup endpoint behind a public discovery-free share link is exactly the kind of gap that gets found by a script within days of the first viral story, not months.

**Heuristic:** Nielsen #5, Error Prevention — the system should stop abuse before it happens, not just handle individual bad inputs gracefully (which it does well elsewhere — see the strong enumeration/duplicate-handling results below).

**Recommendation:** this is Kael's fix, not mine, but I'm gating on it — configure `advanced.ipAddress.ipAddressHeaders` for whatever's in front of the app (reverse proxy `X-Forwarded-For`, or platform-specific header), then re-run this exact 5x-POST check and confirm a 429 shows up. Don't treat "the config option exists" as done; the evidence says it's currently inert. This is a launch blocker, not a fast-follow.

---

### 2 — CRITICAL: Full write access is granted before email verification (confirmed behavior, intent unconfirmed)

**What happened:** immediately after signup, the account lands in the fully authenticated workspace — create stories, timelines, everything — while a toast says "check your email to verify your address." Verification is *communicated* as expected but not *enforced* as a gate.

**Why this matters:** paired with Finding 1, this is the whole abuse chain: unthrottled signup → disposable, unverified email → immediate full write access to a multi-tenant system. On a product whose acquisition strategy is "share a link to a stranger," this is the account-creation path that stranger uses, and right now it's wide open to scripted abuse (spam content, resource exhaustion, disposable-account farming) with no verification checkpoint in between.

**Heuristic:** Nielsen #5, Error Prevention, plus a trust-signal gap — the UI *tells* the user verification matters ("check your email") without the system backing that claim up.

**Recommendation:** confirm with Kael/founder whether immediate access is deliberate (reduce friction to first "aha") or an oversight. If deliberate, I'd still push back — friction-reduction and abuse-prevention aren't actually in tension here: you can keep zero-friction *reading and exploring the product* while gating *write actions that persist content publicly* (or apply a tight rate/volume cap) until verification completes. That's the seat-model-friendly version of this fix. If it's an oversight, it's the same severity as Finding 1 and should ship in the same pass.

---

### 3 — HIGH (unconfirmed, flagging for verification): citation/image URLs render into `href`/`src` — attribute-position injection not ruled out

**What was checked:** a static grep of `src/components/public/` and `StoryReader.tsx` found zero `dangerouslySetInnerHTML`/`__html` — body text is safe, it renders through auto-escaped React text nodes. **What was not checked:** whether citation URLs and image URLs (which flow into `<a href>` / `<img src>`) are scheme-validated anywhere on the write path (`apply_patch`, `write_story`) or the render path.

**Why this matters:** these values originate from MCP client input — any connected MCP client can write a citation URL or an image URL onto a node or beat. If neither the write path nor the render path constrains the scheme (e.g. rejects `javascript:`, `data:`, or other non-`http(s)` schemes), this is a stored-XSS vector distinct from the body-text case that was ruled out — and the blast radius is every visitor who opens a public story, no auth required. Notably, the codebase already has prior form for exactly this class of bug: `[[strata-ssrf-egress-guard]]` fixed a server-side SSRF vector in `warnings.ts`'s URL-fetch verifier. That guard covers *server-side fetch*, not *client-side attribute rendering* — a different vector on the same class of untrusted input.

**Heuristic:** Nielsen #5, Error Prevention (input validation gap, not yet confirmed present or absent).

**Recommendation:** before wide sharing rollout, have Kael confirm (a) URL scheme allowlisting at write time in `apply_patch`/`write_story` handlers, and (b) that any `href`/`src` binding in `PublicStoryReader` and its widgets doesn't trust raw stored strings without a scheme check. This is flagged, not confirmed broken — but "unconfirmed on a no-auth surface with untrusted multi-client input" is not a place to leave a gap before a launch that's specifically designed to maximize the number of strangers who load this page.

---

### 4 — HIGH: the growth CTA dead-ends into a page that doesn't look like an invitation

**What happened:** the end panel's promise — *"Want to build one like it? Make your own with Synek"* — resolves to `/`, which for a signed-out visitor shows only "Your stories" / "Sign in to see your stories, series and timelines." / a single "Sign in" button. No "Create account" affordance is visible on that first screen; the visitor has to click through to a second, tabbed screen to discover signup even exists.

**Why this matters:** this is Principle 6's own test, applied literally: *"would this story page convince someone who's never heard of Synek to make their own?"* Right now the answer, at the exact moment of highest intent (they just finished the story, they clicked the CTA), is a screen that reads as gatekeeping — "sign in" implies an account already exists. For a stranger with zero context, that's a bounce point, not a conversion point. This is also the terminal step of B3/B6, the core growth bet — the funnel's last screen is currently optimized for returning users, not new ones.

**Recommendation:** the CTA shouldn't land on the generic `/` workspace shell at all. Land it on (or default the tab to) **Create account**, with copy that acknowledges where they came from — something like "Continue from [story title]" or at minimum surfacing both Sign in *and* Create account with equal visual weight on the very first screen, not two clicks deep. This is a small change with outsized leverage: it's the one screen every successful share eventually funnels through.

---

### 5 — HIGH: Beat 6's bleed layout has no scrim — contradicts the documented pattern

**What happened:** beat 6 uses the `bleed` image layout (one of the four documented layouts: full/inset-left/inset-right/bleed). A faint, washed-out manuscript background sits directly behind body text and the timeline widget, and — per the evidence — there's no visible scrim between them. Legibility read as marginal in the screenshot.

**Why this matters — and why this is a doc violation, not just a taste call:** `design-doc.md` §3 documents a specific, named pattern for exactly this situation: *"Text-over-image legibility uses a bottom gradient scrim, reused from `psr-cover` in `PublicStoryReader`"* — with the dark/light gradient values spelled out. That pattern exists precisely so a `bleed`/cover-image beat doesn't put readers in this position. If beat 6 is rendering without it, either the `bleed` layout isn't wired to the scrim treatment, or this specific beat's asset is dark/busy enough that the standard scrim isn't sufficient — either way, it's drift from a recorded convention, not a new situation nobody thought about.

Compounding factor: this is beat 6 of 6 — the **last** beat before the end panel and the CTA that Finding 4 is about. A legibility stumble right before the conversion moment is the worst possible placement for it.

**Recommendation:** confirm live (contrast-check, not just screenshot judgment) whether the `bleed` layout is applying the documented scrim gradient at all. If it is and this asset still reads poorly, the scrim's opacity/stop values may need a per-layout variant for `bleed` specifically (it covers more of the frame than `inset-left/right`). I'm not updating `design-doc.md` for this — the doc's pattern is correct; the shipped beat is the thing that's wrong.

---

### 6 — MEDIUM: "Welcome back" greets a very likely first-time visitor

**What happened:** the auth screen's default (Sign in) tab reads "Welcome back" / "Sign in to your timelines and API keys." For anyone arriving via a shared story link — which, per Principle 6, is the primary acquisition path — this is almost certainly their first encounter with Synek, not a return visit.

**Heuristic:** Nielsen #2, match between system and the real world — the copy assumes a user model (returning user) that doesn't match the actual traffic source for this screen.

**Recommendation:** if Finding 4's fix (defaulting the CTA to Create account) lands, this mostly resolves itself for the share-driven path. Independently, "timelines and API keys" as the value prop on the sign-in tab is itself calibrated for an existing power user, not someone who just watched a 6-beat illustrated story — worth a copy pass once the CTA routing is fixed, so the words match whichever tab a first-time visitor actually lands on.

---

### 7 — MEDIUM: password error is form-level, not field-level

**What happened:** submitting a too-short password produces a form-level alert below the form; no field-level indicator (e.g. red border) on the password input itself was observed.

**Heuristic:** Nielsen #9, help users recognize, diagnose, and recover from errors — the error is present and clearly worded, but doesn't point at *where*, which matters more as a form grows past one field.

**Recommendation:** low-cost fix — add `aria-invalid` + a red-border state on the offending field alongside the existing alert. Not blocking; note for the next auth-surface pass.

---

### 8 — LOW: beat 1 image reads as low-contrast / near-placeholder

The "Bust of Zeno of Citium" image loaded correctly (512×403, confirmed non-broken) but read as flat/grayish enough in the screenshot to be mistaken for an empty box at a glance. This is a perceptual call, not a confirmed defect — needs a live contrast/vibrancy check, not a screenshot judgment. Flagging for a follow-up visual pass rather than ranking it higher on unconfirmed evidence.

### 9 — LOW: server logs differentiate real vs. fake email on password reset (client is clean)

The client response is correctly identical for both cases — no enumeration leak to an attacker. But the server log emits `Reset Password: User not found` only for the fake address, i.e. the distinction exists at the log layer. Not a live vulnerability; flagging only so log-shipping/observability tooling (if logs ever land somewhere less trusted than the app server itself) doesn't quietly reintroduce the leak one layer up.

### 10 — LOW / unconfirmed: Name field may not expose a standard `type="text"`

The signup harness couldn't fill the Name field via a generic `input[type="text"]` selector. This is noted as a tooling limitation, not a confirmed app bug — but if the field genuinely lacks a standard type/role, it's a small but real hit against Principle 12 (*"accessible by construction… as built, not after a remediation pass"*). Recommend a quick manual check rather than acting on this as-is.

---

## What's already right (worth naming, not just the gaps)

- **Password-reset enumeration protection is done correctly** — identical client response for real vs. fake email, at exactly the layer that matters (the network response, not just the UI). This is the kind of thing that's easy to get wrong and wasn't.
- **Duplicate-signup error copy is clear and specific** (`USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`), not a generic 500 or vague message — good error-recovery UX (Nielsen #9) done right.
- **The beat-to-beat reader experience (beats 1–5), the globe/timeline widget rendering, and the end panel are clean** — zero console errors, zero failed requests, one obvious primary CTA at the moment it matters most (before Finding 4's routing problem). The end panel itself is the strongest screen in the flow — it's the two steps after it that need work.
- **Body-text rendering is confirmed safe from stored HTML injection** — no `dangerouslySetInnerHTML` in the render path for story/beat text.

---

## Coverage gaps (explicit, not assumed clean)

- **Mobile (390×844) untested this pass**, for either flow — material given Principle 6 explicitly calls the public reader "mobile-first," and the design doc's own breakpoint table treats mobile as the primary reels-style target. This needs its own walkthrough before calling the surface launch-ready.
- **Email verification link flow not exercised** (no `RESEND_API_KEY` in this preview env) — Finding 2's severity is partly contingent on what a verified vs. unverified account can/can't do, which wasn't observable this pass.
- **No live injection attempt** against story/beat text, citation URLs, or image URLs through the real `write_story`/`apply_patch` path — Finding 3 is a static-analysis-driven flag, not a proof-of-exploit either way.
- **Signup abuse testing was 5 requests from one session**, not sustained/distributed load; CAPTCHA/honeypot presence wasn't specifically probed beyond "none observed in the UI."
- **Share button's actual clipboard/native-share behavior** not exercised, only its presence confirmed.

---

## Priority order for the next pass

1. Rate limiting (Finding 1) + verification gating (Finding 2) — same investigation, likely same fix window, and this is the one that turns "pre-launch risk check" into "go/no-go." Kael's lane.
2. Confirm the URL-scheme injection question (Finding 3) — cheap to check, expensive to leave open on a no-auth surface. Kael's lane.
3. Fix the CTA routing (Finding 4) and the beat-6 scrim (Finding 5) — both mine, both sit directly on the conversion path the whole sharing bet depends on.
4. Mobile walkthrough of both flows — the coverage gap that matters most given Principle 6's "mobile-first" claim is currently unverified.

---

## Change Log

| Date | Change |
|---|---|
| 2026-07-08 | Initial review (Wren) — pre-launch risk check of `/s/$slug` public reader + open signup/auth surfaces, production build. 10 findings (2 Critical, 3 High, 2 Medium, 3 Low/unconfirmed); Finding 5 flagged as a shipped-reality drift against `design-doc.md` §3's scrim pattern. |
