---
name: brand-story
description: "Write a Synek story in a Realscript brand's voice: read the brand from the Realscript MCP, build/write the Synek story on-brand. Use when the user runs /synek:brand-story or asks to create a Synek story or timeline in their brand's voice/identity, use their Realscript brand for a story, or make an on-brand story. Requires BOTH the synek MCP and the Realscript `real` plugin MCP connected in this client."
argument-hint: <brand> [+ topic]  (e.g. "Acme" or "the founding story in Acme's voice")
allowed-tools: ["mcp__plugin_real_realscript__list_brands", "mcp__plugin_real_realscript__get_brand_kit", "mcp__plugin_real_realscript__score_content", "mcp__plugin_synek_synek__list_timelines", "mcp__plugin_synek_synek__create_timeline", "mcp__plugin_synek_synek__get_timeline", "mcp__plugin_synek_synek__apply_patch", "mcp__plugin_synek_synek__write_story", "mcp__plugin_synek_synek__set_timeline_theme", "WebSearch"]
---

# /synek:brand-story: a Synek story in $ARGUMENTS' voice

The user wants a Synek story that **sounds and looks like their Realscript brand**. You are the bridge: read the brand from the **Realscript** MCP, write the story into **Synek** via `write_story`, and dress the canvas with the brand's visual identity. Nothing talks server-to-server. *You* (this client, holding both MCPs) are the only connection between the two apps, and that is deliberate.

For the timeline-building craft (op shapes, edge kinds, ref aliasing, the good-timeline bar), read the `building-timelines` and `map` skills and follow them. This skill adds the **brand layer** on top.

## Steps

1. **Confirm BOTH MCPs are live.**
   - Synek: call `list_timelines`. If it errors, run the `setup` flow. The local Synek server is either down or unauthenticated.
   - Realscript: call `list_brands`. If those tools aren't present, the Realscript **`real`** plugin isn't connected. Tell the user to install it and set `REALSCRIPT_API_KEY` (sign in at app.realscript.studio → Workspace Settings → API → generate a key), then retry. Don't fake a brand from memory.

2. **Resolve the brand.** If the user named one, match it against `list_brands` → get its `id`. If ambiguous or unnamed, show the list and ask which. Then call **`get_brand_kit(brandId, format="llm")`**, which returns the brand's `BrandLLMContext`: identity (name, tagline, audience, attributes), guidelines (mission/vision, **brandVoice**, **toneGuidelines**, coreValues, keyMessages, styleGuidelines), the structured **voice** schema (personality traits, do/don't writing rules, tone spectrum, preferred/avoided vocabulary), and visual identity (color palette + primaryColor, fonts, visualAesthetic). This kit is the source of truth. Quote it; don't invent it.

3. **Decide the subject + the timeline.** What story are we telling, and on which Synek timeline? New topic → create the timeline and build a draft graph first (follow `map`/`building-timelines`: periods, entities, events, typed edges, one `apply_patch`, citations). Existing → `get_timeline` and find the moment to anchor the story to.

4. **Apply the brand in two layers:**
   - **Voice → the prose.** Write every beat (`write_story` `bodyText`, the `hook`, narration) in the brand's register. Honor the voice schema literally: lead with the high-intensity personality traits, obey the do/don't writing rules, prefer the brand's vocabulary and avoid its banned words, and pitch tone to the spectrum values. The story should be unmistakably *this* brand. Getting the facts right does not rescue prose that could belong to any company.
   - **Visual → the canvas (optional but high-impact).** Map the brand into a Synek theme and call `set_timeline_theme`: derive the accent slots from the palette (primaryColor → `accentPrimary`), pick the closest `font.display` to the brand's typeface character, and compose `imageStyle` + `mood` from `visualAesthetic` + the palette so the canvas, the story reader, and the public `/s/$slug` page all render on-brand (and any imagery you choose is anchored to it). The tool returns WCAG contrast `warnings` against Synek's canvas. If a brand colour fails, adjust toward the scheme until it clears; surface the warning, don't bury it.
   - **Values/key messages → the throughline.** Let the brand's mission, core values, and key messages shape *what the story is about* and the note it ends on. Diction alone is too shallow a place to put the brand.

5. **Write it.** Call `write_story` on the anchor moment: a `cast` (node-backed where possible), a `coverImage` if you have a real on-brand URL, and beats carrying the brand voice. If you set a theme, do that first so the reader opens already dressed.

6. **Brand-check + report.** Self-audit the draft against the brand's do/don't writing rules and tone spectrum; fix any drift. Then hand back the canvas link (`http://localhost:3001/timelines/<id>`) and the public story link if they want to share it, and say plainly *how* the brand shaped the result (which traits, which palette). Offer the next move: another chapter, a different brand, or, if they also want a Realscript-side brand score, drafting the concept into Realscript (`create_concept_draft`) and running `score_content` there. Keep that bridge optional; it's a separate gesture.

## Quality bar

It must **read** like the brand (specific vocabulary and tone pulled from the kit, not generic AI prose) and, if themed, **look** like the brand (palette applied, contrast clean). The brand kit is the cited source of voice. Never fabricate brand attributes. Holding both MCPs in one client is what makes the companion-app promise real.
