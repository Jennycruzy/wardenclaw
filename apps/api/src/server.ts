/**
 * RUNECLAW BSC control API (Fastify, TypeScript).
 *
 * Exposes the operational surface the user reaches from a phone (§0.11):
 *   GET  /health        — liveness + heartbeat freshness + kill state
 *   GET  /status        — current runtime state
 *   POST /kill          — authenticated emergency stop (Bearer KILL_SWITCH_TOKEN)
 *   POST /alert/test    — send a test alert to the configured webhook
 *
 * The kill-switch writes a flag the worker polls each cycle; the worker halts new
 * entries, cancels pending intents, and attempts approval revocation. The backend
 * never signs or moves funds — that is TWAK's job alone.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config as loadDotenv } from "dotenv";
import Fastify from "fastify";
import { KillSwitch, sendAlert } from "@runeclaw/bnb-agent";
import { readHeartbeat, writeKillFlag, readKillFlag } from "./state.js";

// Load the monorepo-root .env regardless of the process cwd (pnpm runs the
// package script from apps/api, so walk up to where pnpm-workspace.yaml lives).
(() => {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, ".env"))) {
      loadDotenv({ path: join(dir, ".env") });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
})();

const PORT = Number(process.env.API_PORT ?? "4000");
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_SECONDS ?? "60") * 1000;
const killSwitch = new KillSwitch(process.env.KILL_SWITCH_TOKEN);

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

function heartbeatStale(): boolean {
  const hb = readHeartbeat();
  if (!hb) return false;
  return Date.now() - Date.parse(hb.lastBeatIso) > HEARTBEAT_INTERVAL_MS * 3;
}

app.get("/health", async () => {
  const hb = readHeartbeat();
  const kill = readKillFlag();
  return {
    ok: true,
    killEngaged: Boolean(kill?.engaged),
    heartbeatStale: heartbeatStale(),
    lastBeatIso: hb?.lastBeatIso ?? null,
    cyclesRun: hb?.cyclesRun ?? 0,
    mode: hb?.mode ?? "unknown",
  };
});

app.get("/status", async () => {
  return {
    killFlag: readKillFlag(),
    heartbeat: readHeartbeat(),
    executionType: process.env.EXECUTION_TYPE ?? "spot_only",
    competitionContract: process.env.COMPETITION_CONTRACT_ADDRESS ?? "0x212c61b9b72c95d95bf29cf032f5e5635629aed5",
  };
});

app.post("/kill", async (req, reply) => {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (!killSwitch.authenticate(token)) {
    return reply.code(401).send({ ok: false, error: "unauthorized" });
  }
  killSwitch.engage(Date.now());
  const flag = writeKillFlag("api");
  await sendAlert(process.env.ALERT_WEBHOOK_URL, {
    reason: "emergency_stop",
    message: "Kill-switch engaged via API — worker will halt new entries and attempt revocations.",
    timestamp: new Date().toISOString(),
  });
  app.log.warn("KILL SWITCH ENGAGED");
  return reply.send({ ok: true, killFlag: flag });
});

app.post("/alert/test", async (req, reply) => {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (!killSwitch.authenticate(token)) {
    return reply.code(401).send({ ok: false, error: "unauthorized" });
  }
  const result = await sendAlert(process.env.ALERT_WEBHOOK_URL, {
    reason: "daily_trade_at_risk",
    message: "Test alert from RUNECLAW API.",
    timestamp: new Date().toISOString(),
  });
  return reply.send({ ok: true, delivery: result });
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`RUNECLAW API listening on :${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
