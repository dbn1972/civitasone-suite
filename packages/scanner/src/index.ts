/**
 * Shared ClamAV malware scanner client.
 *
 * Extracted from notification-service so any upload-capable service can scan
 * file buffers against a ClamAV REST endpoint. Fail-open on scanner
 * unavailability (availability > blocking on a missing scanner).
 *
 * Env vars:
 *   CLAMAV_URL        — ClamAV REST scan endpoint (default http://localhost:3310/scan)
 *   CLAMAV_TIMEOUT_MS — Request timeout in ms (default 10000)
 */

export interface ScanResult {
  status: "clean" | "infected" | "error";
}

export interface ScannerConfig {
  url?: string;
  timeoutMs?: number;
}

function resolveConfig(config?: ScannerConfig): { url: string; timeoutMs: number } {
  return {
    url: config?.url ?? process.env.CLAMAV_URL ?? "http://localhost:3310/scan",
    timeoutMs: config?.timeoutMs ?? Number(process.env.CLAMAV_TIMEOUT_MS ?? 10_000),
  };
}

export async function scanFile(
  buffer: Buffer,
  filename: string,
  config?: ScannerConfig,
): Promise<ScanResult> {
  const { url, timeoutMs } = resolveConfig(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(buffer)]), filename);

    const res = await fetch(url, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    if (!res.ok) return { status: "error" };
    const json = (await res.json()) as { infected?: boolean; status?: string };
    if (json.infected === true || json.status === "infected") return { status: "infected" };
    return { status: "clean" };
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function scanBuffer(
  buffer: Buffer,
  config?: ScannerConfig,
): Promise<ScanResult> {
  return scanFile(buffer, "upload", config);
}
