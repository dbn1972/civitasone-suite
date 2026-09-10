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
 *   - UNEXPLAINED_MISMATCH     a config row for this tenant/structure/code
 *                              still exists, but stored amount matches
 *                              neither the correct nor the buggy formula (or
 *                              the row now has no pct_of_basic to compute
 *                              from at all) -- usually means pct_of_basic
 *                              was edited after the slip was computed. Needs
 *                              manual look.
 *   - NO_CURRENT_CONFIG        the slip's component `code` has NO matching
 *                              row AT ALL in payroll.payroll_components for
 *                              that tenant_id + structure_id -- i.e. the
 *                              config entry was deleted (or the code was
 *                              renamed/moved to a different structure) after
 *                              the slip was computed. This is a STRUCTURAL
 *                              check: it fires regardless of magnitude and
 *                              regardless of what pct_of_basic used to be,
 *                              specifically so a low-percentage bug (e.g.
 *                              pctOfBasic=0.5%, inflated 100x to 50% of
 *                              basic -- still under the IMPLAUSIBLE_MAGNITUDE
 *                              100%-of-basic threshold below) can't hide
 *                              behind a config edit/deletion. There is no
 *                              history table for payroll_components, so this
 *                              existence check -- not a value comparison --
 *                              is the only way to catch "component config
 *                              no longer exists to check against." Needs
 *                              manual look; counted as actionable (see exit
 *                              code below), same as CONFIRMED_BUG_SIGNATURE.
 *
 * Independently of any components-table join (which only reflects the
 * *current* structure, not what it was when the slip was computed), it also
 * flags IMPLAUSIBLE_MAGNITUDE: any single non-BASIC/DA/HRA component whose
 * amountMinor exceeds the slip's own basic_minor. A single allowance or
 * deduction component worth more than 100% of basic pay is not a plausible
 * real value for any known component type in this schema and is the
 * dimensional signature this exact bug would leave when pctOfBasic >= 1%
 * (>= 100% of basic once inflated 100x). NOTE: this magnitude check alone
 * does NOT survive a structure being edited/deleted after the fact combined
 * with a pctOfBasic below ~1% -- that combination is exactly what
 * NO_CURRENT_CONFIG above exists to catch; the two checks are complementary,
 * not redundant.
 *
 * IMPORTANT -- Row Level Security:
 *   payroll.payroll_runs / payroll_slips / payroll_components are all
 *   `FORCE ROW LEVEL SECURITY` (migrations 0015/0017/0026). The ordinary
 *   `payroll_svc` app role is NOBYPASSRLS -- connecting as it with no
 *   `app.tenant_id` GUC set returns ZERO rows from every one of these
 *   tables, for every tenant, *silently*. That is not "no data found", it's
 *   "you didn't ask any tenant". This script REFUSES to run unless the
 *   connected role has `rolbypassrls`, e.g. the dedicated `payroll_audit_scanner`
 *   role (migration 0040_payroll_audit_scanner_role.sql; read-only SELECT on
 *   schema `payroll` only) or a superuser -- it checks `pg_roles.rolbypassrls`
 *   for `current_user` before querying anything else and aborts loudly if
 *   it's false.
 *
 *   NOTE: the pre-existing `payroll_scanner` role (migration
 *   0032_payroll_scanner_role.sql) is BYPASSRLS but is deliberately scoped
 *   to `_outbox`/`_inbox` only for the outbox relay/purge maintenance loops
 *   (see services/payroll-service/src/shared/scanner-db.ts) -- it has NO
 *   grant on schema `payroll` and connecting this script with it fails with
 *   "permission denied for schema payroll". Use `payroll_audit_scanner`
 *   instead; do not widen `payroll_scanner`'s grants to make it work, that
 *   would break its documented "never touches business tables" boundary
 *   (enforced by tests/outbox-inbox-rls.static.test.ts).
 *
 * This script is READ-ONLY. It issues SELECT statements only.
 *
 * Usage:
 *   cd services/payroll-service
 *   PAYROLL_SCANNER_DATABASE_URL=postgres://payroll_audit_scanner:...@host:5432/civitas_payroll \
 *     npx tsx scripts/audit/dom-018-pctofbasic-check.mjs
 *
 *   (the env var name is kept generic/unchanged; it just needs to point at a
 *   BYPASSRLS role with SELECT on schema payroll -- falls back to
 *   DATABASE_URL if unset, only safe if that connection is itself a
 *   BYPASSRLS role, e.g. local dev superuser; the role check above will
 *   refuse it otherwise)
 *
 * Exit code: 1 if any CONFIRMED_BUG_SIGNATURE, NO_CURRENT_CONFIG, or
 * IMPLAUSIBLE_MAGNITUDE rows are found (so this is CI/cron-able), 0
 * otherwise. UNEXPLAINED_MISMATCH (config row still exists) is reported but
 * does not by itself fail the exit code.
 */
import { createSqlClient } from "@civitasone/db";

const BUG_INTRODUCED_AT = new Date("2026-08-18T18:59:54Z"); // commit 6e14ffa1
const BUG_FIXED_AT = new Date("2026-09-08T13:31:25Z"); // PR #1110 / commit 564fa877
// BASIC/DA/HRA are computed by dedicated logic in computeSlip() (domain.ts),
// never from payroll_components. LOP/LOAN_EMI (domain.ts's RECOVERY_CODES,
// pushed in consumer.ts's floor-protection loop) and ARREAR/ARREAR_RECOVERY/
// BONUS/REIMB (consumer.ts's ad-hoc arrears/bonus/reimbursement components,
// pulled from payroll_arrears/payroll_reimbursements, not payroll_components)
// are ALL appended to a slip's `components` array by a code path that never
// consults payroll_components at all (see domain.ts's "Ad-hoc components"
// loop, appended after -- not through -- the pctOfBasic-driven raw-component
// loop). None of these six were ever eligible for the REL-009 100x bug, and
// none will EVER have a payroll_components row to join against, in any
// tenant, at any time -- so without this exclusion the NO_CURRENT_CONFIG
// check below would misfire on every single slip with a LOP/loan/arrears/
// bonus/reimbursement line (confirmed against the 1,088-slip shared dev DB:
// 266 false NO_CURRENT_CONFIG hits, all LOP, before this set was added).
const EXCLUDED_CODES = new Set([
  "BASIC", "DA", "HRA",
  "LOP", "LOAN_EMI", "ARREAR", "ARREAR_RECOVERY", "BONUS", "REIMB",
]);

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
          "misreport as \"no affected runs found\". Connect as the payroll_audit_scanner " +
          "role (migration 0040_payroll_audit_scanner_role.sql) or a superuser instead " +
          "-- NOT payroll_scanner, which has no grant on schema payroll. Aborting.",
      );
      process.exitCode = 2;
      return;
    }

    // Fetch EVERY current payroll_components row (not just pct_of_basic ones)
    // for non-BASIC/DA/HRA codes. This is deliberately unfiltered on
    // pct_of_basic: the componentMap's *key presence* (a row exists at all
    // for this tenant/structure/code) is itself a signal, independent of
    // what pct_of_basic currently holds -- see NO_CURRENT_CONFIG below.
    const components = await sql`
      SELECT tenant_id, structure_id, code, pct_of_basic
      FROM payroll.payroll_components
      WHERE code NOT IN ('BASIC', 'DA', 'HRA')
    `;
    const componentMap = new Map(
      components.map((c) => [`${c.tenant_id}:${c.structure_id}:${c.code}`, c.pct_of_basic]),
    );
    const pctOfBasicComponents = components.filter(
      (c) => c.pct_of_basic !== null && Number(c.pct_of_basic) > 0,
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
        const hasConfigRow = componentMap.has(key);
        const pctOfBasic = componentMap.get(key);

        let classification = null;
        if (!hasConfigRow) {
          // STRUCTURAL check (Finding 1 fix): no payroll_components row
          // exists at all for this tenant/structure/code -- the config was
          // deleted (or moved/renamed) after this slip was computed. We
          // cannot run the formula cross-check without a pct_of_basic to
          // compare against, so this is flagged unconditionally, regardless
          // of magnitude -- unlike IMPLAUSIBLE_MAGNITUDE below, a low
          // pctOfBasic (e.g. 0.5%, which even 100x-inflated stays under the
          // 100%-of-basic magnitude threshold) cannot make this pass clean.
          classification = "NO_CURRENT_CONFIG";
        } else if (pctOfBasic === null || Number(pctOfBasic) === 0) {
          // A config row exists for this code, but it no longer has a
          // pct_of_basic to check against (e.g. edited to a flat/fixed
          // amount, or to a formula, after the slip was computed). Same
          // reasoning as NO_CURRENT_CONFIG: can't clear or convict by
          // formula, so don't silently pass it.
          classification = "UNEXPLAINED_MISMATCH";
        } else {
          const correct = correctAmount(basicMinor, pctOfBasic);
          const buggy = buggyAmount(basicMinor, pctOfBasic);
          if (buggy !== correct && amountMinor === buggy) classification = "CONFIRMED_BUG_SIGNATURE";
          else if (amountMinor === correct) classification = "OK";
          else classification = "UNEXPLAINED_MISMATCH";
        }

        const implausible = basicMinor > 0n && amountMinor > basicMinor;

        if (
          classification === "CONFIRMED_BUG_SIGNATURE" ||
          classification === "NO_CURRENT_CONFIG" ||
          classification === "UNEXPLAINED_MISMATCH" ||
          implausible
        ) {
          findings.push({
            classification: classification === "CONFIRMED_BUG_SIGNATURE" ? classification
              : classification === "NO_CURRENT_CONFIG" ? classification
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
    const noCurrentConfig = findings.filter((f) => f.classification === "NO_CURRENT_CONFIG");
    const unexplained = findings.filter((f) => f.classification === "UNEXPLAINED_MISMATCH");

    console.log(JSON.stringify(
      {
        summary: {
          slips_scanned: slips.length,
          runs_scanned: new Set(slips.map((s) => s.run_id)).size,
          tenants_with_pct_of_basic_components_configured_now: new Set(pctOfBasicComponents.map((c) => c.tenant_id)).size,
          confirmed_bug_signature_count: confirmed.length,
          implausible_magnitude_count: implausible.length,
          no_current_config_count: noCurrentConfig.length,
          unexplained_mismatch_count: unexplained.length,
        },
        confirmed_bug_signature: confirmed,
        implausible_magnitude: implausible,
        no_current_config: noCurrentConfig,
        unexplained_mismatch: unexplained,
      },
      null,
      2,
    ));

    if (
      confirmed.length === 0 &&
      implausible.length === 0 &&
      noCurrentConfig.length === 0 &&
      unexplained.length === 0
    ) {
      console.log(
        "\nNo affected runs found in this environment: no persisted payroll_slips component " +
          "amount matches the REL-009 100x-buggy formula, no component amount exceeds its own " +
          "slip's basic pay, and every non-BASIC/DA/HRA component code on every slip still has a " +
          "matching payroll_components config row today. This clears every payroll run *this " +
          "script can see* -- it does not by itself clear production if this was not run against " +
          "production.",
      );
    }

    // NO_CURRENT_CONFIG is actionable, not merely informational: it is the
    // structural check that exists specifically because a low-pctOfBasic +
    // later-edited/deleted config combination produces zero evidence in the
    // formula and magnitude checks alone (see header comment). Treat it the
    // same as CONFIRMED_BUG_SIGNATURE / IMPLAUSIBLE_MAGNITUDE for exit code
    // purposes so this tool cannot report a false-clean result via a
    // deleted/orphaned config. UNEXPLAINED_MISMATCH (config row still
    // present) remains informational-only, as before.
    process.exitCode =
      confirmed.length > 0 || implausible.length > 0 || noCurrentConfig.length > 0 ? 1 : 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 2;
});
