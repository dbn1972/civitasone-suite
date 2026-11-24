"use client";

/**
 * Case intake — the start of the case → party → hearing → order → disposal
 * chain. Three small forms sharing one implementation:
 *   - RegisterCasePanel: POST /v1/court/cases (registrar / court_admin).
 *   - AddPartyForm:      POST /v1/court/cases/:id/parties.
 *   - EditAdvocateForm:  PATCH /v1/court/parties/:id/advocate.
 * Body shapes mirror court-service case-registry/validators.ts and
 * party/validators.ts; the service enforces roles (we surface its refusal as
 * a plain-language error).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/ds";
import type { CaseParty, Court } from "../_data/types";
import { ENUM_NAMESPACES } from "../_data/policy";
import { humanize, todayIso } from "../_data/format";
import {
  addParty,
  createCase,
  fetchConfigNamespace,
  fetchCourtBenches,
  updatePartyAdvocate,
} from "../_data/client";
import { errStyle, fieldStyle } from "./courtFormStyles";

const DEFAULT_CASE_TYPES = ENUM_NAMESPACES.find((n) => n.namespace === "case_type")?.defaults ?? [];
const DEFAULT_PARTY_ROLES = ENUM_NAMESPACES.find((n) => n.namespace === "party_role")?.defaults ?? [];

/** Active configured values for an enum namespace, else the module defaults. */
function useEnumValues(namespace: string, defaults: string[]): string[] {
  const [values, setValues] = useState<string[]>(defaults);
  useEffect(() => {
    let live = true;
    fetchConfigNamespace(namespace)
      .then((rows) => {
        const keys = rows.filter((r) => r.active).map((r) => r.configKey);
        if (live && keys.length > 0) setValues(keys);
      })
      .catch(() => undefined); // keep module defaults
    return () => {
      live = false;
    };
  }, [namespace]);
  return values;
}

function msg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

const row: React.CSSProperties = { display: "grid", gap: 4, fontSize: 13 };
const grid: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" };

// ─── Register case ───────────────────────────────────────────────────────────

export function RegisterCasePanel({ courts }: { courts: Court[] }) {
  const t = useTranslations("courtCaseIntake");
  const router = useRouter();
  const caseTypes = useEnumValues("case_type", DEFAULT_CASE_TYPES);
  const partyRoles = useEnumValues("party_role", DEFAULT_PARTY_ROLES);

  const [open, setOpen] = useState(false);
  const [cnr, setCnr] = useState("");
  const [caseType, setCaseType] = useState("");
  const [title, setTitle] = useState("");
  const [filingNumber, setFilingNumber] = useState("");
  const [filingDate, setFilingDate] = useState(todayIso());
  const [courtId, setCourtId] = useState("");
  const [benchId, setBenchId] = useState("");
  const [benches, setBenches] = useState<Array<{ id: string; name: string }>>([]);
  const [partyRole, setPartyRole] = useState("petitioner");
  const [partyName, setPartyName] = useState("");
  const [advocateName, setAdvocateName] = useState("");
  const [advocateBarId, setAdvocateBarId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [createdId, setCreatedId] = useState<string | undefined>();

  useEffect(() => {
    setBenchId("");
    setBenches([]);
    if (!courtId) return;
    let live = true;
    fetchCourtBenches(courtId)
      .then((b) => live && setBenches(b))
      .catch(() => undefined); // bench is optional
    return () => {
      live = false;
    };
  }, [courtId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!cnr.trim() || !caseType || !title.trim() || !filingDate || !courtId || !partyName.trim()) {
      setError(t("required"));
      return;
    }
    if (!/^[A-Za-z0-9]{16}$/.test(cnr.replace(/[^A-Za-z0-9]/g, ""))) {
      setError(t("cnrInvalid"));
      return;
    }
    setBusy(true);
    try {
      const { caseId } = await createCase({
        cnrNumber: cnr.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
        caseType,
        title: title.trim(),
        filingDate,
        courtId,
        ...(filingNumber.trim() ? { filingNumber: filingNumber.trim() } : {}),
        ...(benchId ? { benchId } : {}),
        parties: [
          {
            partyRole,
            name: partyName.trim(),
            ...(advocateName.trim() ? { advocateName: advocateName.trim() } : {}),
            ...(advocateBarId.trim() ? { advocateBarId: advocateBarId.trim() } : {}),
          },
        ],
      });
      setCreatedId(caseId);
      setOpen(false);
      setCnr("");
      setTitle("");
      setFilingNumber("");
      setPartyName("");
      setAdvocateName("");
      setAdvocateBarId("");
      router.refresh();
    } catch (err) {
      setError(msg(err, t("required")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {createdId && (
        <div className="alert" role="status" style={{ borderColor: "var(--primary)", marginBottom: 8 }}>
          ✓ {t("success")}{" "}
          <Link href={`/court/cases/${createdId}`}>{t("openCaseDelayed")} →</Link>
        </div>
      )}
      {!open ? (
        <Button variant="primary" onClick={() => setOpen(true)}>
          {t("registerCase")}
        </Button>
      ) : (
        <form
          onSubmit={(e) => void submit(e)}
          aria-label={t("registerTitle")}
          style={{ display: "grid", gap: 12, padding: 16, border: "1px solid var(--line)", borderRadius: 10 }}
        >
          <h3 style={{ margin: 0 }}>{t("registerTitle")}</h3>
          {courts.length === 0 && (
            <p className="sub" role="note" style={{ margin: 0 }}>
              {t("noCourts")}
            </p>
          )}
          <div style={grid}>
            <label style={row}>
              <span>{t("cnr")}</span>
              <input value={cnr} maxLength={32} onChange={(e) => setCnr(e.target.value)} style={fieldStyle} />
            </label>
            <label style={row}>
              <span>{t("caseType")}</span>
              <select value={caseType} onChange={(e) => setCaseType(e.target.value)} style={fieldStyle}>
                <option value="">—</option>
                {caseTypes.map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </select>
            </label>
            <label style={row}>
              <span>{t("title")}</span>
              <input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} style={fieldStyle} />
            </label>
            <label style={row}>
              <span>{t("filingNumber")}</span>
              <input value={filingNumber} maxLength={64} onChange={(e) => setFilingNumber(e.target.value)} style={fieldStyle} />
            </label>
            <label style={row}>
              <span>{t("filingDate")}</span>
              <input type="date" value={filingDate} onChange={(e) => setFilingDate(e.target.value)} style={fieldStyle} />
            </label>
            <label style={row}>
              <span>{t("court")}</span>
              <select value={courtId} onChange={(e) => setCourtId(e.target.value)} style={fieldStyle}>
                <option value="">{t("selectCourt")}</option>
                {courts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {benches.length > 0 && (
              <label style={row}>
                <span>{t("bench")}</span>
                <select value={benchId} onChange={(e) => setBenchId(e.target.value)} style={fieldStyle}>
                  <option value="">{t("noBench")}</option>
                  {benches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
            <legend>{t("firstParty")}</legend>
            <div style={grid}>
              <label style={row}>
                <span>{t("partyRole")}</span>
                <select value={partyRole} onChange={(e) => setPartyRole(e.target.value)} style={fieldStyle}>
                  {partyRoles.map((r) => (
                    <option key={r} value={r}>
                      {humanize(r)}
                    </option>
                  ))}
                </select>
              </label>
              <label style={row}>
                <span>{t("partyName")}</span>
                <input value={partyName} maxLength={200} onChange={(e) => setPartyName(e.target.value)} style={fieldStyle} />
              </label>
              <label style={row}>
                <span>{t("advocateName")}</span>
                <input value={advocateName} maxLength={200} onChange={(e) => setAdvocateName(e.target.value)} style={fieldStyle} />
              </label>
              <label style={row}>
                <span>{t("advocateBarId")}</span>
                <input value={advocateBarId} maxLength={64} onChange={(e) => setAdvocateBarId(e.target.value)} style={fieldStyle} />
              </label>
            </div>
          </fieldset>
          {error && (
            <p role="alert" style={errStyle}>
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? t("submitting") : t("submit")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Add party (case detail) ─────────────────────────────────────────────────

export function AddPartyForm({
  caseId,
  parties,
  onDone,
}: {
  caseId: string;
  parties: CaseParty[];
  onDone: (msg: string) => Promise<void> | void;
}) {
  const t = useTranslations("courtCaseIntake");
  const partyRoles = useEnumValues("party_role", DEFAULT_PARTY_ROLES);
  const [open, setOpen] = useState(false);
  const [partyRole, setPartyRole] = useState("respondent");
  const [name, setName] = useState("");
  const [advocateName, setAdvocateName] = useState("");
  const [advocateBarId, setAdvocateBarId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!name.trim()) {
      setError(t("required"));
      return;
    }
    setBusy(true);
    try {
      // The party id is deterministic on (case, role, partyIndex): number a
      // second same-role party so it doesn't collapse onto the first.
      const partyIndex = parties.filter((p) => p.partyRole === partyRole).length;
      await addParty(caseId, {
        partyRole,
        name: name.trim(),
        partyIndex,
        ...(advocateName.trim() ? { advocateName: advocateName.trim() } : {}),
        ...(advocateBarId.trim() ? { advocateBarId: advocateBarId.trim() } : {}),
      });
      setName("");
      setAdvocateName("");
      setAdvocateBarId("");
      setOpen(false);
      await onDone(t("partyAdded"));
    } catch (err) {
      setError(msg(err, t("required")));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div style={{ marginBottom: 12 }}>
        <Button variant="primary" onClick={() => setOpen(true)}>
          {t("addParty")}
        </Button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label={t("addPartyTitle")}
      style={{ display: "grid", gap: 12, marginBottom: 14 }}
    >
      <div style={grid}>
        <label style={row}>
          <span>{t("partyRole")}</span>
          <select value={partyRole} onChange={(e) => setPartyRole(e.target.value)} style={fieldStyle}>
            {partyRoles.map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </select>
        </label>
        <label style={row}>
          <span>{t("partyName")}</span>
          <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} style={fieldStyle} />
        </label>
        <label style={row}>
          <span>{t("advocateName")}</span>
          <input value={advocateName} maxLength={200} onChange={(e) => setAdvocateName(e.target.value)} style={fieldStyle} />
        </label>
        <label style={row}>
          <span>{t("advocateBarId")}</span>
          <input value={advocateBarId} maxLength={64} onChange={(e) => setAdvocateBarId(e.target.value)} style={fieldStyle} />
        </label>
      </div>
      {error && (
        <p role="alert" style={errStyle}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="primary" type="submit" disabled={busy}>
          {t("addPartySubmit")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

// ─── Edit advocate (one party row) ───────────────────────────────────────────

export function EditAdvocateForm({
  party,
  onDone,
}: {
  party: CaseParty;
  onDone: (msg: string) => Promise<void> | void;
}) {
  const t = useTranslations("courtCaseIntake");
  const [open, setOpen] = useState(false);
  // Inputs start EMPTY and only fields the user actually typed are sent: the
  // values on `party` may be role-masked placeholders (e.g. "R*** K***") and
  // writing those back would silently overwrite the real advocate identity.
  const [advocateName, setAdvocateName] = useState("");
  const [advocateBarId, setAdvocateBarId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    const name = advocateName.trim();
    const barId = advocateBarId.trim();
    if (!name && !barId) {
      setError(t("nothingChanged"));
      return;
    }
    setBusy(true);
    try {
      await updatePartyAdvocate(party.id, {
        ...(name ? { advocateName: name } : {}),
        ...(barId ? { advocateBarId: barId } : {}),
        expectedVersion: party.version,
      });
      setOpen(false);
      await onDone(t("advocateSaved"));
    } catch (err) {
      setError(msg(err, t("required")));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {t("editAdvocate")}
      </Button>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} aria-label={t("editAdvocate")} style={{ display: "grid", gap: 6 }}>
      <input
        aria-label={t("advocateName")}
        placeholder={party.advocateName ?? ""}
        value={advocateName}
        maxLength={200}
        onChange={(e) => setAdvocateName(e.target.value)}
        style={fieldStyle}
      />
      <input
        aria-label={t("advocateBarId")}
        placeholder={party.advocateBarId ?? ""}
        value={advocateBarId}
        maxLength={64}
        onChange={(e) => setAdvocateBarId(e.target.value)}
        style={fieldStyle}
      />
      {error && (
        <p role="alert" style={errStyle}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <Button size="sm" variant="primary" type="submit" disabled={busy}>
          {t("saveAdvocate")}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
