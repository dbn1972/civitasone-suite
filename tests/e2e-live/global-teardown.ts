import { execSync } from "node:child_process";
import { resolve } from "node:path";

const COMPOSE_FILE = resolve(__dirname, "docker-compose.e2e.yml");

async function globalTeardown(): Promise<void> {
  console.log("[e2e-live] Stopping Docker Compose...");
  try {
    execSync(
      `docker compose -f "${COMPOSE_FILE}" -p civitasone-e2e down --volumes --remove-orphans`,
      { stdio: "inherit", timeout: 60_000 }
    );
    console.log("[e2e-live] Docker Compose stopped.");
  } catch (err) {
    console.warn("[e2e-live] Warning: Docker Compose teardown failed:", err);
  }
}

export default globalTeardown;
