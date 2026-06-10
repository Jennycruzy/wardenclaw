/**
 * Runtime operational primitives for the 7-day unattended live window (§0.11):
 * the emergency kill-switch, the worker heartbeat, and the alerting model.
 *
 * These are pure and testable; the API and worker apps wire them to a real HTTP
 * server, a process manager, and a webhook. The kill-switch authenticates with a
 * shared token; alerting never throws (a failed alert must not crash the loop).
 */

export type AlertReason =
  | "survival_mode"
  | "execution_failure"
  | "twak_refusal"
  | "restart_recovery"
  | "daily_trade_at_risk"
  | "drawdown_soft"
  | "emergency_stop";

export interface Alert {
  reason: AlertReason;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export function formatAlert(alert: Alert): string {
  const head = `[RUNECLAW] ${alert.reason.toUpperCase()} — ${alert.message}`;
  return alert.data ? `${head}\n${JSON.stringify(alert.data)}` : head;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

/**
 * Send an alert to the configured webhook. NEVER throws — a delivery failure is
 * logged via the returned result, not propagated, so the trading loop survives.
 */
export async function sendAlert(
  webhookUrl: string | undefined,
  alert: Alert,
  fetchImpl?: FetchLike,
): Promise<{ delivered: boolean; reason?: string }> {
  if (!webhookUrl) return { delivered: false, reason: "no ALERT_WEBHOOK_URL configured" };
  const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!f) return { delivered: false, reason: "no fetch available" };
  try {
    const res = await f(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: formatAlert(alert), ...alert }),
    });
    return res.ok ? { delivered: true } : { delivered: false, reason: `webhook HTTP ${res.status}` };
  } catch (err) {
    return { delivered: false, reason: (err as Error).message };
  }
}

/**
 * The emergency kill-switch. When engaged, the worker halts new entries, cancels
 * pending intents, and attempts approval revocation. Reachable from a phone via an
 * authenticated endpoint.
 */
export class KillSwitch {
  private engaged = false;
  private engagedAtMs: number | null = null;

  constructor(private readonly token: string | undefined) {}

  /** Constant-ish-time token comparison; rejects when no token is configured. */
  authenticate(provided: string | undefined): boolean {
    if (!this.token || !provided) return false;
    if (provided.length !== this.token.length) return false;
    let diff = 0;
    for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ this.token.charCodeAt(i);
    return diff === 0;
  }

  engage(nowMs: number): void {
    this.engaged = true;
    this.engagedAtMs = nowMs;
  }

  get isEngaged(): boolean {
    return this.engaged;
  }

  get engagedAt(): number | null {
    return this.engagedAtMs;
  }
}

/** Worker heartbeat. A stale heartbeat triggers a process-manager restart + alert. */
export class Heartbeat {
  private lastBeatMs = 0;
  constructor(private readonly intervalMs: number) {}

  beat(nowMs: number): void {
    this.lastBeatMs = nowMs;
  }

  get last(): number {
    return this.lastBeatMs;
  }

  /** Stale when more than `staleMultiplier` intervals have passed since the last beat. */
  isStale(nowMs: number, staleMultiplier = 3): boolean {
    if (this.lastBeatMs === 0) return false; // not yet started
    return nowMs - this.lastBeatMs > this.intervalMs * staleMultiplier;
  }
}
