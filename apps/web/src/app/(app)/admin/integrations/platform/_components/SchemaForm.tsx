"use client";

import { useTranslations, useLocale } from "next-intl";
import { Field, Input, Select, Textarea } from "@/app/_components/ds";
import {
  fieldHelp,
  fieldLabel,
  fieldVisible,
  type FieldDef,
  type FormValues,
  type IntegrationEnv,
  type SecretStatus,
} from "@/lib/admin/platformIntegrations";

/**
 * The provider's typed config schema rendered as a form. Secret fields are
 * write-only: they render empty, show "stored (hidden)" when a value exists,
 * and a blank submit keeps what is stored. Nothing here ever receives a secret.
 */
export function SchemaForm({
  fields,
  values,
  onValue,
  secretInputs,
  onSecretInput,
  storedSecrets,
  clearing,
  onToggleClear,
  fieldErrors,
  disabled,
}: {
  fields: readonly FieldDef[];
  values: FormValues;
  onValue: (key: string, value: string | boolean) => void;
  secretInputs: Record<string, string>;
  onSecretInput: (key: string, value: string) => void;
  storedSecrets: readonly SecretStatus[];
  clearing: readonly string[];
  onToggleClear: (key: string) => void;
  fieldErrors: Record<string, string>;
  disabled: boolean;
}) {
  const t = useTranslations("platformIntegrations");
  const locale = useLocale();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {fields.filter((f) => fieldVisible(f, values)).map((f) => {
        const label = fieldLabel(f, locale);
        const help = fieldHelp(f, locale);
        const error = fieldErrors[f.key];
        const scope = scopeNote(f.environments, t);
        const helpId = `pi-help-${f.key}`;

        if (f.type === "boolean") {
          return (
            <label key={f.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={values[f.key] === true} disabled={disabled} onChange={(e) => onValue(f.key, e.target.checked)} />
              <span>{label}</span>
            </label>
          );
        }

        const stored = storedSecrets.find((s) => s.key === f.key);
        const willClear = clearing.includes(f.key);
        return (
          <Field key={f.key} label={label} required={f.required} error={error} disabled={disabled}>
            {f.secret ? (
              <>
                {f.type === "multiline" ? (
                  <Textarea
                    value={secretInputs[f.key] ?? ""}
                    onChange={(e) => onSecretInput(f.key, e.target.value)}
                    rows={4}
                    maxLength={f.maxLength ?? 8192}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={stored?.set ? t("secret.keep") : ""}
                    aria-describedby={helpId}
                  />
                ) : (
                  <Input
                    type="password"
                    value={secretInputs[f.key] ?? ""}
                    onChange={(e) => onSecretInput(f.key, e.target.value)}
                    maxLength={f.maxLength ?? 512}
                    autoComplete="new-password"
                    placeholder={stored?.set ? t("secret.keep") : ""}
                    aria-describedby={helpId}
                  />
                )}
                <div id={helpId} className="muted" style={{ fontSize: 12, marginTop: 4, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span>{stored?.set ? `${t("secret.stored")} ${stored.masked ?? ""}` : t("secret.notSet")}</span>
                  {stored?.set && (
                    <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      <input type="checkbox" checked={willClear} disabled={disabled} onChange={() => onToggleClear(f.key)} />
                      <span>{willClear ? t("secret.willClear") : t("secret.clear")}</span>
                    </label>
                  )}
                  {scope && <span>{scope}</span>}
                </div>
              </>
            ) : f.type === "select" ? (
              <Select value={String(values[f.key] ?? "")} onChange={(e) => onValue(f.key, e.target.value)} aria-describedby={help ? helpId : undefined}>
                {!f.required && <option value="">{t("common.dash")}</option>}
                {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            ) : f.type === "multiline" ? (
              <Textarea value={String(values[f.key] ?? "")} onChange={(e) => onValue(f.key, e.target.value)} rows={3} maxLength={f.maxLength ?? 8192} aria-describedby={help ? helpId : undefined} />
            ) : (
              <Input
                type={f.type === "number" ? "number" : f.type === "url" ? "url" : "text"}
                value={String(values[f.key] ?? "")}
                onChange={(e) => onValue(f.key, e.target.value)}
                {...(f.min !== undefined ? { min: f.min } : {})}
                {...(f.max !== undefined ? { max: f.max } : {})}
                maxLength={f.type === "number" ? undefined : f.maxLength ?? 512}
                autoComplete="off"
                aria-describedby={help ? helpId : undefined}
              />
            )}
            {!f.secret && (help || scope) && (
              <div id={helpId} className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {help}{help && scope ? " " : ""}{scope}
              </div>
            )}
            {f.secret && help && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{help}</div>}
          </Field>
        );
      })}
    </div>
  );
}

function scopeNote(envs: readonly IntegrationEnv[], t: (k: string) => string): string | null {
  if (envs.length === 2) return null;
  return envs[0] === "production" ? t("scope.productionOnly") : t("scope.sandboxOnly");
}
