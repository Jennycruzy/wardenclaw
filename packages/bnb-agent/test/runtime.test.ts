import { describe, it, expect } from "vitest";
import { KillSwitch, Heartbeat, sendAlert, formatAlert, type FetchLike } from "../src/index.js";

describe("KillSwitch", () => {
  it("authenticates only the correct token", () => {
    const ks = new KillSwitch("s3cret-token");
    expect(ks.authenticate("s3cret-token")).toBe(true);
    expect(ks.authenticate("wrong-token!!")).toBe(false);
    expect(ks.authenticate(undefined)).toBe(false);
  });

  it("rejects everything when no token is configured", () => {
    const ks = new KillSwitch(undefined);
    expect(ks.authenticate("anything")).toBe(false);
  });

  it("engages and records the time", () => {
    const ks = new KillSwitch("t");
    expect(ks.isEngaged).toBe(false);
    ks.engage(1000);
    expect(ks.isEngaged).toBe(true);
    expect(ks.engagedAt).toBe(1000);
  });
});

describe("Heartbeat", () => {
  it("is not stale before the first beat", () => {
    const hb = new Heartbeat(60_000);
    expect(hb.isStale(1_000_000)).toBe(false);
  });

  it("detects staleness after missed intervals", () => {
    const hb = new Heartbeat(60_000);
    hb.beat(1_000_000);
    expect(hb.isStale(1_000_000 + 60_000)).toBe(false);
    expect(hb.isStale(1_000_000 + 60_000 * 4)).toBe(true);
  });
});

describe("alerts", () => {
  it("formats a readable alert line", () => {
    const line = formatAlert({ reason: "survival_mode", message: "soft drawdown breached", timestamp: "t" });
    expect(line).toContain("SURVIVAL_MODE");
    expect(line).toContain("soft drawdown");
  });

  it("delivers to the webhook", async () => {
    const f: FetchLike = async () => ({ ok: true, status: 200 });
    const r = await sendAlert("https://hook", { reason: "emergency_stop", message: "stop", timestamp: "t" }, f);
    expect(r.delivered).toBe(true);
  });

  it("never throws on delivery failure (loop survives)", async () => {
    const f: FetchLike = async () => {
      throw new Error("network down");
    };
    const r = await sendAlert("https://hook", { reason: "execution_failure", message: "x", timestamp: "t" }, f);
    expect(r.delivered).toBe(false);
    expect(r.reason).toMatch(/network down/);
  });

  it("reports when no webhook is configured", async () => {
    const r = await sendAlert(undefined, { reason: "restart_recovery", message: "x", timestamp: "t" });
    expect(r.delivered).toBe(false);
  });
});
