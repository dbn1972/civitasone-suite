import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * SF-14 guard (b-ii): tenant-admin, knowledge, and notifications forms
 * converted to ds form primitives must not regress to bare HTML elements.
 *
 * Rules:
 *   1. No bare `<input>` (except type=radio/checkbox/hidden), `<select>`,
 *      `<textarea>`, or `<label htmlFor=...>` in JSX.
 *   2. At least one DS form primitive (Field, Input, Select, Textarea)
 *      imported from the DS barrel.
 *
 * Add the file's module-relative path to the appropriate array below
 * whenever a new form is converted.
 */

const APP = path.join(__dirname, "..", "app", "(app)");

const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Files that use Field as their primary label wrapper. */
const WITH_FIELD = [
  // tenant-admin
  "tenant-admin/notifications/channels/ChannelForm.tsx",
  "tenant-admin/domain/DomainClient.tsx",
  "tenant-admin/api-keys/APIKeyActions.tsx",
  "tenant-admin/data-export/DataExportClient.tsx",
  "tenant-admin/ai-plugins/PluginConfigControls.tsx",
  "tenant-admin/roles/RolesTable.tsx",
  "tenant-admin/roles/[id]/EditRoleButton.tsx",
  "tenant-admin/users/UsersTable.tsx",
  "tenant-admin/webhooks/WebhooksClient.tsx",
  // knowledge
  "knowledge/documents/new/CreateDocumentForm.tsx",
  "knowledge/policies/new/CreatePolicyForm.tsx",
  "knowledge/policies/[id]/PolicyActions.tsx",
  "knowledge/assistant/AssistantClient.tsx",
  "knowledge/search/SearchClient.tsx",
  // notifications
  "notifications/campaigns/_components/CampaignList.tsx",
  "notifications/compose/page.tsx",
  "notifications/templates/new/page.tsx",
];

/** Files that use standalone Input/Select (aria-label, no visible label wrapper needed). */
const STANDALONE_DS = [
  "tenant-admin/platform-config/CacheTtlEditor.tsx",
  "knowledge/faqs/FaqBrowser.tsx",
];

const DS_IMPORT_RE = /\b(?:Field|Input|Select|Textarea)\b[^;]*from\s+["'][^"']*_components\/ds["']/;
const FIELD_IMPORT_RE = /\bField\b[^;]*from\s+["'][^"']*_components\/ds["']/;

function assertNoBare(src: string): void {
  const stripped = stripComments(src);
  // bare <input not followed (within 150 chars) by type=checkbox|radio|hidden
  const rawInputs = [...stripped.matchAll(/<input\b/g)].filter((m) => {
    const snippet = stripped.slice(m.index!, m.index! + 150);
    return !/type=["'](?:checkbox|radio|hidden)["']/.test(snippet);
  });
  expect(rawInputs.map((m) => `bare <input at offset ${m.index}`)).toEqual([]);

  const rawSelects = [...stripped.matchAll(/<select\b/g)];
  expect(rawSelects.map((m) => `bare <select at offset ${m.index}`)).toEqual([]);

  const rawTextareas = [...stripped.matchAll(/<textarea\b/g)];
  expect(rawTextareas.map((m) => `bare <textarea at offset ${m.index}`)).toEqual([]);

  const rawLabelFor = [...stripped.matchAll(/<label\b[^>]*htmlFor=/g)];
  expect(rawLabelFor.map((m) => `bare <label htmlFor= at offset ${m.index}`)).toEqual([]);
}

describe("SF-14 guard (b-ii): tenant-admin + knowledge + notifications — Field forms", () => {
  it.each(WITH_FIELD)(
    "%s has no bare form elements and imports Field from ds",
    (rel) => {
      const src = readFileSync(path.join(APP, rel), "utf8");
      assertNoBare(src);
      expect(src).toMatch(FIELD_IMPORT_RE);
    },
  );
});

describe("SF-14 guard (b-ii): tenant-admin + knowledge — standalone DS inputs", () => {
  it.each(STANDALONE_DS)(
    "%s has no bare form elements and imports a DS primitive",
    (rel) => {
      const src = readFileSync(path.join(APP, rel), "utf8");
      assertNoBare(src);
      expect(src).toMatch(DS_IMPORT_RE);
    },
  );
});
