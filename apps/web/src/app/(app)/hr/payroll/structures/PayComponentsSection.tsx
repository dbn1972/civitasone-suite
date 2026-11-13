"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "../../../../_components/ds";
import { CreateTemplateForm } from "./CreateTemplateForm";
import type { TemplateRow } from "./payComponentsData";

type StructureLite = { id: string; name: string; status: string };

/** Section 8 G2: entry to the component admin screens. The page renders this only when the feature is enabled. */
export function PayComponentsSection({ structures, templates, canWrite }: { structures: StructureLite[]; templates: TemplateRow[]; canWrite: boolean }) {
  const t = useTranslations("payComponents");
  return (
    <section aria-labelledby="pay-components-heading">
      <h2 id="pay-components-heading" style={{ fontSize: 18, margin: "24px 0 8px" }}>{t("sectionTitle")}</h2>
      <p style={{ color: "var(--ink2)", marginTop: 0 }}>{t("sectionHelp")}</p>
      {canWrite && <CreateTemplateForm />}
      <Card title={t("templatesTitle")}>
        {templates.length === 0 ? (
          <p className="pad" style={{ color: "var(--ink2)" }}>{t("noTemplates")}</p>
        ) : (
          <ul className="pad" style={{ margin: 0, paddingInlineStart: 20 }}>
            {templates.map((tpl) => (
              <li key={tpl.id} style={{ minHeight: 32 }}>
                <Link href={`/hr/payroll/structures/${tpl.id}/components`}>{tpl.name}</Link>
                {" "}
                {t("templateMeta", { version: tpl.templateVersion, count: tpl.activeComponents, from: tpl.effectiveFrom ?? "—" })}
                {tpl.isLocked ? ` · ${t("lockedTag")}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t("structuresTitle")}>
        {structures.length === 0 ? (
          <p className="pad" style={{ color: "var(--ink2)" }}>{t("noStructures")}</p>
        ) : (
          <ul className="pad" style={{ margin: 0, paddingInlineStart: 20 }}>
            {structures.map((s) => (
              <li key={s.id} style={{ minHeight: 32 }}>
                <Link href={`/hr/payroll/structures/${s.id}/components`}>{t("manageLink", { name: s.name })}</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
