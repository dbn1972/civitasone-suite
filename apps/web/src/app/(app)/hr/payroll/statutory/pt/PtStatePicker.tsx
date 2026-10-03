"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Field, Select } from "../../../../../_components/ds";
import { INDIAN_STATES_UTS } from "@/lib/india/states";

/** GAP-PAYROLL-STATUTORY-PT-04: pick the state / UT whose slab versions are shown. */
export function PtStatePicker({ selected, configured }: { selected: string | null; configured: string[] }) {
  const t = useTranslations("pt");
  const router = useRouter();
  const has = new Set(configured);
  return (
    <div style={{ maxWidth: 360, marginBottom: 16 }}>
      <Field label={t("statePickerLabel")}>
        <Select
          value={selected ?? ""}
          onChange={(e) => {
            const code = e.target.value;
            router.push(code ? `/hr/payroll/statutory/pt?state=${encodeURIComponent(code)}` : "/hr/payroll/statutory/pt");
          }}
          style={{ minHeight: 44 }}
        >
          <option value="">{t("statePickerPlaceholder")}</option>
          {INDIAN_STATES_UTS.map((st) => (
            <option key={st.code} value={st.code}>
              {has.has(st.code) ? t("statePickerConfigured", { name: st.name, code: st.code }) : `${st.name} (${st.code})`}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
