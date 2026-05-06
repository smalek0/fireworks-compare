# Fireworks Model Compare

A side-by-side performance and cost comparison tool for Fireworks-hosted LLMs. Built so an account exec could hand it to a prospect and let them poke at real models with their own prompts before deciding which to deploy.

## What it is

- Pick any two Fireworks models and run the same prompt through both in parallel.
- Watch tokens stream in live. See real TTFT, total latency, tokens/sec, and per-call cost.
- Drag a slider to project monthly cost at your expected call volume.
- Get a verdict comparing the two: a cost/speed recommendation, **plus** an LLM-as-judge quality grading from MiniMax M2.7 (correctness, conciseness, helpfulness on a 1–5 scale per response). The two often disagree — that disagreement is the most useful signal.

## Demo

Run locally — see below. (Screenshot/Loom would go here in a polished submission.)

## Run locally

```bash
cp .env.example .env.local
# edit .env.local and add your FIREWORKS_API_KEY
npm install
npm run dev
```

Open <http://localhost:3000>. Pick two models, paste a prompt (or hit a preset), click **Run**.

If `FIREWORKS_API_KEY` is missing, the app surfaces a clear error in the UI rather than failing silently.

## How it works

- **`/api/compare` route** — receives `{ prompt, modelA, modelB }`, fires two parallel streaming requests to Fireworks' OpenAI-compatible chat-completions endpoint (`https://api.fireworks.ai/inference/v1/chat/completions`).
- **Server-Sent Events** — interleaves chunks from both streams onto one response. Each event tags `model: "A" | "B"` so the client can route it to the right column. Three event types per model: `reasoning` (deltas from `delta.reasoning_content`), `chunk` (deltas from `delta.content`), and `done` (final metrics).
- **Per-stream metrics** — TTFT measured at the first visible chunk, total latency at stream end, tokens/sec computed as `outputTokens / totalMs` (overall throughput, honest for reasoning models). Usage comes from the final SSE event's `usage` block.
- **Cost calculation** — `(inputTokens × inputCostPer1M + outputTokens × outputCostPer1M) / 1_000_000`. Monthly projection scales the slider value (logarithmic, 1k → 10M calls/mo) by the per-call cost.
- **Why direct fetch instead of `streamText`** — the AI SDK's OpenAI provider doesn't surface `reasoning_content` chunks, which the entire Fireworks 2026 catalog emits. A bare `fetch` + manual SSE parse keeps both streams visible.
- **LLM-as-judge** — once both streams complete, the route fires a third (non-streaming) call to MiniMax M2.7 with the prompt + both responses, asking for structured JSON scores (correctness, conciseness, helpfulness, 1–5) plus a winner and one-line reasoning. Scores are clamped server-side in case the judge ignores the scale, then rendered as a small comparative bar chart in the verdict card.

## Design decisions

- **Fireworks vs. Fireworks, not Fireworks vs. OpenAI.** A prospect comparing Fireworks to OpenAI already has a buying decision they're working through — this tool helps the next decision: *which Fireworks model do I actually deploy?* That's where the real workflow value is.
- **Preset prompts.** Three workloads (support, code, RAG) cover the common shapes a prospect would care about, and they prevent the demo from breaking down into "I don't know what to type." A custom textarea is right there if they want it.
- **Verdict caveat is not optional.** Any model-vs-model recommendation based on one prompt is misleading; the caveat is part of the product. The tool is positioned as "hands-on intuition," not "decision oracle."
- **No charts.** A 2x2 metric grid is enough information density for the comparison and avoids the bulk of a charting library.

## What I'd do with more time

- Run the judge over N representative prompts (not one) and aggregate to a win-rate. Single-prompt LLM-as-judge is signal, not proof.
- Let the user pick the judge model (and warn when judge == one of the two compared models, since self-bias is real).
- Save/share comparison links (URL-encode the prompt + model pair so an AE can send a frozen comparison).
- Dedicated GPU pricing tier in the cost projection — at ~5M+ calls/mo serverless stops being optimal and the answer flips.
- Pull static benchmark scores (Artificial Analysis Intelligence Index, MMLU, GPQA Diamond) per model as additional context badges.
- Streaming-aware tokens/sec graph — show throughput stability across the response, not just the average.

## Models and pricing

The full Fireworks 2026 chat catalog (six models) is included: MiniMax M2.7, Kimi K2.5, Kimi K2.6, GLM 5, GLM 5.1, DeepSeek V4 Pro. **All six are reasoning models** — they emit `reasoning_content` before producing visible output. The UI shows a collapsed "Reasoning (N tok)" section above each response so you can expand and inspect the model's thinking, and `max_tokens` is set to 4000 to give reasoning models headroom.

Per-token prices in `lib/models.ts` are hardcoded from <https://fireworks.ai/pricing> as of May 2026. They should be verified before using this for real customer conversations and would be fetched from a pricing API in production.

## Stack

- Next.js 16 App Router, TypeScript, Tailwind v4
- shadcn/ui on base-ui primitives (Card, Select, Slider, Textarea, Button, Badge)
- Direct `fetch` to the Fireworks OpenAI-compatible streaming endpoint — manual SSE parsing to capture both `content` and `reasoning_content` deltas, since the Vercel AI SDK's OpenAI provider currently drops `reasoning_content`.
