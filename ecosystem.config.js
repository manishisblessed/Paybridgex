module.exports = {
  apps: [
    {
      name: "paybridgex",
      script: "node_modules/.bin/next",
      args: "start -p 3000",
      cwd: "/home/ubuntu/paybridgex",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/home/ubuntu/logs/paybridgex-error.log",
      out_file: "/home/ubuntu/logs/paybridgex-out.log",
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      // Background queue worker (pg-boss): payout initiation + reconciliation.
      // Single instance (fork) — pg-boss handles concurrency internally and a
      // single scheduler avoids duplicate cron fan-out.
      name: "paybridgex-worker",
      script: "node_modules/.bin/tsx",
      args: "scripts/worker.ts",
      cwd: "/home/ubuntu/paybridgex",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "384M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/home/ubuntu/logs/paybridgex-worker-error.log",
      out_file: "/home/ubuntu/logs/paybridgex-worker-out.log",
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
