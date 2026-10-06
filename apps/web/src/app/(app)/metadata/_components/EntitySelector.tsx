"use client";

import { useRouter, usePathname } from "next/navigation";
import { Field, Select } from "@/app/_components/ds";

/**
 * GAP-METADATA-{FIELDS,RULES,RECORDS,FORMS}-03: the fields/rules/records/forms
 * pages promised "select entity to drill into …" in their subtitle but had no
 * selector, link or query param at all. This is that selector.
 *
 * The metadata-service only lists these resources entity-scoped (see _data.ts),
 * so the page needs an entity before it can show anything. Picking one pushes
 * `?entity=<id>` onto the current path; the server page re-reads searchParams
 * and loads that entity's rows. It is a tiny "use client" island (it needs
 * useRouter) that takes a plain, already-loaded `entities` list from its server
 * parent — it imports no loader/apiClient/server-only module.
 */
export interface EntityOption {
  id: string;
  label: string;
}

export function EntitySelector({
  entities,
  selected,
  resourceLabel,
}: {
  entities: EntityOption[];
  selected?: string;
  resourceLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function onChange(value: string) {
    if (!value) {
      router.push(pathname);
      return;
    }
    router.push(`${pathname}?entity=${encodeURIComponent(value)}`);
  }

  return (
    <div style={{ maxWidth: 420, marginBottom: 16 }}>
      <Field id="metadata-entity-select" label={`Entity — choose one to view its ${resourceLabel}`}>
        <Select value={selected ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select an entity…</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.label}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
