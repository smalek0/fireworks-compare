export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions";
const MAX_TOKENS = 4000;
const JUDGE_MODEL = "accounts/fireworks/models/minimax-m2p7";
const JUDGE_TIMEOUT_MS = 60_000;

type Side = "A" | "B";

export async function POST(req: Request) {
  if (!process.env.FIREWORKS_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          "FIREWORKS_API_KEY is not set. Add it to .env.local and restart the dev server.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const { prompt, modelA, modelB } = (await req.json()) as {
    prompt: string;
    modelA: string;
    modelB: string;
  };

  if (!prompt || !modelA || !modelB) {
    return new Response(
      JSON.stringify({ error: "Missing prompt, modelA, or modelB" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)
          );
        } catch {
          // controller may be closed
        }
      };

      const [resA, resB] = await Promise.all([
        runModel("A", modelA, prompt, send),
        runModel("B", modelB, prompt, send),
      ]);

      if (resA && resB && resA.text.trim() && resB.text.trim()) {
        await runJudge(prompt, resA.text, resB.text, send);
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function runModel(
  label: Side,
  modelId: string,
  prompt: string,
  send: (obj: unknown) => void
): Promise<{ text: string } | null> {
  const startMs = Date.now();
  let firstTokenMs: number | null = null;
  let firstReasoningMs: number | null = null;
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const res = await fetch(FIREWORKS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: prompt }],
        max_tokens: MAX_TOKENS,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!res.ok || !res.body) {
      const bodyText = await res.text();
      let message = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(bodyText);
        if (j?.error?.message) message = j.error.message;
      } catch {}
      send({ model: label, type: "error", data: message });
      return null;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const evt = JSON.parse(data);
          const delta = evt?.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            if (firstReasoningMs === null) firstReasoningMs = Date.now();
            send({
              model: label,
              type: "reasoning",
              data: delta.reasoning_content as string,
            });
          }
          if (delta?.content) {
            if (firstTokenMs === null) firstTokenMs = Date.now();
            text += delta.content as string;
            send({
              model: label,
              type: "chunk",
              data: delta.content as string,
            });
          }
          if (evt?.usage) {
            inputTokens = evt.usage.prompt_tokens ?? 0;
            outputTokens = evt.usage.completion_tokens ?? 0;
          }
        } catch {
          // skip malformed line
        }
      }
    }

    const endMs = Date.now();
    const visibleStart = firstTokenMs ?? firstReasoningMs ?? endMs;
    const ttftMs = visibleStart - startMs;
    const totalMs = endMs - startMs;
    const tokensPerSec =
      outputTokens > 0 && totalMs > 0
        ? outputTokens / (totalMs / 1000)
        : 0;

    send({
      model: label,
      type: "done",
      data: {
        ttftMs,
        totalMs,
        tokensPerSec,
        inputTokens,
        outputTokens,
        text,
      },
    });
    return { text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({ model: label, type: "error", data: message });
    return null;
  }
}

const JUDGE_SYSTEM = `You are an expert evaluator comparing two LLM responses to the same prompt. Score each response on three dimensions. Each score is an INTEGER from 1 to 5 inclusive (1=poor, 2=below average, 3=adequate, 4=good, 5=excellent). Do not use any other scale.

Dimensions:
- correctness: factual accuracy and adherence to the prompt's requirements
- conciseness: appropriately brief without losing necessary information
- helpfulness: practical usefulness to the asker

Respond with ONLY valid JSON matching this exact shape:
{
  "scoreA": { "correctness": 1-5, "conciseness": 1-5, "helpfulness": 1-5 },
  "scoreB": { "correctness": 1-5, "conciseness": 1-5, "helpfulness": 1-5 },
  "winner": "A" or "B" or "tie",
  "reasoning": "one sentence comparing the two"
}`;

async function runJudge(
  prompt: string,
  textA: string,
  textB: string,
  send: (obj: unknown) => void
) {
  send({ type: "judge_start" });
  const startMs = Date.now();
  try {
    const userMessage = `PROMPT:\n${prompt}\n\n---\nRESPONSE A:\n${textA}\n\n---\nRESPONSE B:\n${textB}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(FIREWORKS_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: JUDGE_MODEL,
          messages: [
            { role: "system", content: JUDGE_SYSTEM },
            { role: "user", content: userMessage },
          ],
          max_tokens: 4000,
          response_format: { type: "json_object" },
          temperature: 0.0,
        }),
      });
    } catch (err) {
      clearTimeout(timeout);
      const aborted = (err as { name?: string })?.name === "AbortError";
      send({
        type: "judge_error",
        data: aborted
          ? `Judge timed out after ${JUDGE_TIMEOUT_MS / 1000}s`
          : err instanceof Error
            ? err.message
            : String(err),
      });
      return;
    }
    clearTimeout(timeout);

    if (!res.ok) {
      const bodyText = await res.text();
      let message = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(bodyText);
        if (j?.error?.message) message = j.error.message;
      } catch {}
      send({ type: "judge_error", data: message });
      return;
    }

    const body = await res.json();
    const content = body?.choices?.[0]?.message?.content;
    if (!content) {
      send({ type: "judge_error", data: "Judge returned no content" });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) {
        send({ type: "judge_error", data: "Judge returned non-JSON" });
        return;
      }
      parsed = JSON.parse(match[0]);
    }
    const normalized = normalizeJudge(parsed);
    if (!normalized) {
      send({ type: "judge_error", data: "Judge returned malformed JSON" });
      return;
    }
    send({
      type: "judge",
      data: {
        ...normalized,
        elapsedMs: Date.now() - startMs,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({ type: "judge_error", data: message });
  }
}

function normalizeJudge(raw: unknown): {
  scoreA: { correctness: number; conciseness: number; helpfulness: number };
  scoreB: { correctness: number; conciseness: number; helpfulness: number };
  winner: "A" | "B" | "tie";
  reasoning: string;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const scoreA = clampScores(r.scoreA);
  const scoreB = clampScores(r.scoreB);
  if (!scoreA || !scoreB) return null;
  const winnerRaw = String(r.winner ?? "").toUpperCase();
  const winner: "A" | "B" | "tie" =
    winnerRaw === "A" ? "A" : winnerRaw === "B" ? "B" : "tie";
  const reasoning =
    typeof r.reasoning === "string" ? r.reasoning : "No reasoning provided.";
  return { scoreA, scoreB, winner, reasoning };
}

function clampScores(s: unknown):
  | { correctness: number; conciseness: number; helpfulness: number }
  | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  const clamp = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return 0;
    if (n > 5) return Math.round(n / 2);
    return Math.max(1, Math.min(5, Math.round(n)));
  };
  return {
    correctness: clamp(o.correctness),
    conciseness: clamp(o.conciseness),
    helpfulness: clamp(o.helpfulness),
  };
}
