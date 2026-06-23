"use client";

/**
 * "Break the Warden" — a live adversary arena. Type any trade in plain English,
 * watch both checkpoints adjudicate against live market context, then try to cheat
 * the signed permit and watch the executor's independent verifier reject every
 * attempt. The finale replays real candles: the reckless order liquidates while the
 * Warden-adjusted order survives. All paper / simulation — no orders are placed.
 *
 * Every verdict here is computed by the deterministic engine via /api/bitget/arena.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/shell";
import { Card, SectionTitle, Badge, Dot, KeyValue } from "@/components/ui";
import { VerdictBadge, FailClosedBanner } from "@/components/firewall";

// ---- Response shapes (mirror lib/arena.ts) ----------------------------------

interface GateResult {
  gate: string;
  passed: boolean;
  value: number | string | boolean;
  threshold: number | string | boolean;
  effect: "none" | "reduce" | "delay" | "hedge" | "block";
  reason: string;
}
interface ApprovedOrder {
  asset: string; direction: string; notionalUsd: number; leverage: number; orderType: string;
}
interface Permit {
  permit_id: string; verdict: string; created_at: string; expires_at: string;
  asset: string; direction: string; price_at_issue: number; max_price_drift_pct: number;
  approved_order: ApprovedOrder | null;
  json_hash: string; signature: string; prev_card_hash: string;
}
interface SimLeg {
  side: "long" | "short"; notionalUsd: number; leverage: number; entryPrice: number;
  liquidationPrice: number; liquidated: boolean; maxDrawdownPct: number; finalPnlUsd: number;
}
interface Finale {
  entryPrice: number;
  candles: Array<{ time: string; close: number; high: number; low: number }>;
  original: SimLeg; adjusted: SimLeg;
  drawdownAvoidedUsd: number; liquidationAvoided: boolean;
}
interface Evaluation {
  intent: { asset: string; direction: string; notionalUsd: number; leverage: number; orderType: string; rawCommand: string };
  context: { asset: string; assetKnown: boolean; price: number; livePriceUsed: boolean; candleCount: number; volPctile: number; marketOpen: boolean; feedAgeSec: number; signingKeyIsDev: boolean; priceSource: "live_feed" | "cached_candles" | "fallback"; news: { active: boolean; ageMin?: number; direction?: string; confidence?: number; tradeRelevance?: string; confirmed?: boolean; headline?: string }; btcVol: { applicable: boolean; available: boolean; rising?: boolean; recentVolPct?: number; baselineVolPct?: number } };
  strategy: { verdict: string; mayEmitMandates: boolean; failedChecks: Array<{ check: string; detail: string }> };
  trade: { verdict: string; gates: GateResult[]; gatesFailed: string[]; approvedOrder: ApprovedOrder | null; hedgeLeg: { asset: string; notionalUsd: number; reason: string } | null; modificationReason: string[]; recheckCondition?: string };
  permit: Permit | null;
  finale: Finale | null;
}
type Attack = "intact" | "strip" | "edit" | "expire" | "drift" | "replay";
interface AttackResult {
  attack: Attack;
  validation: { ok: boolean; reason?: string; detail?: string; priceDriftPct?: number };
  chain: { prev_card_hash: string; json_hash: string; signature: string };
  cardVerification: { ok: boolean; reason?: string; detail?: string };
  nowIso: string; currentPrice: number;
}

const EXAMPLES = [
  "buy $3k of TSLAx at 15x", // REDUCE — issues a permit you can then try to forge
  "ape $5k into NVDAx at 25x", // BLOCK — no permit, nothing to forge
  "short MSTRx $4k at 20x", // DELAY — and the reckless leg liquidates on replay
  "long $50000 DOGE at 25x", // BLOCK — unknown asset, fail-closed
];

const ATTACKS: Array<{ key: Attack; label: string; blurb: string }> = [
  { key: "intact", label: "Submit as-is", blurb: "the genuine permit — should pass" },
  { key: "strip", label: "Strip the signature", blurb: "blank the HMAC" },
  { key: "edit", label: "Edit a signed field", blurb: "10× the size, 50× leverage" },
  { key: "replay", label: "Replay a used permit", blurb: "resubmit after one fill" },
  { key: "expire", label: "Use it expired", blurb: "submit past expiry" },
  { key: "drift", label: "Let price drift", blurb: "+5% beyond the band" },
];

// The seven independent checks the executor runs, in order, keyed by refusal reason.
const VERIFIER_STEPS: Array<{ reason: string; label: string }> = [
  { reason: "signature_invalid", label: "Signature valid (HMAC-SHA256)" },
  { reason: "hash_mismatch", label: "Body hash intact (SHA-256)" },
  { reason: "expired", label: "Within expiry window" },
  { reason: "already_consumed", label: "Single-use — not yet consumed" },
  { reason: "verdict_not_executable", label: "Verdict authorizes execution" },
  { reason: "action_mismatch", label: "Requested action matches permit" },
  { reason: "price_drift", label: "Price within drift band" },
  { reason: "gate_flipped", label: "No binding gate flipped" },
];

const fmtUsd = (n: number): string =>
  `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const short = (s: string, n = 16): string => (s.length > n ? `${s.slice(0, n)}…` : s);

function SourceTag({ source }: { source: "live_feed" | "cached_candles" | "fallback" }) {
  if (source === "live_feed") return <Badge tone="pos">live feed</Badge>;
  if (source === "cached_candles") return <Badge tone="accent">cached real candle</Badge>;
  return <Badge tone="neutral">fallback</Badge>;
}

export default function ArenaPage() {
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<Evaluation | null>(null);
  const [revealed, setRevealed] = useState(0); // gates revealed one-by-one
  const [attackResults, setAttackResults] = useState<Partial<Record<Attack, AttackResult>>>({});
  const [activeAttack, setActiveAttack] = useState<Attack | null>(null);
  const [attackBusy, setAttackBusy] = useState<Attack | "all" | null>(null);
  const attackResult = activeAttack ? attackResults[activeAttack] ?? null : null;

  const submit = useCallback(async (cmd: string) => {
    const c = cmd.trim();
    if (!c) return;
    setLoading(true); setError(null); setAttackResults({}); setActiveAttack(null); setRevealed(0);
    try {
      const res = await fetch("/api/bitget/arena", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "evaluate", command: c }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "evaluation failed");
      setEvalResult(data as Evaluation);
      // Reflect the command in the URL so this adjudication is shareable.
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("cmd", c);
        window.history.replaceState(null, "", url.toString());
      }
    } catch (e) {
      setError((e as Error).message);
      setEvalResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Deep link: ?cmd=... auto-adjudicates on load, so a permalink replays a verdict.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cmd = new URLSearchParams(window.location.search).get("cmd");
    if (cmd) { setCommand(cmd); void submit(cmd); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reveal the gates one at a time once a result lands.
  useEffect(() => {
    if (!evalResult) return;
    setRevealed(0);
    const total = evalResult.trade.gates.length;
    const id = setInterval(() => {
      setRevealed((r) => {
        if (r >= total) { clearInterval(id); return r; }
        return r + 1;
      });
    }, 160);
    return () => clearInterval(id);
  }, [evalResult]);

  const fetchAttack = useCallback(async (attack: Attack, permit: Permit): Promise<AttackResult | null> => {
    const res = await fetch("/api/bitget/arena", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "attack", attack, permit }),
    });
    const data = await res.json();
    return res.ok ? (data as AttackResult) : null;
  }, []);

  const runAttack = useCallback(async (attack: Attack) => {
    if (!evalResult?.permit) return;
    setAttackBusy(attack);
    try {
      const data = await fetchAttack(attack, evalResult.permit);
      if (data) { setAttackResults((m) => ({ ...m, [attack]: data })); setActiveAttack(attack); }
    } finally {
      setAttackBusy(null);
    }
  }, [evalResult, fetchAttack]);

  // Fire every tamper attempt in sequence and keep them all on screen.
  const runAllAttacks = useCallback(async () => {
    if (!evalResult?.permit) return;
    setAttackBusy("all");
    try {
      const collected: Partial<Record<Attack, AttackResult>> = {};
      for (const a of ATTACKS) {
        const data = await fetchAttack(a.key, evalResult.permit);
        if (data) collected[a.key] = data;
        setAttackResults({ ...collected });
      }
      // Lead the detail panel with the first attack that was refused, if any.
      const firstRejected = ATTACKS.find((a) => collected[a.key] && !collected[a.key]!.validation.ok);
      setActiveAttack(firstRejected?.key ?? "intact");
    } finally {
      setAttackBusy(null);
    }
  }, [evalResult, fetchAttack]);

  return (
    <Shell
      title="Break the Warden"
      subtitle="Type any trade. Try to get it past the firewall — or try to forge the permit. You will fail; that is the proof."
    >
      <div className="flex flex-col gap-6">
        <FailClosedBanner />

        {/* Input */}
        <Card>
          <SectionTitle title="1 · Issue a command" subtitle="Plain English. Parsed into a structured intent; every risk verdict is deterministic." />
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(command); }}
                placeholder="ape $5k into NVDAx at 10x"
                className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent/60"
              />
              <button
                onClick={() => submit(command)}
                disabled={loading || !command.trim()}
                className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-40"
              >
                {loading ? "Adjudicating…" : "Adjudicate"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => { setCommand(ex); submit(ex); }}
                  className="rounded-full border border-line bg-bg-subtle px-3 py-1 text-xs text-ink-muted transition hover:border-accent/40 hover:text-ink"
                >
                  {ex}
                </button>
              ))}
            </div>
            {error && <p className="text-xs text-neg">{error}</p>}
          </div>
        </Card>

        {evalResult && (
          <>
            {/* Parsed intent + live context */}
            <Card>
              <SectionTitle
                title="Parsed intent → live market context"
                subtitle="The LLM layer parses; it never decides risk. Context is assembled from the live console feed + real cached candles."
              />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-line p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Intent</p>
                  <KeyValue k="Asset" v={evalResult.intent.asset} />
                  <KeyValue k="Direction" v={evalResult.intent.direction} />
                  <KeyValue k="Size" v={fmtUsd(evalResult.intent.notionalUsd)} />
                  <KeyValue k="Leverage" v={`${evalResult.intent.leverage}×`} />
                  <KeyValue k="Order type" v={evalResult.intent.orderType} />
                </div>
                <div className="rounded-lg border border-line p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Market context</p>
                  <KeyValue k="Known asset" v={evalResult.context.assetKnown ? "yes" : "NO — fail-closed"} />
                  <KeyValue
                    k="Price"
                    v={<span className="flex items-center gap-2">{fmtUsd(evalResult.context.price)}<SourceTag source={evalResult.context.priceSource} /></span>}
                  />
                  <KeyValue k="Vol percentile" v={<span className="flex items-center gap-2">{evalResult.context.volPctile.toFixed(2)}<Badge tone="accent">real candles</Badge></span>} />
                  <KeyValue k="NYSE session" v={<span className="flex items-center gap-2">{evalResult.context.marketOpen ? "open" : "closed"}<Badge tone="accent">clock</Badge></span>} />
                  <KeyValue
                    k="Live news"
                    v={
                      evalResult.context.news.active ? (
                        <span className="flex items-center gap-2">
                          <Badge tone="warn">shock · {evalResult.context.news.ageMin}m</Badge>
                          <span className="text-ink-muted">{evalResult.context.news.direction} {Math.round((evalResult.context.news.confidence ?? 0) * 100)}% · {evalResult.context.news.confirmed ? "confirmed" : "unconfirmed"}</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">{evalResult.context.news.direction ?? "none"}<Badge tone="neutral">no fresh shock</Badge></span>
                      )
                    }
                  />
                  {evalResult.context.btcVol.applicable && (
                    <KeyValue
                      k="BTC realized-vol"
                      v={
                        evalResult.context.btcVol.available ? (
                          <span className="flex items-center gap-2">
                            <Badge tone={evalResult.context.btcVol.rising ? "warn" : "pos"}>{evalResult.context.btcVol.rising ? "rising" : "calm"}</Badge>
                            <span className="text-ink-muted">{evalResult.context.btcVol.recentVolPct}% vs {evalResult.context.btcVol.baselineVolPct}%</span>
                          </span>
                        ) : (
                          <Badge tone="neutral">unavailable — gate conservative</Badge>
                        )
                      }
                    />
                  )}
                </div>
              </div>
              <p className="mt-3 text-xs text-ink-faint">
                <span className="text-pos">Live</span>: price (Agent Hub feed), the news-shock gates (real classified
                headlines + shock volume), and — for BTC-correlated names — BTC realized-vol (live BTCUSDT candles). {" "}
                <span className="text-accent">Computed from real cached Bitget candles</span>: volatility, premium reference, session. {" "}
                <span className="text-ink-muted">Conservative engine defaults</span> (not wired live): spread, earnings.
                Every gate stays conservative rather than guess; nothing here is fabricated.
              </p>
            </Card>

            {/* Checkpoint 1 — Playbook Shield */}
            <Card>
              <SectionTitle title="2 · Checkpoint one — Playbook Shield" subtitle="Audits the command as a strategy before any mandate may exist." />
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
                <div>
                  <p className="text-sm font-medium">{evalResult.strategy.mayEmitMandates ? "May emit mandates" : "Emits no mandates"}</p>
                  {evalResult.strategy.failedChecks.length > 0 && (
                    <p className="mt-1 text-xs text-ink-muted">
                      Failed: {evalResult.strategy.failedChecks.map((c) => c.check).join(", ")}
                    </p>
                  )}
                </div>
                <VerdictBadge verdict={evalResult.strategy.verdict} kind="strategy" />
              </div>
            </Card>

            {/* Checkpoint 2 — ten gates */}
            <Card>
              <SectionTitle title="3 · Checkpoint two — the ten gates" subtitle="Deterministic gates, evaluated in order. The verdict is whatever they resolve to." />
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="text-xs text-ink-muted">{evalResult.trade.gatesFailed.length} of {evalResult.trade.gates.length} gates flagged</span>
                <VerdictBadge verdict={evalResult.trade.verdict} />
              </div>
              <div className="flex flex-col gap-1.5">
                {evalResult.trade.gates.map((g, i) => {
                  const shown = i < revealed;
                  const tone = g.passed ? "pos" : g.effect === "block" ? "neg" : g.effect === "delay" ? "accent" : g.effect === "hedge" ? "attack" : "warn";
                  return (
                    <div
                      key={g.gate}
                      className={`flex items-start gap-3 rounded-lg border border-line px-3 py-2 transition-all duration-300 ${shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"}`}
                    >
                      <span className="mt-1"><Dot tone={tone} /></span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-ink">{g.gate}</span>
                          <Badge tone={tone}>{g.passed ? "pass" : g.effect}</Badge>
                        </div>
                        <p className="text-xs text-ink-muted">{g.reason}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {evalResult.trade.modificationReason.length > 0 && (
                <div className="mt-4 rounded-lg border border-warn/30 bg-warn/5 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-warn">Warden rewrite</p>
                  <ul className="list-inside list-disc text-xs text-ink-muted">
                    {evalResult.trade.modificationReason.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              )}
              {evalResult.trade.recheckCondition && (
                <p className="mt-3 text-xs text-accent">DELAY — {evalResult.trade.recheckCondition}</p>
              )}
            </Card>

            {/* Warden Permit + tamper arena */}
            <Card>
              <SectionTitle title="4 · The signed Warden Permit — now try to forge it" subtitle="Single-use, expiring, price-bound, HMAC-signed, hash-chained. The executor verifies it independently." />
              {evalResult.permit ? (
                <>
                  <div className="mb-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-line p-3">
                      <KeyValue k="Permit ID" v={<span className="font-mono">{evalResult.permit.permit_id}</span>} />
                      <KeyValue k="Verdict" v={evalResult.permit.verdict} />
                      <KeyValue k="Expires" v={new Date(evalResult.permit.expires_at).toLocaleTimeString()} />
                      <KeyValue k="Price drift band" v={`±${evalResult.permit.max_price_drift_pct}%`} />
                    </div>
                    <div className="rounded-lg border border-line p-3">
                      <KeyValue k="json_hash" v={<span className="font-mono">{short(evalResult.permit.json_hash, 20)}</span>} mono />
                      <KeyValue k="signature" v={<span className="font-mono">{short(evalResult.permit.signature, 20)}</span>} mono />
                      <KeyValue k="prev_card_hash" v={<span className="font-mono">{short(evalResult.permit.prev_card_hash, 20)}</span>} mono />
                    </div>
                  </div>

                  <div className="mb-3">
                    <PermitJson permit={evalResult.permit} />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={runAllAttacks}
                      disabled={attackBusy !== null}
                      className="rounded-lg border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent shadow-glow transition hover:bg-accent/25 disabled:opacity-40"
                    >
                      {attackBusy === "all" ? "Running all…" : "⚔ Run all attacks"}
                    </button>
                    <span className="text-xs text-ink-faint">or fire one at a time:</span>
                    {ATTACKS.map((a) => {
                      const r = attackResults[a.key];
                      const mark = r ? (r.validation.ok ? "✓" : "✕") : null;
                      return (
                        <button
                          key={a.key}
                          onClick={() => runAttack(a.key)}
                          disabled={attackBusy !== null}
                          title={a.blurb}
                          className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                            activeAttack === a.key ? "ring-1 ring-accent/60 " : ""
                          }${
                            a.key === "intact"
                              ? "border-pos/40 bg-pos/10 text-pos hover:bg-pos/20"
                              : "border-attack/40 bg-attack/10 text-attack hover:bg-attack/20"
                          }`}
                        >
                          {attackBusy === a.key ? "…" : a.label}
                          {mark ? (
                            <span className={r!.validation.ok ? "text-pos" : "text-neg"}>{mark}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>

                  {Object.keys(attackResults).length > 0 && (
                    <AttackMatrix
                      results={attackResults}
                      active={activeAttack}
                      onSelect={setActiveAttack}
                    />
                  )}

                  {attackResult && <AttackPanel result={attackResult} />}
                </>
              ) : (
                <div className="rounded-lg border border-neg/30 bg-neg/5 p-4 text-sm text-neg">
                  Verdict <strong>{evalResult.trade.verdict}</strong> — no permit was issued. There is nothing to
                  forge, replay, or tamper with: the firewall produced no authorization at all. That is the point.
                </div>
              )}
            </Card>

            {/* Finale — counterfactual */}
            {evalResult.finale && <FinalePanel finale={evalResult.finale} />}
          </>
        )}
      </div>
    </Shell>
  );
}

// ---- Verifier / hash-chain panel --------------------------------------------

function AttackPanel({ result }: { result: AttackResult }) {
  const { validation, cardVerification, chain } = result;
  const failIdx = validation.ok ? -1 : VERIFIER_STEPS.findIndex((s) => s.reason === validation.reason);
  const links: Array<{ k: string; v: string; broken: boolean }> = [
    { k: "prev_card_hash", v: chain.prev_card_hash, broken: false },
    { k: "json_hash", v: chain.json_hash, broken: cardVerification.reason === "hash_mismatch" },
    { k: "signature", v: chain.signature, broken: cardVerification.reason === "signature_mismatch" },
  ];
  return (
    <div className="mt-4 rounded-lg border border-line p-4">
      <div className="mb-3 flex items-center gap-2">
        <Badge tone={validation.ok ? "pos" : "neg"}>{validation.ok ? "Accepted" : "Rejected"}</Badge>
        <span className="text-xs text-ink-muted">
          {validation.ok
            ? "the genuine permit passes every independent check"
            : `refused: ${validation.reason}${validation.detail ? ` — ${validation.detail}` : ""}`}
        </span>
      </div>

      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Executor's independent verifier</p>
      <div className="mb-4 grid gap-1 sm:grid-cols-2">
        {VERIFIER_STEPS.map((s, i) => {
          const state = failIdx === -1 ? "pass" : i < failIdx ? "pass" : i === failIdx ? "fail" : "skip";
          const tone = state === "pass" ? "pos" : state === "fail" ? "neg" : "neutral";
          return (
            <div key={s.reason} className="flex items-center gap-2 text-xs">
              <Dot tone={tone} />
              <span className={state === "fail" ? "text-neg" : state === "skip" ? "text-ink-faint line-through" : "text-ink-muted"}>{s.label}</span>
            </div>
          );
        })}
      </div>

      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Hash chain</p>
      <div className="flex flex-col gap-1">
        {links.map((l) => (
          <div key={l.k} className={`flex items-center justify-between gap-3 rounded border px-2 py-1 font-mono text-[11px] ${l.broken ? "border-neg/50 bg-neg/10 text-neg" : "border-line text-ink-muted"}`}>
            <span>{l.k}</span>
            <span>{l.broken ? "✕ broken" : short(l.v, 28)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Copyable signed permit -------------------------------------------------

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className="rounded border border-line bg-bg-subtle px-2 py-0.5 text-[11px] text-ink-muted transition hover:border-accent/40 hover:text-accent"
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

function PermitJson({ permit }: { permit: Permit }) {
  const [open, setOpen] = useState(false);
  const json = JSON.stringify(permit, null, 2);
  return (
    <div className="rounded-lg border border-line">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted transition hover:text-ink"
        >
          <span className={`transition ${open ? "rotate-90" : ""}`}>▸</span>
          {open ? "Hide" : "View"} the raw signed permit
        </button>
        <CopyButton text={json} label="Copy permit JSON" />
      </div>
      {open ? (
        <pre className="max-h-72 overflow-auto border-t border-line/60 bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-pos/80">
          {json}
        </pre>
      ) : null}
    </div>
  );
}

// ---- Attack results matrix --------------------------------------------------

function AttackMatrix({
  results,
  active,
  onSelect,
}: {
  results: Partial<Record<Attack, AttackResult>>;
  active: Attack | null;
  onSelect: (a: Attack) => void;
}) {
  const done = ATTACKS.filter((a) => results[a.key]);
  const rejected = done.filter((a) => !results[a.key]!.validation.ok).length;
  return (
    <div className="mt-4 rounded-lg border border-line p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Verifier scoreboard</p>
        <span className="text-xs text-ink-muted">
          <span className="text-neg">{rejected} refused</span> ·{" "}
          <span className="text-pos">{done.length - rejected} accepted</span>
        </span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {ATTACKS.map((a) => {
          const r = results[a.key];
          const ok = r?.validation.ok;
          return (
            <button
              key={a.key}
              onClick={() => r && onSelect(a.key)}
              disabled={!r}
              className={`flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-left text-xs transition ${
                active === a.key ? "border-accent/50 bg-accent/5" : "border-line"
              } ${r ? "hover:border-accent/40" : "opacity-40"}`}
            >
              <span className="flex items-center gap-2">
                <Dot tone={!r ? "neutral" : ok ? "pos" : "neg"} />
                <span className="text-ink-muted">{a.label}</span>
              </span>
              {r ? (
                <Badge tone={ok ? "pos" : "neg"}>{ok ? "accepted" : "refused"}</Badge>
              ) : (
                <span className="text-ink-faint">—</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Finale — animated counterfactual ---------------------------------------

/** Position equity at a price (mirrors ghostSim.equityAt; viz only). */
function equityAt(leg: SimLeg, price: number): number {
  const move = (price - leg.entryPrice) / leg.entryPrice;
  const dir = leg.side === "long" ? 1 : -1;
  return leg.notionalUsd * (1 + leg.leverage * dir * move);
}

function equitySeries(leg: SimLeg, candles: Finale["candles"]): number[] {
  let liquidated = false;
  return candles.map((c) => {
    const adverse = leg.side === "long" ? c.low : c.high;
    if (!liquidated && leg.leverage > 1 && (leg.side === "long" ? adverse <= leg.liquidationPrice : adverse >= leg.liquidationPrice)) {
      liquidated = true;
    }
    return liquidated ? 0 : Math.max(0, equityAt(leg, c.close));
  });
}

function FinalePanel({ finale }: { finale: Finale }) {
  const [frame, setFrame] = useState(finale.candles.length);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const recklessSeries = equitySeries(finale.original, finale.candles);
  const wardenSeries = equitySeries(finale.adjusted, finale.candles);
  const maxEq = Math.max(1, ...recklessSeries, ...wardenSeries);
  const n = finale.candles.length;

  const play = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    setFrame(0);
    timer.current = setInterval(() => {
      setFrame((f) => {
        if (f >= n) { if (timer.current) clearInterval(timer.current); return n; }
        return f + 1;
      });
    }, 40);
  }, [n]);

  // Auto-play the counterfactual once when it first appears, then clean up.
  useEffect(() => { play(); return () => { if (timer.current) clearInterval(timer.current); }; }, [play]);

  const W = 640, H = 180;
  const path = (series: number[]): string =>
    series.slice(0, Math.max(1, frame)).map((v, i) => {
      const x = (i / Math.max(1, n - 1)) * W;
      const y = H - (v / maxEq) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");

  return (
    <Card>
      <SectionTitle
        title="5 · Counterfactual — replay the real candles"
        subtitle="The same real price path, both orders. The reckless command vs the order the Warden would permit."
        right={
          <button onClick={play} className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20">
            ▶ Replay
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-6">
        <div>
          <p className="text-xs text-ink-faint">Drawdown avoided</p>
          <p className="tabular text-2xl font-semibold text-pos">{fmtUsd(finale.drawdownAvoidedUsd)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-faint">Liquidation</p>
          <p className={`text-2xl font-semibold ${finale.liquidationAvoided ? "text-pos" : "text-ink-muted"}`}>
            {finale.original.liquidated ? (finale.liquidationAvoided ? "avoided" : "both hit") : "neither"}
          </p>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-line bg-bg" preserveAspectRatio="none" height={H}>
        <line x1="0" y1={H} x2={W} y2={H} stroke="currentColor" className="text-line" strokeWidth="1" />
        <path d={path(recklessSeries)} fill="none" stroke="currentColor" className="text-neg" strokeWidth="2" />
        <path d={path(wardenSeries)} fill="none" stroke="currentColor" className="text-pos" strokeWidth="2" />
      </svg>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <LegCard label="Reckless command" tone="neg" leg={finale.original} />
        <LegCard label="Warden-permitted" tone="pos" leg={finale.adjusted} />
      </div>
    </Card>
  );
}

function LegCard({ label, tone, leg }: { label: string; tone: "neg" | "pos"; leg: SimLeg }) {
  return (
    <div className={`rounded-lg border p-3 ${tone === "neg" ? "border-neg/30" : "border-pos/30"}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
        <Badge tone={leg.liquidated ? "neg" : "pos"}>{leg.liquidated ? "liquidated" : "survived"}</Badge>
      </div>
      <KeyValue k="Size · leverage" v={`${fmtUsd(leg.notionalUsd)} · ${leg.leverage}×`} />
      <KeyValue k="Liquidation price" v={fmtUsd(leg.liquidationPrice)} />
      <KeyValue k="Max drawdown" v={`${(leg.maxDrawdownPct * 100).toFixed(1)}%`} />
      <KeyValue k="Final P&L" v={<span className={leg.finalPnlUsd >= 0 ? "text-pos" : "text-neg"}>{leg.finalPnlUsd >= 0 ? "+" : "−"}{fmtUsd(leg.finalPnlUsd)}</span>} />
    </div>
  );
}
