/**
 * BSC RPC failover manager.
 *
 * The agent runs unattended for 7 days; a dead RPC must never hang the loop
 * (§0.11). This manages a pool of endpoints, tracks health, and fails over to the
 * next healthy endpoint automatically. It is pure logic over an injected probe so
 * it is testable without a network; the worker supplies the real probe.
 */

export type RpcProbe = (url: string) => Promise<boolean>;

export interface RpcEndpointHealth {
  url: string;
  healthy: boolean;
  lastCheckedMs: number;
  consecutiveFailures: number;
}

export interface RpcManagerOptions {
  urls: string[];
  probe: RpcProbe;
  /** Failures before an endpoint is marked unhealthy. */
  failureThreshold?: number;
}

export class NoHealthyRpcError extends Error {
  constructor() {
    super("No healthy BSC RPC endpoint available across the configured pool.");
    this.name = "NoHealthyRpcError";
  }
}

export class RpcManager {
  private readonly health: RpcEndpointHealth[];
  private readonly probe: RpcProbe;
  private readonly failureThreshold: number;
  private activeIndex = 0;

  constructor(opts: RpcManagerOptions) {
    if (opts.urls.length === 0) {
      throw new Error("RpcManager requires at least one RPC URL (set BSC_RPC_URLS).");
    }
    this.probe = opts.probe;
    this.failureThreshold = opts.failureThreshold ?? 2;
    this.health = opts.urls.map((url) => ({
      url,
      healthy: true,
      lastCheckedMs: 0,
      consecutiveFailures: 0,
    }));
  }

  get endpoints(): readonly RpcEndpointHealth[] {
    return this.health;
  }

  /** The currently active endpoint URL. */
  get active(): string {
    return this.health[this.activeIndex]!.url;
  }

  /** Probe every endpoint and update health. Returns the count still healthy. */
  async refreshHealth(nowMs: number): Promise<number> {
    let healthyCount = 0;
    for (const h of this.health) {
      let ok = false;
      try {
        ok = await this.probe(h.url);
      } catch {
        ok = false;
      }
      h.lastCheckedMs = nowMs;
      if (ok) {
        h.healthy = true;
        h.consecutiveFailures = 0;
        healthyCount++;
      } else {
        h.consecutiveFailures++;
        if (h.consecutiveFailures >= this.failureThreshold) h.healthy = false;
        if (h.healthy) healthyCount++;
      }
    }
    return healthyCount;
  }

  /**
   * Return a healthy endpoint, failing over from the active one if needed.
   * Throws NoHealthyRpcError when the whole pool is down (never hangs).
   */
  selectHealthy(): string {
    if (this.health[this.activeIndex]!.healthy) return this.active;
    for (let i = 0; i < this.health.length; i++) {
      const idx = (this.activeIndex + 1 + i) % this.health.length;
      if (this.health[idx]!.healthy) {
        this.activeIndex = idx;
        return this.health[idx]!.url;
      }
    }
    throw new NoHealthyRpcError();
  }

  /** Mark the active endpoint as failed (e.g. a request threw) and fail over. */
  markActiveFailed(): string {
    const h = this.health[this.activeIndex]!;
    h.consecutiveFailures++;
    if (h.consecutiveFailures >= this.failureThreshold) h.healthy = false;
    return this.selectHealthy();
  }
}
