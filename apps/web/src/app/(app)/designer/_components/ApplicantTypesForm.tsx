"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/app/_components/ds";
import {
  updateServiceDefinition,
  type ProfileAttributeBindingDto,
} from "../_data/designerApi";

const APPLICANT_TYPE_OPTIONS = [
  { id: "citizen", label: "Citizen / individual", hint: "Natural person with a citizen profile" },
  { id: "company", label: "Company", hint: "Registered company (GSTIN / CIN)" },
  { id: "institution", label: "Institution", hint: "School, hospital, NGO, or other institution" },
  { id: "anonymous", label: "Anonymous", hint: "Grievance pattern only — no identity required" },
] as const;

const REGISTRY: { key: string; label: string; types: string[] }[] = [
  { key: "fullName", label: "Full name", types: ["citizen", "anonymous"] },
  { key: "dateOfBirth", label: "Date of birth", types: ["citizen"] },
  { key: "mobile", label: "Mobile", types: ["citizen", "company", "institution", "anonymous"] },
  { key: "email", label: "Email", types: ["citizen", "company", "institution"] },
  { key: "aadhaarLast4", label: "Aadhaar (last 4)", types: ["citizen"] },
  { key: "pan", label: "PAN", types: ["citizen", "company"] },
  { key: "gstin", label: "GSTIN", types: ["company"] },
  { key: "cin", label: "CIN", types: ["company"] },
  { key: "orgName", label: "Organisation name", types: ["company", "institution"] },
  { key: "registrationNo", label: "Registration number", types: ["institution"] },
  { key: "ward", label: "Ward / zone", types: ["citizen", "company", "institution"] },
];

export interface ApplicantTypesValues {
  allowedApplicantTypes: string[];
  applicantTypeRejectMessage: string;
  profileAttributeBindings: ProfileAttributeBindingDto[];
  servicePattern: string;
}

interface Props {
  definitionId: string;
  initial: ApplicantTypesValues;
  servicePattern: string;
  onSaveState?: (state: "saving" | "saved" | "offline") => void;
}

function bindingKey(b: ProfileAttributeBindingDto): string {
  return `${b.applicantType}:${b.attributeKey}`;
}

export function ApplicantTypesForm({ definitionId, initial, servicePattern, onSaveState }: Props) {
  const [values, setValues] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValues((prev) => {
      if (servicePattern === "grievance") return { ...prev, servicePattern };
      const allowedApplicantTypes = prev.allowedApplicantTypes.filter((t) => t !== "anonymous");
      const next = {
        ...prev,
        servicePattern,
        allowedApplicantTypes: allowedApplicantTypes.length ? allowedApplicantTypes : ["citizen"],
        profileAttributeBindings: prev.profileAttributeBindings.filter((b) => b.applicantType !== "anonymous"),
      };
      return next;
    });
  }, [servicePattern]);

  const persist = useCallback(async (next: ApplicantTypesValues) => {
    onSaveState?.("saving");
    try {
      await updateServiceDefinition(definitionId, {
        allowedApplicantTypes: next.allowedApplicantTypes,
        applicantTypeRejectMessage: next.applicantTypeRejectMessage || undefined,
        profileAttributeBindings: next.profileAttributeBindings,
      });
      onSaveState?.("saved");
    } catch {
      onSaveState?.("offline");
    }
  }, [definitionId, onSaveState]);

  const scheduleSave = useCallback((next: ApplicantTypesValues) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist(next); }, 2000);
  }, [persist]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const toggleType = (id: string) => {
    if (id === "anonymous" && servicePattern !== "grievance") return;
    setValues((prev) => {
      const has = prev.allowedApplicantTypes.includes(id);
      let allowedApplicantTypes = has
        ? prev.allowedApplicantTypes.filter((t) => t !== id)
        : [...prev.allowedApplicantTypes, id];
      if (allowedApplicantTypes.length === 0) allowedApplicantTypes = ["citizen"];
      const profileAttributeBindings = prev.profileAttributeBindings.filter((b) =>
        allowedApplicantTypes.includes(b.applicantType),
      );
      const next = { ...prev, allowedApplicantTypes, profileAttributeBindings };
      scheduleSave(next);
      return next;
    });
  };

  const availableAttrs = useMemo(
    () => REGISTRY.filter((a) => a.types.some((t) => values.allowedApplicantTypes.includes(t))),
    [values.allowedApplicantTypes],
  );

  const bound = useMemo(() => new Set(values.profileAttributeBindings.map(bindingKey)), [values.profileAttributeBindings]);

  const toggleBinding = (attributeKey: string, applicantType: string) => {
    setValues((prev) => {
      const sig = `${applicantType}:${attributeKey}`;
      const exists = prev.profileAttributeBindings.some((b) => bindingKey(b) === sig);
      const profileAttributeBindings = exists
        ? prev.profileAttributeBindings.filter((b) => bindingKey(b) !== sig)
        : [...prev.profileAttributeBindings, { attributeKey, applicantType, required: true }];
      const next = { ...prev, profileAttributeBindings };
      scheduleSave(next);
      return next;
    });
  };

  return (
    <Card title="Applicant identity types" padding>
      <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
          Choose who may apply. Intake rejects mismatched profiles with your message below.
        </p>

        <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
          <legend style={{ marginBottom: 8 }}>Allowed applicant types</legend>
          <div style={{ display: "grid", gap: 10 }}>
            {APPLICANT_TYPE_OPTIONS.map((opt) => {
              const disabled = opt.id === "anonymous" && servicePattern !== "grievance";
              return (
                <label
                  key={opt.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    gap: "4px 10px",
                    alignItems: "start",
                    opacity: disabled ? 0.5 : 1,
                    fontSize: 14,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={values.allowedApplicantTypes.includes(opt.id)}
                    disabled={disabled}
                    onChange={() => toggleType(opt.id)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <strong>{opt.label}</strong>
                    <span style={{ display: "block", fontSize: 12, color: "var(--mut)" }}>
                      {disabled ? "Available only for Grievance pattern." : opt.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Rejection message</span>
          <textarea
            className="input"
            rows={2}
            value={values.applicantTypeRejectMessage}
            onChange={(e) => {
              const applicantTypeRejectMessage = e.target.value;
              setValues((prev) => {
                const next = { ...prev, applicantTypeRejectMessage };
                scheduleSave(next);
                return next;
              });
            }}
            placeholder="e.g. Trade Licence accepts company applicants only."
          />
          <span style={{ fontSize: 12, color: "var(--mut)" }}>
            Shown when an applicant type is not allowed (FN-23).
          </span>
        </label>

        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Profile attribute registry</div>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--mut)" }}>
            Bind identity attributes collected for each allowed type.
          </p>
          {availableAttrs.length === 0 ? (
            <p style={{ margin: 0, color: "var(--mut)", fontSize: 13 }}>Select an applicant type to bind attributes.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {availableAttrs.map((attr) => (
                <div
                  key={attr.key}
                  style={{ padding: 12, border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}
                >
                  <div style={{ fontWeight: 500, marginBottom: 8 }}>{attr.label}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {attr.types
                      .filter((t) => values.allowedApplicantTypes.includes(t))
                      .map((t) => (
                        <label key={t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={bound.has(`${t}:${attr.key}`)}
                            onChange={() => toggleBinding(attr.key, t)}
                          />
                          {t}
                        </label>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
