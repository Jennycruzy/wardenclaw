/**
 * pm2 process manager config for the WARDENCLAW BSC live window (§0.11).
 *
 * Both processes auto-restart with backoff and start on reboot (`pm2 startup` +
 * `pm2 save`). The worker is the trading loop; the API is the phone-reachable
 * control surface (health + kill-switch). Environment comes from the shell / .env.
 *
 *   pnpm install
 *   pm2 start ops/pm2.config.cjs
 *   pm2 save && pm2 startup
 *   pm2 logs wardenclaw-worker
 */

module.exports = {
  apps: [
    {
      name: "wardenclaw-worker",
      cwd: __dirname + "/..",
      script: "pnpm",
      args: "--filter @wardenclaw/worker start",
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      exp_backoff_restart_delay: 2000,
      kill_timeout: 15000,
      env: { NODE_ENV: "production" },
    },
    {
      name: "wardenclaw-api",
      cwd: __dirname + "/..",
      script: "pnpm",
      args: "--filter @wardenclaw/api start",
      autorestart: true,
      max_restarts: 50,
      restart_delay: 3000,
      env: { NODE_ENV: "production", API_PORT: "4000" },
    },
  ],
};
