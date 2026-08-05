/**
 * lead-ingestion — SFTP INGRESS engine (the counterpart to finance-service's
 * sftp-egress). Mirrors that module's shape exactly: a minimal injectable
 * `SftpClientLike` interface + a lazy default factory that imports the real
 * `ssh2-sftp-client` only on the prod path, so the whole sweep is unit-testable
 * with an injected fake — no live SFTP server and no real ssh2 import in tests.
 */
import { createHash } from "node:crypto";
import { pino } from "pino";
import { parseFile, mapAndValidate, type ColumnMapping, type MappedContact } from "./parse.js";
import { isBlockedHost } from "../../shared/ssrf-guard.js";

const log = pino({ name: "admin:sftp-ingest" });

/**
 * Minimal surface of `ssh2-sftp-client` the ingress path depends on. Declaring
 * it here lets the sweep be exercised with an injected fake.
 */
export interface SftpClientLike {
  connect(opts: { host: string; port: number; username: string; privateKey: string | Buffer }): Promise<unknown>;
  list(remoteDir: string): Promise<Array<{ name: string; size: number; type: string }>>;
  /** Download a remote file to an in-memory Buffer (ssh2-sftp-client returns a Buffer when no dst is given). */
  get(remotePath: string): Promise<Buffer>;
  mkdir(remoteDir: string, recursive?: boolean): Promise<unknown>;
  rename(fromPath: string, toPath: string): Promise<unknown>;
  end(): Promise<unknown>;
}

export type SftpClientFactory = () => Promise<SftpClientLike>;

/** Default factory: lazily import the real ssh2-sftp-client (prod path only). */
export const defaultSftpClientFactory: SftpClientFactory = async () => {
  try {
    const mod = (await import("ssh2-sftp-client")) as { default: new () => SftpClientLike };
    return new mod.default();
  } catch {
    throw new Error(
      "ssh2-sftp-client is not installed. It is a declared dependency; run the package install before enabling SFTP lead ingestion.",
    );
  }
};

/** Non-secret connector config the ingress engine reads. */
export interface SftpIngestConfig {
  host: string;
  port: number;
  username: string;
  inboundPath: string;
  filePattern: string;
  archivePath?: string | undefined;
  leadSourceLabel: string;
  columnMapping: ColumnMapping;
}

export interface SweepDeps {
  clientFactory: SftpClientFactory;
  /** POST a batch (<=500) of mapped contacts to the CRM internal seam. Returns count accepted. */
  crmPost: (contacts: MappedContact[]) => Promise<number>;
  /** Idempotency: has this (filename,checksum) already been ingested for the tenant? */
  isIngested: (filename: string, checksum: string) => Promise<boolean>;
  /** Record a file as ingested (writes the idempotency ledger row). */
  markIngested: (f: { filename: string; checksum: string; sizeBytes: number }) => Promise<void>;
}

export interface SweepResult {
  filesSeen: number;
  filesIngested: number;
  filesSkipped: number;
  rowsTotal: number;
  rowsCreated: number;
  rowsFailed: number;
  fileErrors: Array<{ filename: string; error: string }>;
}

const MAX_BATCH = 500;
// Cap on a single downloaded file (env-overridable). A larger file is skipped as
// a per-file error rather than buffered whole into the shared worker's memory
// (both client.get and exceljs load the file entirely) — one oversized file must
// never OOM the worker and stall every tenant's sweep.
const MAX_FILE_BYTES = Number(process.env.SFTP_INGEST_MAX_FILE_BYTES ?? 25 * 1024 * 1024);

/** Translate a simple glob (`*`, `?`) into an anchored, case-insensitive RegExp. */
export function globToRegExp(pattern: string): RegExp {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${esc}$`, "i");
}

function joinRemote(dir: string, name: string): string {
  return `${dir.replace(/\/$/, "")}/${name}`;
}

/**
 * Sweep one connector: connect → list inboundPath (filtered by filePattern) →
 * for each NOT-already-ingested file: download → parse → map+validate → POST to
 * CRM in batches ≤500 → mark ingested → archive/rename. A per-file download/parse
 * error is isolated (recorded in fileErrors, that file left in place) and does
 * NOT abort the sweep. A connect/list failure THROWS (the caller marks the run
 * failed + dead-letters + must not wedge the scheduler).
 */
export async function sweepConnector(cfg: SftpIngestConfig, secrets: Record<string, string>, deps: SweepDeps): Promise<SweepResult> {
  const result: SweepResult = { filesSeen: 0, filesIngested: 0, filesSkipped: 0, rowsTotal: 0, rowsCreated: 0, rowsFailed: 0, fileErrors: [] };
  const privateKey = secrets.privateKey;
  if (!privateKey) throw new Error("sftp connector has no privateKey secret configured");

  // SSRF guard (re-checked EVERY run — a connector's host can change without a
  // re-test): resolve cfg.host and refuse if it maps to a private/loopback/
  // link-local/metadata address, mirroring providers.ts tcpGreeting(). Done
  // BEFORE any client is created so a blocked host never opens a socket — this
  // shuts the scheduled internal-network port-scan oracle a tenant_admin could
  // otherwise arm by saving host=169.254.169.254 (etc.) on an enabled lead source.
  if (await isBlockedHost(cfg.host)) {
    throw new Error(`sftp host is not permitted (blocked address): ${cfg.host}`);
  }

  const client = await deps.clientFactory();
  const re = globToRegExp(cfg.filePattern || "*.csv");
  try {
    await client.connect({ host: cfg.host, port: cfg.port, username: cfg.username, privateKey });

    const entries = await client.list(cfg.inboundPath);
    const files = entries.filter((e) => e.type === "-" && re.test(e.name));
    result.filesSeen = files.length;

    if (cfg.archivePath) {
      // Best-effort ensure the archive dir exists; ignore if it already does.
      try { await client.mkdir(cfg.archivePath, true); } catch { /* exists / race — ignore */ }
    }

    for (const f of files) {
      const remotePath = joinRemote(cfg.inboundPath, f.name);
      try {
        // Guard the shared worker's memory: skip an oversized file (recorded as a
        // per-file error) BEFORE downloading it — never buffer it into RAM.
        if (f.size > MAX_FILE_BYTES) {
          throw new Error(`file exceeds max size ${MAX_FILE_BYTES} bytes (was ${f.size})`);
        }
        const buf = await client.get(remotePath);
        const checksum = createHash("sha256").update(buf).digest("hex");

        if (await deps.isIngested(f.name, checksum)) {
          result.filesSkipped++;
          continue; // idempotent: same name+content already processed — do not re-import.
        }

        const rows = await parseFile(f.name, buf);
        const { contacts, bad } = mapAndValidate(rows, cfg.columnMapping);
        const dataRowCount = Math.max(rows.length - 1, 0);
        result.rowsTotal += dataRowCount;
        result.rowsFailed += bad.length;

        // Ship valid contacts in batches of <=500.
        for (let i = 0; i < contacts.length; i += MAX_BATCH) {
          const batch = contacts.slice(i, i + MAX_BATCH);
          if (batch.length === 0) continue;
          const accepted = await deps.crmPost(batch);
          result.rowsCreated += accepted;
        }

        // Only mark ingested + archive AFTER a clean download/parse/post.
        await deps.markIngested({ filename: f.name, checksum, sizeBytes: f.size });
        await archiveFile(client, cfg, f.name, remotePath);
        result.filesIngested++;
      } catch (err) {
        // Isolate a single file's failure: record it, leave the file in place
        // for a later retry, and keep sweeping the rest.
        const msg = (err as Error).message;
        log.warn({ err, file: f.name }, "sftp file ingest failed");
        result.fileErrors.push({ filename: f.name, error: msg });
      }
    }
    return result;
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
}

/** Move a processed file to archivePath, or rename it with a `.done` suffix in place. */
async function archiveFile(client: SftpClientLike, cfg: SftpIngestConfig, name: string, remotePath: string): Promise<void> {
  const dest = cfg.archivePath ? joinRemote(cfg.archivePath, name) : `${remotePath}.done`;
  await client.rename(remotePath, dest);
}
