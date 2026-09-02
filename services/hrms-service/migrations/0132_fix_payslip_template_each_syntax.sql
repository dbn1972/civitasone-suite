-- Fix the seeded default payslip template: migration 0008 inserted a
-- template_html using {{#each earnings}}...{{/each}}, plus a non-standard
-- {{../deductions.[index].name}} parent-scope/array-index expression to
-- zip the earnings and deductions arrays into one shared row. But
-- renderTemplate() in payroll-service
-- (services/payroll-service/src/modules/payslip-pdf/routes.ts) only ever
-- implemented flat {{var}} substitution — no Handlebars-style block
-- helpers. The mismatch was dormant because a cross-database bug (fixed by
-- PR #909) made this seeded template completely unreachable; now that it
-- is reachable, a tenant using it gets literal unprocessed
-- "{{#each earnings}}...{{/each}}" text in generated PDFs instead of an
-- earnings/deductions breakdown.
--
-- Fix (see PR description for full Option A vs B reasoning): there is no
-- tenant-facing UI or API to author custom slip templates —
-- payroll.payroll_slip_templates is written exactly once, by this seed,
-- and is otherwise read-only (services/hrms-service/src/modules/internal/
-- routes.ts's GET /v1/hrms/internal/payroll/slip-templates/default is the
-- only consumer, and it never writes). So rather than building a
-- Handlebars-style loop/scope engine to support one hand-written template,
-- rewrite the template to only use the flat substitution the renderer
-- already supports — matching the pattern the in-code DEFAULT_TEMPLATE
-- fallback in routes.ts already uses, where earningsRows/deductionsRows/
-- pensionRows are pre-rendered to HTML strings by the caller and
-- substituted as plain flat vars.
--
-- This also splits the old single 4-column table (which zipped two
-- independently-sized arrays by index — broken by construction whenever
-- earnings and deductions have different lengths, which is the common
-- case) into two separate 2-column tables, matching the 2-cell-per-row
-- shape earningsRows/deductionsRows actually produce, and matching
-- DEFAULT_TEMPLATE's own layout. It also wires up {{footerText}} (already
-- returned by fetchDefaultSlipTemplate but never substituted into vars
-- until this same fix) and folds the PF/GPF/NPS summary into the
-- already-correct {{pensionRows}} inside the Deductions table instead of
-- the old {{pfEmployee}}/{{pfEmployer}} flat vars — those were never
-- populated by routes.ts (always rendered blank) and would have shown the
-- wrong figure for GPF/NPS-scheme tenants even if populated naively,
-- since pensionRows already picks the tenant's actual scheme.
--
-- Idempotent: only touches rows that still contain the broken {{#each
-- syntax, so re-running this migration (migrate-all.mjs replays every
-- migration file on every run) is a no-op after the first successful
-- apply, and a tenant that has since been migrated to a different, valid
-- custom template is left untouched.
UPDATE payroll.payroll_slip_templates
SET template_html = '<div class="slip">
  <header><h1>{{orgName}}</h1><h2>Pay Slip for {{month}}</h2></header>
  <table class="emp-info">
    <tr><td>Employee No</td><td>{{employeeNo}}</td><td>Name</td><td>{{employeeName}}</td></tr>
    <tr><td>Department</td><td>{{department}}</td><td>Designation</td><td>{{designation}}</td></tr>
    <tr><td>UAN</td><td>{{uan}}</td><td>PAN</td><td>{{pan}}</td></tr>
    <tr><td>Bank A/C</td><td>{{bankAccount}}</td><td>IFSC</td><td>{{bankIfsc}}</td></tr>
  </table>
  <table class="components">
    <thead><tr><th>Earnings</th><th>Amount</th></tr></thead>
    <tbody>{{earningsRows}}</tbody>
    <tfoot><tr><td><b>Gross</b></td><td><b>₹{{grossPay}}</b></td></tr></tfoot>
  </table>
  <table class="components">
    <thead><tr><th>Deductions</th><th>Amount</th></tr></thead>
    <tbody>{{deductionsRows}}
      {{pensionRows}}
    </tbody>
    <tfoot><tr><td><b>Total Deductions</b></td><td><b>₹{{totalDeductions}}</b></td></tr></tfoot>
  </table>
  <table class="components">
    <tbody><tr><td><b>Net Pay</b></td><td><b>₹{{netPay}}</b></td></tr></tbody>
  </table>
  <footer><p>{{footerText}}</p><p>This is a computer-generated slip.</p></footer>
</div>'
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND is_default = TRUE
  AND template_html LIKE '%{{#each%';
