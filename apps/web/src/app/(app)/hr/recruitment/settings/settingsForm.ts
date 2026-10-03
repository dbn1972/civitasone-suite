/** Pure helpers for the recruitment settings form (GAP-RECRUITMENT-CAREERS-HOME-02 / DETAIL-05 / TALENT-POOL-02). */
export type SettingsForm = {
  organisationName: string;
  departmentName: string;
  emblemUrl: string;
  offerWorkflowRequired: boolean;
  applicantPurposeNote: string;
};

export type Settings = {
  organisationName: string | null;
  departmentName: string | null;
  emblemUrl: string | null;
  offerWorkflowRequired: boolean;
  applicantPurposeNote: string | null;
};

export function toForm(s: Settings): SettingsForm {
  return {
    organisationName: s.organisationName ?? "",
    departmentName: s.departmentName ?? "",
    emblemUrl: s.emblemUrl ?? "",
    offerWorkflowRequired: s.offerWorkflowRequired,
    applicantPurposeNote: s.applicantPurposeNote ?? "",
  };
}

/** https URL or an absolute path on this site (the same rule the service enforces). */
export function isValidEmblemUrl(v: string): boolean {
  const u = v.trim();
  return /^https:\/\/[^\s]+$/i.test(u) || /^\/(?!\/)[^\s]*$/.test(u);
}

export type SettingsError = "organisationName" | "departmentName" | "emblemUrl" | "applicantPurposeNote";

/** Blank text fields are sent as null (cleared). Returns the PUT body or the first field that is wrong. */
export function buildSettingsBody(f: SettingsForm): { ok: true; body: Record<string, string | boolean | null> } | { ok: false; error: SettingsError } {
  const text = (v: string, max: number): string | null | "bad" => {
    const t = v.trim();
    if (t === "") return null;
    return t.length > max ? "bad" : t;
  };
  const org = text(f.organisationName, 200);
  if (org === "bad") return { ok: false, error: "organisationName" };
  const dept = text(f.departmentName, 200);
  if (dept === "bad") return { ok: false, error: "departmentName" };
  const note = text(f.applicantPurposeNote, 2000);
  if (note === "bad") return { ok: false, error: "applicantPurposeNote" };
  const emblem = f.emblemUrl.trim();
  if (emblem !== "" && !isValidEmblemUrl(emblem)) return { ok: false, error: "emblemUrl" };
  return {
    ok: true,
    body: {
      organisationName: org, departmentName: dept, emblemUrl: emblem === "" ? null : emblem,
      offerWorkflowRequired: f.offerWorkflowRequired, applicantPurposeNote: note,
    },
  };
}
