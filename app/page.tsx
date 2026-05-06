"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MODELS, callCost, findModel, type Model } from "@/lib/models";
import { PRESETS } from "@/lib/presets";
import {
  formatCalls,
  formatMoneyShort,
  formatMs,
  formatTokensPerSec,
  formatUSD,
  sliderToCalls,
} from "@/lib/format";

type Side = "A" | "B";

type JudgeScores = {
  correctness: number;
  conciseness: number;
  helpfulness: number;
};

type JudgeResult = {
  scoreA: JudgeScores;
  scoreB: JudgeScores;
  winner: "A" | "B" | "tie";
  reasoning: string;
  elapsedMs: number;
};

type JudgeState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: JudgeResult }
  | { status: "error"; message: string };

type ModelState = {
  text: string;
  reasoning: string;
  ttftMs?: number;
  totalMs?: number;
  tokensPerSec?: number;
  inputTokens?: number;
  outputTokens?: number;
  done: boolean;
  error?: string;
};

const emptyModelState = (): ModelState => ({
  text: "",
  reasoning: "",
  done: false,
});

type RunState = "idle" | "streaming" | "complete";

export default function Page() {
  const [prompt, setPrompt] = useState(PRESETS[0].prompt);
  const [modelAId, setModelAId] = useState(MODELS[0].id);
  const [modelBId, setModelBId] = useState(MODELS[1].id);
  const [a, setA] = useState<ModelState>(emptyModelState());
  const [b, setB] = useState<ModelState>(emptyModelState());
  const [judge, setJudge] = useState<JudgeState>({ status: "idle" });
  const [runState, setRunState] = useState<RunState>("idle");
  const [topError, setTopError] = useState<string | null>(null);
  const [sliderVal, setSliderVal] = useState<number>(50);

  const modelA = findModel(modelAId)!;
  const modelB = findModel(modelBId)!;
  const monthlyCalls = sliderToCalls(sliderVal);

  const aCallCost = useMemo(() => {
    if (a.inputTokens == null || a.outputTokens == null) return undefined;
    return callCost(a.inputTokens, a.outputTokens, modelA);
  }, [a.inputTokens, a.outputTokens, modelA]);

  const bCallCost = useMemo(() => {
    if (b.inputTokens == null || b.outputTokens == null) return undefined;
    return callCost(b.inputTokens, b.outputTokens, modelB);
  }, [b.inputTokens, b.outputTokens, modelB]);

  const aMonthly =
    aCallCost !== undefined ? aCallCost * monthlyCalls : undefined;
  const bMonthly =
    bCallCost !== undefined ? bCallCost * monthlyCalls : undefined;

  const handleRun = async () => {
    if (!prompt.trim()) return;
    if (modelAId === modelBId) {
      setTopError("Pick two different models to compare.");
      return;
    }
    setTopError(null);
    setA(emptyModelState());
    setB(emptyModelState());
    setJudge({ status: "idle" });
    setRunState("streaming");

    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, modelA: modelAId, modelB: modelBId }),
      });

      if (!res.ok || !res.body) {
        let msg = `Request failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {}
        setTopError(msg);
        setRunState("idle");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(part.slice(6));
            dispatch(evt);
          } catch {}
        }
      }
      setRunState("complete");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTopError(message);
      setRunState("idle");
    }
  };

  const dispatch = (evt: {
    model?: Side;
    type:
      | "chunk"
      | "reasoning"
      | "done"
      | "error"
      | "judge_start"
      | "judge"
      | "judge_error";
    data?: unknown;
  }) => {
    if (evt.type === "judge_start") {
      setJudge({ status: "running" });
      return;
    }
    if (evt.type === "judge") {
      setJudge({ status: "done", result: evt.data as JudgeResult });
      return;
    }
    if (evt.type === "judge_error") {
      setJudge({ status: "error", message: evt.data as string });
      return;
    }
    if (!evt.model) return;
    const setter = evt.model === "A" ? setA : setB;
    if (evt.type === "chunk") {
      setter((prev) => ({ ...prev, text: prev.text + (evt.data as string) }));
    } else if (evt.type === "reasoning") {
      setter((prev) => ({
        ...prev,
        reasoning: prev.reasoning + (evt.data as string),
      }));
    } else if (evt.type === "done") {
      const d = evt.data as {
        ttftMs: number;
        totalMs: number;
        tokensPerSec: number;
        inputTokens: number;
        outputTokens: number;
        text: string;
      };
      setter((prev) => ({
        ...prev,
        ttftMs: d.ttftMs,
        totalMs: d.totalMs,
        tokensPerSec: d.tokensPerSec,
        inputTokens: d.inputTokens,
        outputTokens: d.outputTokens,
        done: true,
      }));
    } else if (evt.type === "error") {
      setter((prev) => ({
        ...prev,
        error: evt.data as string,
        done: true,
      }));
    }
  };

  const bothDone = a.done && b.done;
  const verdictData =
    bothDone &&
    !a.error &&
    !b.error &&
    aCallCost !== undefined &&
    bCallCost !== undefined
      ? buildVerdict(
          { model: modelA, ttftMs: a.ttftMs!, callCost: aCallCost },
          { model: modelB, ttftMs: b.ttftMs!, callCost: bCallCost },
          monthlyCalls
        )
      : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8 md:py-12 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
            Fireworks Model Compare
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Pick two models. See real performance side-by-side.
          </p>
        </header>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setPrompt(p.prompt)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="Enter a prompt to send to both models..."
              className="font-sans text-sm"
            />
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <ModelPicker
                label="Model A"
                value={modelAId}
                onChange={setModelAId}
              />
              <ModelPicker
                label="Model B"
                value={modelBId}
                onChange={setModelBId}
              />
              <Button
                onClick={handleRun}
                disabled={runState === "streaming" || !prompt.trim()}
                size="lg"
              >
                {runState === "streaming" ? "Running..." : "Run"}
              </Button>
            </div>
            {topError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {topError}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ResultColumn
            label="A"
            model={modelA}
            state={a}
            runState={runState}
            callCost={aCallCost}
          />
          <ResultColumn
            label="B"
            model={modelB}
            state={b}
            runState={runState}
            callCost={bCallCost}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost projection</CardTitle>
            <CardDescription>
              Estimate cost at your expected monthly call volume.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <span className="text-xs text-muted-foreground w-10">1k</span>
              <Slider
                value={[sliderVal]}
                onValueChange={(v) =>
                  setSliderVal(Array.isArray(v) ? v[0] : (v as number))
                }
                min={0}
                max={100}
                step={1}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-10 text-right">
                10M
              </span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-y-2 text-sm">
              <div className="text-muted-foreground">
                Monthly volume:{" "}
                <span className="font-medium text-foreground">
                  {formatCalls(monthlyCalls)} calls/mo
                </span>
              </div>
              <ProjectionLine
                aLabel={modelA.label}
                bLabel={modelB.label}
                aMonthly={aMonthly}
                bMonthly={bMonthly}
              />
            </div>
          </CardContent>
        </Card>

        {verdictData && (
          <Card className="border-2">
            <CardHeader>
              <CardTitle className="text-base flex flex-wrap items-center gap-2">
                Verdict
                <Badge>
                  Recommended:{" "}
                  {verdictData.winner === "A" ? modelA.label : modelB.label}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="leading-relaxed">{verdictData.reasoning}</p>

              <JudgePanel
                judge={judge}
                modelALabel={modelA.label}
                modelBLabel={modelB.label}
              />

              <p className="text-muted-foreground italic text-xs leading-relaxed">
                Quality is graded by MiniMax M2.7 on a single prompt. Run
                your own evals on a representative workload before committing —
                a single LLM-as-judge call is signal, not proof.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function ModelPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </label>
      <Select value={value} onValueChange={(v) => onChange(v as string)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select a model">
            {(v: unknown) => {
              const m = MODELS.find((mm) => mm.id === v);
              return m ? m.label : "Select a model";
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {MODELS.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              <span className="flex items-center gap-2">
                <span>{m.label}</span>
                <span className="text-xs text-muted-foreground">
                  ${m.inputCostPer1M.toFixed(2)}/1M
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ResultColumn({
  label,
  model,
  state,
  runState,
  callCost,
}: {
  label: Side;
  model: Model;
  state: ModelState;
  runState: RunState;
  callCost: number | undefined;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            <span className="text-muted-foreground text-xs uppercase tracking-wide mr-2">
              Model {label}
            </span>
            {model.label}
          </CardTitle>
          <Badge variant="outline" className="capitalize">
            {model.tier}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4">
        <div className="rounded-md border bg-muted/30 p-3 min-h-48 max-h-80 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed space-y-2">
          {state.error ? (
            <span className="text-destructive">Error: {state.error}</span>
          ) : state.text || state.reasoning ? (
            <>
              {state.text ? (
                <div>
                  {state.text}
                  {!state.done && runState === "streaming" && (
                    <span className="inline-block w-2 h-4 align-middle bg-foreground/40 animate-pulse ml-0.5" />
                  )}
                </div>
              ) : runState === "streaming" ? (
                <div className="text-muted-foreground italic text-xs">
                  Thinking…
                </div>
              ) : null}
              {state.reasoning && (
                <details className="text-xs text-muted-foreground border-l-2 border-muted pl-2">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-wide font-medium not-italic select-none">
                    Reasoning ({estimateTokens(state.reasoning)} tok)
                  </summary>
                  <div className="italic mt-2 whitespace-pre-wrap">
                    {state.reasoning}
                  </div>
                </details>
              )}
            </>
          ) : runState === "streaming" ? (
            <span className="text-muted-foreground italic">
              Waiting for first token…
            </span>
          ) : (
            <span className="text-muted-foreground italic">
              Output will stream here.
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="TTFT" value={formatMs(state.ttftMs)} />
          <Metric label="Total" value={formatMs(state.totalMs)} />
          <Metric
            label="Tokens/sec"
            value={formatTokensPerSec(state.tokensPerSec)}
          />
          <Metric label="Cost / call" value={formatUSD(callCost)} />
        </div>
        {state.done && !state.error && (
          <div className="text-xs text-muted-foreground">
            {state.inputTokens} in · {state.outputTokens} out
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}

function ProjectionLine({
  aLabel,
  bLabel,
  aMonthly,
  bMonthly,
}: {
  aLabel: string;
  bLabel: string;
  aMonthly: number | undefined;
  bMonthly: number | undefined;
}) {
  if (aMonthly === undefined || bMonthly === undefined) {
    return (
      <div className="text-muted-foreground text-xs">
        Run a comparison to see projection
      </div>
    );
  }
  const cheaper = aMonthly < bMonthly ? "A" : "B";
  const delta = Math.abs(aMonthly - bMonthly);
  const max = Math.max(aMonthly, bMonthly);
  const pct = max > 0 ? Math.round((delta / max) * 100) : 0;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
      <span>
        <span className="text-muted-foreground">{shortLabel(aLabel)}: </span>
        <span className="font-medium tabular-nums">
          {formatMoneyShort(aMonthly)}
        </span>
      </span>
      <span>
        <span className="text-muted-foreground">{shortLabel(bLabel)}: </span>
        <span className="font-medium tabular-nums">
          {formatMoneyShort(bMonthly)}
        </span>
      </span>
      <span className="text-muted-foreground">
        Δ {formatMoneyShort(delta)} ({pct}% cheaper on {cheaper})
      </span>
    </div>
  );
}

function shortLabel(label: string): string {
  return label.replace(" Instruct", "");
}

function JudgePanel({
  judge,
  modelALabel,
  modelBLabel,
}: {
  judge: JudgeState;
  modelALabel: string;
  modelBLabel: string;
}) {
  if (judge.status === "idle") return null;

  if (judge.status === "running") {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-foreground/40 animate-pulse" />
        Quality assessment in progress (MiniMax M2.7 judging)…
      </div>
    );
  }

  if (judge.status === "error") {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        Quality assessment failed: {judge.message}
      </div>
    );
  }

  const { result } = judge;
  const dims: Array<keyof JudgeScores> = [
    "correctness",
    "conciseness",
    "helpfulness",
  ];
  const totalA =
    result.scoreA.correctness +
    result.scoreA.conciseness +
    result.scoreA.helpfulness;
  const totalB =
    result.scoreB.correctness +
    result.scoreB.conciseness +
    result.scoreB.helpfulness;

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide font-medium">
          Quality assessment
        </div>
        <span className="text-[10px] text-muted-foreground">
          judged by MiniMax M2.7 · {(result.elapsedMs / 1000).toFixed(1)}s
        </span>
      </div>

      <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-1.5 text-xs items-center">
        <div className="font-medium">{shortLabel(modelALabel)}</div>
        <div className="text-right tabular-nums text-muted-foreground">
          {totalA}/15
        </div>
        <div className="font-medium">{shortLabel(modelBLabel)}</div>
        <div className="text-right tabular-nums text-muted-foreground">
          {totalB}/15
        </div>
      </div>

      <div className="space-y-2">
        {dims.map((d) => (
          <ScoreRow
            key={d}
            label={d}
            a={result.scoreA[d]}
            b={result.scoreB[d]}
          />
        ))}
      </div>

      <div className="text-xs leading-relaxed border-t pt-2">
        <span className="font-medium">Judge says:</span>{" "}
        {result.winner === "tie"
          ? "Tie — "
          : `${result.winner === "A" ? shortLabel(modelALabel) : shortLabel(modelBLabel)} wins on quality. `}
        <span className="text-muted-foreground">{result.reasoning}</span>
      </div>
    </div>
  );
}

function ScoreRow({
  label,
  a,
  b,
}: {
  label: string;
  a: number;
  b: number;
}) {
  const winner = a > b ? "A" : b > a ? "B" : "tie";
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-xs">
      <ScoreBar value={a} highlight={winner === "A"} side="left" />
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground text-center min-w-20">
        {label}
      </div>
      <ScoreBar value={b} highlight={winner === "B"} side="right" />
    </div>
  );
}

function ScoreBar({
  value,
  highlight,
  side,
}: {
  value: number;
  highlight: boolean;
  side: "left" | "right";
}) {
  const pct = (value / 5) * 100;
  return (
    <div
      className={`flex items-center gap-2 ${side === "left" ? "flex-row-reverse" : ""}`}
    >
      <span
        className={`tabular-nums text-xs ${highlight ? "font-semibold" : "text-muted-foreground"}`}
      >
        {value}
      </span>
      <div
        className={`flex-1 h-1.5 rounded-full bg-muted overflow-hidden ${side === "left" ? "scale-x-[-1]" : ""}`}
      >
        <div
          className={`h-full rounded-full transition-all ${highlight ? "bg-foreground" : "bg-foreground/40"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

function buildVerdict(
  a: { model: Model; ttftMs: number; callCost: number },
  b: { model: Model; ttftMs: number; callCost: number },
  monthlyCalls: number
): { winner: Side; reasoning: string } {
  const aMonthly = a.callCost * monthlyCalls;
  const bMonthly = b.callCost * monthlyCalls;
  const cheaper: Side = aMonthly <= bMonthly ? "A" : "B";
  const faster: Side = a.ttftMs <= b.ttftMs ? "A" : "B";

  const cheaperModel = cheaper === "A" ? a.model : b.model;
  const fasterModel = faster === "A" ? a.model : b.model;
  const ttftFast = faster === "A" ? a.ttftMs : b.ttftMs;
  const ttftSlow = faster === "A" ? b.ttftMs : a.ttftMs;
  const ttftRatio = ttftSlow / Math.max(ttftFast, 1);
  const monthlySaving = Math.abs(aMonthly - bMonthly);
  const monthlyMax = Math.max(aMonthly, bMonthly);
  const pct =
    monthlyMax > 0 ? Math.round((monthlySaving / monthlyMax) * 100) : 0;

  if (cheaper === faster) {
    const w = cheaper;
    return {
      winner: w,
      reasoning: `${cheaperModel.label} is both faster (${ttftRatio.toFixed(1)}x lower TTFT) and cheaper (${pct}% less, ~${formatMoneyShort(monthlySaving)}/mo saved at ${monthlyCalls.toLocaleString()} calls/mo). Clear win for this workload.`,
    };
  }

  return {
    winner: cheaper,
    reasoning: `Tradeoff: ${fasterModel.label} is faster (${ttftRatio.toFixed(1)}x lower TTFT), but ${cheaperModel.label} is cheaper (${pct}% less, ~${formatMoneyShort(monthlySaving)}/mo at ${monthlyCalls.toLocaleString()} calls/mo). Recommend ${cheaperModel.label} unless TTFT under ${Math.round(ttftFast)}ms is a hard requirement.`,
  };
}
