import { execSync } from "node:child_process";
import { resolve } from "node:path";

const COMPOSE_FILE = resolve(__dirname, "docker-compose.e2e.yml");
const GATEWAY_URL = "http://localhost:8080/health";
const MAX_WAIT_MS = 90_000;
const POLL_INTERVAL_MS = 3_000;

async function waitForGateway(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const res = await fetch(GATEWAY_URL);
      if (res.status === 200) {
        console.log("[e2e-live] Gateway is ready.");
        return;
      }
    } catch {
      // Service not up yet, keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `[e2e-live] Gateway did not become ready within ${MAX_WAIT_MS / 1000}s`
  );
}

async function globalSetup(): Promise<void> {
  console.log("[e2e-live] Starting Docker Compose...");
  execSync(
    `docker compose -f "${COMPOSE_FILE}" -p civitasone-e2e up -d --build --wait`,
    { stdio: "inherit", timeout: 180_000 }
  );

  console.log("[e2e-live] Waiting for gateway to be ready...");
  await waitForGateway();
  console.log("[e2e-live] All services ready. Starting tests.");
}

export default globalSetup;
