@AGENTS.md

# Fireworks Model Compare — agent notes

A side-by-side LLM comparison tool. Single Next.js app, one API route, one page. Streaming, metrics, and an LLM-as-judge quality grading.

## Non-obvious decisions worth knowing before you change things

### Why direct `fetch`, not the AI SDK
`app/api/compare/route.ts` calls Fireworks via raw `fetch` with manual SSE parsing. **Do not "simplify" this back to `streamText` from `@ai-sdk/openai`.** That provider drops `delta.reasoning_content` chunks, and *every* model in the Fireworks 2026 chat catalog (MiniMax, Kimi, GLM, DeepSeek) emits reasoning before any visible content. With the SDK, columns appear empty for many seconds.

The streaming protocol is custom SSE with four event types: `reasoning`, `chunk`, `done`, `error`, plus three judge-only events (`judge_start`, `judge`, `judge_error`). The frontend parses these by hand in `app/page.tsx` (`handleRun`).

### Why MiniMax M2.7 is the judge, not DeepSeek
DeepSeek V4 Pro is the most capable reasoning model in the catalog and was the obvious judge choice. **It is too slow for this — 5+ minutes on long inputs.** MiniMax M2.7 produces equivalent-quality JSON judgments in 1–3s. There's also a 60s `AbortController` timeout in `runJudge` as belt-and-suspenders.

If you swap the judge, verify it returns clean JSON when given `response_format: { type: "json_object" }`. Some models ignore the 1–5 scale request and return 1–10 scores; `normalizeJudge` in the route clamps and remaps so the bars don't break.

### Tokens/sec is `outputTokens / totalMs`, not the streaming-window calc
The "industry-standard" formula `outputTokens / (totalMs - ttftMs)` is broken for reasoning models — they generate hundreds of tokens before any visible chunk arrives, so the visible-stream window is tiny and you get nonsense numbers (10k+ tok/s). Honest throughput from request start is what's displayed.

### Reasoning is collapsed by default, answer first
`<details>` element in the result column hides the reasoning behind a `Reasoning (N tok)` summary. The visible answer is rendered above it, even though reasoning streams in *first* during a run. This is intentional UX — when a Run completes, users see the answer prominently and can drill into the model's thinking if they want.

### Base-ui Select doesn't respond to programmatic clicks
The shadcn Select component here uses `@base-ui/react/select` (Tailwind v4 + shadcn 4.x default), which intercepts mouse events differently from Radix. Programmatic `.click()` on a `[role="option"]` element does *not* trigger `onValueChange`. Real users with real mice are fine. If you write end-to-end tests, you'll need a real browser driver, not JSDOM clicks.

## Pricing is hardcoded and stale-able
`lib/models.ts` has prices from <https://fireworks.ai/pricing> as of build date. Verify before each demo. In production this would be fetched.

## Quick run
```bash
cp .env.example .env.local && echo "FIREWORKS_API_KEY=fw_..." > .env.local
npm install && npm run dev
```

## Project layout
- `app/api/compare/route.ts` — streaming + judge, ~270 lines
- `app/page.tsx` — single client component, ~600 lines
- `lib/models.ts` — six-model catalog with pricing/tier
- `lib/presets.ts` — three built-in workload prompts
- `lib/format.ts` — display helpers (ms, $, calls, log-scale slider math)
