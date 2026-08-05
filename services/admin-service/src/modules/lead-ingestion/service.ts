/**
 * lead-ingestion service — one file-sweep for a tenant×env sftp connector.
 *
 * Ties the pieces together: read the connector row (integration-settings) →
 * openSecrets(privateKey) → sweepConnector (injectable SFTP client + CRM poster,
 * idempotent via the ledger) → record the run + per-file dead-letters. A
 * connect/list failure marks the run `failed`, writes a dead-letter and returns
 * (never throws) so the scheduler is never wedged.
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import * as settingsRepo from "../integration-settings/repo.js";
import { openSecrets } from "../integration-settings/domain.js";
import { recordDeadLetter } from "../integration-ops/service.js";
import * as repo from "./repo.js";
import { makeCrmPoster } from "./crm-client.js";
import {
  sweepConnector,
  defaultSftpClientFactory,
  type SftpClientFactory,
  type SftpIngestConfig,
  type SweepResult,
} from "./sftp-ingest.js";
import type { ColumnMapping, MappedContact, LeadField } from "./parse.js";

const log = pino({ name: "admin:lead-ingestion" });
const DLQ_TOPIC = "admin.sftp_lead_ingestion.file";

export interface RunDeps {
  clientFactory?: SftpClientFactory;
  /** override the CRM poster (tests inject a fake); defaults to the real internal-seam client. */
  crmPost?: (contacts: MappedContact[]) => Promise<number>;
  correlationId?: string;
}

export interface RunOutcome {
  status: "succeeded" | "partial" | "failed" | "skipped";
  runId?: string;
  reason?: string;
  error?: string;
  summary?: SweepResult;
}

const VALID_FIELDS: readonly LeadField[] = ["name", "email", "mobile", "company", "city"];

/** Read + normalise the non-secret connector config, applying documented defaults. */
export function readConnectorConfig(config: Record<string, unknown>): { sftp: SftpIngestConfig; leadSource: boolean } {
  const host = String(config.host ?? "");
  const port = Number(config.port ?? 22);
  const username = String(config.username ?? "");
  const inboundPath = String(config.inboundPath ?? "/inbound");
  const filePattern = String(config.filePattern ?? "*.csv");
  const archiveRaw = config.archivePath;
  const archivePath = typeof archiveRaw === "string" && archiveRaw.trim() !== "" ? archiveRaw : undefined;
  const leadSource = config.leadSource === true || config.leadSource === "true";
  const leadSourceLabel = String(config.leadSourceLabel ?? "sftp");
  const columnMapping: ColumnMapping = {};
  const rawMap = config.columnMapping;
  if (rawMap && typeof rawMap === "object") {
    for (const [col, field] of Object.entries(rawMap as Record<string, unknown>)) {
      if (typeof field === "string" && (VALID_FIELDS as readonly string[]).includes(field)) {
        columnMapping[col] = field as LeadField;
      }
    }
  }
  return {
    sftp: { host, port, username, inboundPath, filePattern, archivePath, leadSourceLabel, columnMapping },
    leadSource,
  };
}

async function deadLetter(tenantId: string, env: string, filename: string, error: string, correlationId: string): Promise<void> {
  try {
    await recordDeadLetter(
      { tenantId },
      {
        topic: DLQ_TOPIC,
        messageId: `sftp:${env}:${filename}`,
        sourceService: "admin",
        correlationId,
        payload: { env, filename, provider: "sftp" },
        error: error.slice(0, 4000),
      },
    );
  } catch (err) {
    // A dead-letter write failure must never wedge the sweep/scheduler.
    log.error({ err, tenantId, env, filename }, "failed to write sftp ingest dead-letter");
  }
}

/**
 * Run one file-sweep for (tenantId, env). Discovers the connector, runs the
 * sweep, records the run + dead-letters. Returns an outcome; never throws.
 */
export async function runIngestion(tenantId: string, env: string, deps: RunDeps = {}): Promise<RunOutcome> {
  const correlationId = deps.correlationId ?? randomUUID();
  return runWithTenant(tenantId, async (): Promise<RunOutcome> => {
    const row = await settingsRepo.findSetting(tenantId, "sftp", env);
    if (!row || !row.enabled) return { status: "skipped", reason: "connector_not_enabled" };
    const { sftp, leadSource } = readConnectorConfig(row.config ?? {});
    if (!leadSource) return { status: "skipped", reason: "not_a_lead_source" };
    if (!sftp.host || !sftp.username) return { status: "skipped", reason: "connector_incomplete" };

    let secrets: Record<string, string>;
    try {
      secrets = openSecrets(row.secretCiphertext);
    } catch (err) {
      return { status: "skipped", reason: `secret_unavailable: ${(err as Error).message}` };
    }

    const run = await repo.insertRun(tenantId, env);
    const crmPost = deps.crmPost ?? makeCrmPoster(tenantId, sftp.leadSourceLabel, correlationId);

    try {
      const result = await sweepConnector(sftp, secrets, {
        clientFactory: deps.clientFactory ?? defaultSftpClientFactory,
        crmPost,
        isIngested: (filename, checksum) => repo.isIngested(tenantId, env, filename, checksum),
        markIngested: (f) => repo.recordIngestedFile(tenantId, env, { ...f, runId: run.id }),
      });

      for (const fe of result.fileErrors) {
        await deadLetter(tenantId, env, fe.filename, fe.error, correlationId);
      }
      const status: RunOutcome["status"] = result.fileErrors.length > 0 ? "partial" : "succeeded";
      const errText = result.fileErrors.length > 0
        ? result.fileErrors.map((e) => `${e.filename}: ${e.error}`).join("; ").slice(0, 4000)
        : null;
      await repo.finishRun(tenantId, run.id, {
        status,
        filesSeen: result.filesSeen,
        rowsTotal: result.rowsTotal,
        rowsCreated: result.rowsCreated,
        rowsFailed: result.rowsFailed,
        error: errText,
      });
      return { status, runId: run.id, summary: result };
    } catch (err) {
      // Connect/list/transport failure — the whole sweep failed.
      const msg = (err as Error).message;
      log.error({ err, tenantId, env }, "sftp lead ingestion run failed");
      await repo.finishRun(tenantId, run.id, {
        status: "failed", filesSeen: 0, rowsTotal: 0, rowsCreated: 0, rowsFailed: 0, error: msg.slice(0, 4000),
      });
      await deadLetter(tenantId, env, "(connect)", msg, correlationId);
      return { status: "failed", runId: run.id, error: msg };
    }
  }) as Promise<RunOutcome>;
}
