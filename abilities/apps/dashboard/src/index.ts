import http from "node:http";

export function getPort(): number {
  const raw = process.env.DASHBOARD_PORT ?? "3000";
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? 3000 : value;
}

export function buildDashboardPayload(mode: "serve" | "invoke") {
  return {
    ability: "dashboard",
    mode,
    port: getPort(),
    status: "ready",
  };
}

function startServer(): void {
  const port = getPort();
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(buildDashboardPayload("serve"), null, 2));
  });

  server.listen(port, () => {
    console.log(`Hermes dashboard listening on http://localhost:${port}`);
  });
}

function invoke(): void {
  console.log(JSON.stringify(buildDashboardPayload("invoke"), null, 2));
}

const mode = process.argv[2] ?? "invoke";

if (mode === "serve") {
  startServer();
} else if (mode === "invoke") {
  invoke();
} else {
  console.error(`Unsupported mode: ${mode}`);
  process.exitCode = 1;
}
