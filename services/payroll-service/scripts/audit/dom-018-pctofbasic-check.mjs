#!/usr/bin/env node
/**
 * DOM-018 audit — was any real payroll run computed with the REL-009
 * pctOfBasic 100x-inflation bug?
 *
 * Background (see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md, DOM-018/REL-009,
 * and PR #1110):
 *
 *   services/payroll-service/src/modules/payroll/domain.ts, computeSlip()'s
 *   raw-component loop computed the amount for any component with
 *   `pctOfBasic` set (and > 0, code not BASIC/DA/HRA -- those are computed
 *   elsewhere) as:
 *
 *       roundRupee((basicMinor * BigInt(Math.round(pctOfBasic * 100))) / 100n)   // BUGGY
 *
 *   instead of the correct:
 *
 *       roundRupee((basicMinor * BigInt(Math.round(pctOfBasic * 100))) / 10_000n) // CORRECT
 *
 *   i.e. every percentage-of-basic component was computed at 100x its correct
 *   magnitude. The bug was introduced in commit 6e14ffa1 (2026-08-18T18:59:54Z)
 *   and fixed in PR #1110 / commit 564fa877 (merged 2026-09-08T13:31:25Z).
 *   BASIC/DA/HRA are excluded from this branch (computed via dedicated logic
 *   elsewhere in the same file) -- only *other*, tenant-configured
 *   percentage-of-basic components (payroll.payroll_components.pct_of_basic)
 *   could have been affected.
 *
 * What this script checks
 * ------------------------
 * For every persisted `payroll.payroll_slips` row, it re-derives what the
 * CORRECT and the BUGGY amount would have been for each component in that
 * slip's `components` jsonb array, using that component's *current*
 * `payroll.payroll_components.pct_of_basic` configuration (joined by
 * tenant_id + structure_id + code), and classifies the stored amount as:
 *
 *   - CONFIRMED_BUG_SIGNATURE  stored amount == buggy formula's output, and
 *                              buggy != correct (unambiguous evidence this
 *                              slip was computed by the broken code)
 *   - OK                       stored amount == correct formula's output
 *   - UNEXPLAINED_MISMATCH     stored amount matches neither -- usually means
 *                              the structure's pct_of_basic was edited after
 *                              the slip was computed (no history table
 *                              exists for payroll_components), so this
 *                              formula-based check can't clear or convict it.
 *                              Needs manual look.
 *
 * Independently of any components-table join (which only reflects the
 * *current* structure, not what it was when the slip was computed), it also
 * flags IMPLAUSIBLE_MAGNITUDE: any single non-BASIC/DA/HRA component whose
 * amountMinor exceeds the slip's own basic_minor. A single allowance or
 * deduction component worth more than 100% of basic pay is not a plausible
 * real value for any known component type in this schema and is the
 * dimensional signature this exact bug would leave (any pctOfBasic >= 1%
 * becomes >= 100% of basic once inflated 100x) -- this check survives a
 * structure being edited or deleted after the fact, unlike the formula
 * cross-check above.
 *
 * IMPORTANT -- Row Level Security:
 *   payroll.payroll_runs / payroll_slips / payroll_components are all
 *   `FORCE ROW LEVEL SECURITY` (migrations 0015/0017/0026). The ordinary
 *   `payroll_svc` app role is NOBYPASSRLS -- connecting as it with no
 *   `app.tenant_id` GUC set returns ZERO rows from every one of these
 *   tables, for every tenant, *silently*. That is not "no data found", it's
 *   "you didn't ask any tenant". This script REFUSES to run unless the
 *   connected role has `rolbypassrls`, e.g. the existing dedicated
 *   `payroll_scanner` role (see services/payroll-service/src/shared/scanner-db.ts)
 *   or a superuser -- it checks `pg_roles.rolbypassrls` for `current_user`
 *   before querying anything else and aborts loudly if it's false.
 *
 * This script is READ-ONLY. It issues SELECT statements only.
 *
 * Usage:
 *   cd services/payroll-service
 *   PAYROLL_SCANNER_DATABASE_URL=postgres://payroll_scanner:...@host:5432/civitas_payroll \
 *     npx tsx scripts/audit/dom-018-pctofbasic-check.mjs
 *
 *   (falls back to DATABASE_URL if PAYROLL_SCANNER_DATABASE_URL is unset --
 *   only safe if that connection is itself a BYPASSRLS role, e.g. local dev
 *   superuser; the role check above will refuse it otherwise)
 *
 * Exit code: 1 if any CONFIRMED_BUG_SIGNATURE or IMPLAUSIBLE_MAGNITUDE rows
 * are found (so this is CI/cron-able), 0 otherwise.
 */
import { createSqlClient } from "@civitasone/db";

const BUG_INTRODUCED_AT = new Date("2026-08-18T18:59:54Z"); // commit 6e14ffa1
const BUG_FIXED_AT = new Date("2026-09-08T13:31:25Z"); // PR #1110 / commit 564fa877
const EXCLUDED_CODES = new Set(["BASIC", "DA", "HRA"]);

function roundRupee(x) {
  if (x < 0n) return -roundRupee(-x);
  return ((x + 50n) / 100n) * 100n;
}

function correctAmount(basicMinor, pctOfBasic) {
  const pctBasis = BigInt(Math.round(Number(pctOfBasic) * 100));
  return roundRupee((basicMinor * pctBasis) / 10_000n);
}

function buggyAmount(basicMinor, pctOfBasic) {
  const pctBasis = BigInt(Math.round(Number(pctOfBasic) * 100));
  return roundRupee((basicMinor * pctBasis) / 100n);
}

async function main() {
  const url = process.env.PAYROLL_SCANNER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("PAYROLL_SCANNER_DATABASE_URL or DATABASE_URL is required.");
    process.exitCode = 2;
    return;
  }
  const sql = createSqlClient(url);

  try {
    const [{ rolbypassrls } = {}] = await sql`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    if (!rolbypassrls) {
      console.error(
        `Connected as "${await sql`SELECT current_user`.then((r) => r[0].current_user)}", ` +
          "which does NOT have BYPASSRLS. payroll_runs/payroll_slips/payroll_components are " +
          "FORCE ROW LEVEL SECURITY -- querying without BYPASSRLS and without an app.tenant_id " +
          "GUC set would silently return zero rows for every tenant, which this script must not " +
          "misreport as \"no affected runs found\". Connect as the payroll_scanner role " +
          "(or a superuser) instead. Aborting.",
      );
      process.exitCode = 2;
      return;
    }

    const components = await sql`
      SELECT tenant_id, structure_id, code, pct_of_basic
      FROM payroll.payroll_components
      WHERE pct_of_basic IS NOT NULL
        AND pct_of_basic > 0
        AND code NOT IN ('BASIC', 'DA', 'HRA')
    `;
    const componentMap = new Map(
      components.map((c) => [`${c.tenant_id}:${c.structure_id}:${c.code}`, c.pct_of_basic]),
    );

    const slips = await sql`
      SELECT
        s.id AS slip_id, s.tenant_id, s.run_id, s.employee_id, s.employee_no,
        s.basic_minor, s.components, s.status AS slip_status, s.created_at AS slip_created_at,
        r.run_no, r.status AS run_status, r.month, r.structure_id,
        r.approved_at, r.disbursed_at, r.created_at AS run_created_at
      FROM payroll.payroll_slips s
      JOIN payroll.payroll_runs r ON r.id = s.run_id AND r.tenant_id = s.tenant_id
      ORDER BY r.created_at
    `;

    const findings = [];
    for (const slip of slips) {
      const basicMinor = BigInt(slip.basic_minor);
      const comps = Array.isArray(slip.components) ? slip.components : [];
      for (const c of comps) {
        if (!c || typeof c !== "object" || EXCLUDED_CODES.has(c.code)) continue;
        const amountMinor = BigInt(c.amountMinor ?? c.amount_minor ?? 0);
        const key = `${slip.tenant_id}:${slip.structure_id}:${c.code}`;
        const pctOfBasic = componentMap.get(key);

        let classification = null;
        if (pctOfBasic !== undefined) {
          const correct = correctAmount(basicMinor, pctOfBasic);
          const buggy = buggyAmount(basicMinor, pctOfBasic);
          if (buggy !== correct && amountMinor === buggy) classification = "CONFIRMED_BUG_SIGNATURE";
          else if (amountMinor === correct) classification = "OK";
          else classification = "UNEXPLAINED_MISMATCH";
        }

        const implausible = basicMinor > 0n && amountMinor > basicMinor;

        if (classification === "CONFIRMED_BUG_SIGNATURE" || classification === "UNEXPLAINED_MISMATCH" || implausible) {
          findings.push({
            classification: classification === "CONFIRMED_BUG_SIGNATURE" ? classification
              : implausible ? "IMPLAUSIBLE_MAGNITUDE"
              : classification,
            tenant_id: slip.tenant_id,
            run_no: slip.run_no,
            run_status: slip.run_status,
            run_created_at: slip.run_created_at,
            in_bug_window: slip.run_created_at >= BUG_INTRODUCED_AT && slip.run_created_at < BUG_FIXED_AT,
            slip_id: slip.slip_id,
            employee_no: slip.employee_no,
            component_code: c.code,
            basic_minor: basicMinor.toString(),
            stored_amount_minor: amountMinor.toString(),
            pct_of_basic_current_config: pctOfBasic ?? null,
          });
        }
      }
    }

    const confirmed = findings.filter((f) => f.classification === "CONFIRMED_BUG_SIGNATURE");
    const implausible = findings.filter((f) => f.classification === "IMPLAUSIBLE_MAGNITUDE");
    const unexplained = findings.filter((f) => f.classification === "UNEXPLAINED_MISMATCH");

    console.log(JSON.stringify(
      {
        summary: {
          slips_scanned: slips.length,
          runs_scanned: new Set(slips.map((s) => s.run_id)).size,
          tenants_with_pct_of_basic_components_configured_now: new Set(components.map((c) => c.tenant_id)).size,
          confirmed_bug_signature_count: confirmed.length,
          implausible_magnitude_count: implausible.length,
          unexplained_mismatch_count: unexplained.length,
        },
        confirmed_bug_signature: confirmed,
        implausible_magnitude: implausible,
        unexplained_mismatch: unexplained,
      },
      null,
      2,
    ));

    if (confirmed.length === 0 && implausible.length === 0 && unexplained.length === 0) {
      console.log(
        "\nNo affected runs found in this environment: no persisted payroll_slips component " +
          "amount matches the REL-009 100x-buggy formula, and no component amount exceeds its " +
          "own slip's basic pay. This clears every payroll run *this script can see* -- it does " +
          "not by itself clear production if this was not run against production.",
      );
    }

    process.exitCode = confirmed.length > 0 || implausible.length > 0 ? 1 : 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 2;
});
