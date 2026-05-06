@AGENTS.md

# Fireworks Model Compare

A side-by-side LLM comparison demo. Two models stream the same prompt in parallel; the UI shows TTFT, throughput, cost/call, and a third "judge" model grades both responses on correctness/conciseness/helpfulness. Built as a take-home for Fireworks AI to demonstrate that an AE could hand it to a prospect on a call.

Live: <https://fireworks-compare.vercel.app> · Repo: <https://github.com/smalek0/fireworks-compare>

## What

- **Stack:** Next.js 16 App Router, TypeScript, Tailwind v4, shadcn/ui (on `@base-ui/react` primitives, not Radix). One server-rendered page, one streaming API route.
- **Layout:**
  - `app/page.tsx` — single client component (~600 lines): two-column UI, streaming consumer, slider, verdict, judge panel
  - `app/api/compare/route.ts` — streaming SSE route (~270 lines): two parallel model calls + one judge call
  - `lib/models.ts` — six-model catalog with hardcoded pricing
  - `lib/presets.ts` — three workload prompts (support, code, RAG)
  - `lib/format.ts` — display helpers (ms, $, log-scale slider math)
  - `components/ui/*` — shadcn primitives, untouched after init

## Why

Fireworks-vs-Fireworks (not Fireworks-vs-OpenAI) is intentional: a prospect comparing Fireworks to OpenAI is already in the funnel; the harder downstream decision is *which Fireworks model to deploy*. That's the workflow the tool serves.

The LLM-as-judge layer exists because cost-only verdicts mislead. In practice the cost-recommended model and the quality-recommended model disagree on roughly half the prompts I tested — that disagreement is the actionable signal.

## How

```bash
npm install
cp .env.example .env.local && echo "FIREWORKS_API_KEY=fw_..." >> .env.local
npm run dev          # http://localhost:3000
npx tsc --noEmit     # type check
```

Deploy via `npx vercel --prod`. Env var `FIREWORKS_API_KEY` is set in the Vercel project, not the repo.

## Non-obvious decisions — read before changing these

These are the four things a future contributor (human or agent) will otherwise rediscover the hard way.

### 1. Direct `fetch` to Fireworks, not `streamText` from `@ai-sdk/openai`
The AI SDK's OpenAI provider drops `delta.reasoning_content` chunks. **Every** model in the Fireworks 2026 chat catalog reasons before producing visible text, so with the SDK columns appear empty for many seconds. The route uses `fetch` + manual SSE parsing to capture both `content` and `reasoning_content` deltas.

The custom SSE protocol has these event types: `chunk`, `reasoning`, `done`, `error`, `judge_start`, `judge`, `judge_error`. The frontend in `handleRun` parses these by hand. **If you change event names, change both ends.**

### 2. MiniMax M2.7 is the judge — not DeepSeek V4 Pro
DeepSeek is the most capable reasoning model and was the obvious choice. It is also too slow as a judge — 5+ minutes on long inputs. MiniMax produces equivalent JSON judgments in 1–3s.

If you swap the judge: confirm the model honours `response_format: { type: "json_object" }` and produces 1–5 integer scores. Some models return 1–10 scales despite the prompt; `normalizeJudge` clamps and remaps so the bars don't break. There's also a 60s `AbortController` timeout in `runJudge` as a safety net.

### 3. Tokens/sec is `outputTokens / totalMs`, not the streaming-window formula
The standard `outputTokens / (totalMs - ttftMs)` calculation is broken for reasoning models — they generate hundreds of tokens before any visible chunk arrives, so the visible-stream window is tiny and you get nonsense numbers (10k+ tok/s). The current formula reflects honest end-to-end throughput.

### 4. Reasoning is collapsed by default; answer renders first
Reasoning streams in *first* but is rendered *below* the answer (and inside `<details>` so it's collapsed by default). Users see the answer prominently and can drill into the model's thinking if they want. Don't reorder this — it's why the result columns feel useable.

## Gotcha to know about

The shadcn Select uses `@base-ui/react/select`, which intercepts mouse events differently from Radix. **Programmatic `.click()` on a `[role="option"]` element does not trigger `onValueChange`.** Real users with real mice are fine. End-to-end tests need a real browser driver, not JSDOM clicks.

## Pricing data is stale-able

`lib/models.ts` has prices from <https://fireworks.ai/pricing> as of build date. Verify before each demo. In production this would be fetched from a pricing endpoint.

## Out of scope (don't add)

These were considered and intentionally excluded — usually because they're "what I'd do with more time" items, not "what's missing":
- Authentication, saved comparisons, multi-turn conversations, charts/graphs, dark mode, mobile-optimized layout
- Comparing against non-Fireworks models — the tool's positioning depends on the Fireworks-only frame
- Running the judge over N prompts to aggregate a win-rate — useful, but the demo runs one prompt at a time

If you're tempted to add one of these, check the README's "What I'd do with more time" section first — most are noted there with rationale.

---

Sources for CLAUDE.md structure: [HumanLayer — Writing a good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md) (WHAT/WHY/HOW frame, keep it short), [Claude Code best practices](https://code.claude.com/docs/en/best-practices).
