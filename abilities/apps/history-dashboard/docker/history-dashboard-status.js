const port = Number.parseInt(process.env.PORT || process.env.HISTORY_DASHBOARD_PORT || "3000", 10);

process.stdout.write(`${JSON.stringify({
  ability: "history-dashboard",
  frontend: "nextjs",
  port: Number.isFinite(port) ? port : 3000,
  status: "ready",
})}\n`);
