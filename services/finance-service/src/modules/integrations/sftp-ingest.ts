/**
 * SFTP Inbound Ingestion (CAP-057) — pulls government response/return files
 * (e.g. PFMS disbursement acknowledgements, bank return files) from an inbound
 * SFTP directory so a consumer can parse + reconcile them.
 *
 * Env-gated + fail-closed, mirroring sftp-egress:
 *   - SFTP_HOST not set        → no-op, returns [] (dev/test safe).
 *   - SFTP_HOST set but config incomplete → throws.
 *
 * Environment variables:
 *   SFTP_HOST         — inbound SFTP host
 *   SFTP_PORT         — port (default 22)
 *   SFTP_USER         — username
 *   SFTP_KEY_PATH     — PEM private key path
 *   SFTP_INBOUND_DIR  — remote directory to poll (e.g. /download/agency/AG001)
 */

import { mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pino } from "pino";
import {
  defaultSftpClientFactory,
  type SftpClientFactory,
} from "./sftp-egress.js";

const log = pino({ name: "finance:sftp-ingest" });

/** A file successfully pulled from the inbound SFTP directory. */
export interface InboundFile {
  remoteName: string;
  localPath: string;
  size: number;
}

export interface SftpInboundConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  inboundDir: string;
}

export interface FetchInboundOptions {
  /** Only pull files whose name matches (RegExp or substring). Default: all. */
  pattern?: RegExp | string;
  /** Local directory to download into. Default: an OS temp dir. */
  localDir?: string;
  /** Injectable client factory for tests; defaults to the real client. */
  clientFactory?: SftpClientFactory;
  /** Cap on files fetched per poll (safety). Default 100. */
  limit?: number;
}

/** Read inbound SFTP config from env; null when SFTP_HOST is absent. */
export function readInboundSftpConfig(): SftpInboundConfig | null {
  const host = process.env["SFTP_HOST"];
  if (!host) return null;
  const user = process.env["SFTP_USER"];
  const keyPath = process.env["SFTP_KEY_PATH"];
  const inboundDir = process.env["SFTP_INBOUND_DIR"];
  if (!user || !keyPath || !inboundDir) {
    throw new Error(
      "SFTP_HOST is set but SFTP_USER / SFTP_KEY_PATH / SFTP_INBOUND_DIR are missing — " +
        "all four must be configured together for inbound ingestion.",
    );
  }
  return {
    host,
    port: Number(process.env["SFTP_PORT"] ?? "22"),
    username: user,
    privateKeyPath: keyPath,
    inboundDir,
  };
}

function matches(name: string, pattern?: RegExp | string): boolean {
  if (!pattern) return true;
  return typeof pattern === "string" ? name.includes(pattern) : pattern.test(name);
}

/**
 * A remote listing entry name is attacker-influenced (a hostile or compromised
 * SFTP server controls it). Reject anything that could escape the local download
 * directory via path traversal: empty/dot names, path separators, NUL, or a `..`
 * segment. Callers skip unsafe entries rather than writing them.
 */
function isSafeRemoteName(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return false;
  if (name.split(/[\\/]/).some((seg) => seg === "..")) return false;
  return true;
}

/**
 * Fetch matching files from the inbound SFTP directory into a local dir.
 * Returns the list of downloaded files (empty when SFTP_HOST is not set).
 * Does NOT delete remote files — a caller decides archival after successful
 * parse, so a crash mid-parse never loses a return file.
 */
export async function fetchInboundFiles(opts: FetchInboundOptions = {}): Promise<InboundFile[]> {
  const cfg = readInboundSftpConfig();
  if (!cfg) {
    log.warn("SFTP_HOST not set — skipping inbound SFTP ingestion (dev/test mode)");
    return [];
  }

  const factory = opts.clientFactory ?? defaultSftpClientFactory;
  const limit = opts.limit ?? 100;
  const localDir = opts.localDir ?? join(tmpdir(), "civitas-sftp-inbound");
  await mkdir(localDir, { recursive: true });

  const privateKey = await readFile(cfg.privateKeyPath);
  const client = await factory();
  const fetched: InboundFile[] = [];

  try {
    await client.connect({ host: cfg.host, port: cfg.port, username: cfg.username, privateKey });
    const entries = await client.list(cfg.inboundDir);
    const files = entries.filter((e) => e.type === "-" && matches(e.name, opts.pattern)).slice(0, limit);

    const localRoot = resolve(localDir);
    for (const f of files) {
      // The remote server controls f.name; never let it escape localDir.
      if (!isSafeRemoteName(f.name)) {
        log.warn({ name: f.name }, "Skipping unsafe inbound SFTP file name (path traversal)");
        continue;
      }
      const remotePath = `${cfg.inboundDir.replace(/\/$/, "")}/${f.name}`;
      const localPath = join(localDir, f.name);
      // Belt-and-braces: assert the resolved destination is still under localRoot.
      const resolvedLocal = resolve(localPath);
      if (resolvedLocal !== localRoot && !resolvedLocal.startsWith(localRoot + sep)) {
        log.warn({ name: f.name, resolvedLocal }, "Skipping inbound SFTP file — resolves outside localDir");
        continue;
      }
      log.info({ remotePath, localPath }, "Downloading inbound SFTP file");
      await client.get(remotePath, localPath);
      fetched.push({ remoteName: f.name, localPath, size: f.size });
    }
    return fetched;
  } finally {
    await client.end();
  }
}
