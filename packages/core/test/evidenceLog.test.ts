import { describe, it, expect } from "vitest";
import { WardenLogger } from "../src/index.js";

describe("WardenLogger", () => {
  it("records every event with a PAPER/SIM label and keeps an in-memory trail", () => {
    const lines: string[] = [];
    const log = new WardenLogger({ write: (l) => lines.push(l), mode: "PAPER" });
    log.banner("WARDENCLAW EVIDENCE");
    log.log("strategy_verdict", "Playbook Shield", "Certified");
    log.log("executor", "executor", "EXECUTED (paper)", { permitId: "WARDEN-X" });

    expect(log.events.filter((e) => e.kind !== "banner")).toHaveLength(2);
    expect(lines.some((l) => l.includes("[PAPER]") && l.includes("Certified"))).toBe(true);
    expect(log.events.at(-1)!.data).toMatchObject({ permitId: "WARDEN-X" });
  });

  it("never emits without the SIM/PAPER label", () => {
    const lines: string[] = [];
    const log = new WardenLogger({ write: (l) => lines.push(l), mode: "SIM" });
    log.log("paper_fill", "fill", "filled 2.0 @ 100");
    expect(lines.every((l) => l.includes("[SIM]"))).toBe(true);
  });
});
