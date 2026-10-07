"use client";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/ds";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

// GAP-CITIZEN-RTI-03: a CPIO is now chosen by name/authority from the directory
// (GET /v1/citizen/rti/cpios?q=). Only the opaque id travels in the request body
// as cpioRef — the applicant never sees or types a UUID.
interface Cpio { id: string; name: string; designation: string | null; publicAuthority: string; department: string | null }

export function RegisterRTIButton() {
  const t = useTranslations("citizenRti");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ subject: "", description: "" });
  // CPIO picker state.
  const [cpioQuery, setCpioQuery] = useState("");
  const [cpioResults, setCpioResults] = useState<Cpio[]>([]);
  const [selectedCpio, setSelectedCpio] = useState<Cpio | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const searchSeq = useRef(0);

  const searchCpios = useCallback(async (q: string) => {
    const seq = ++searchSeq.current;
    try {
      const res = await fetch(`/api/proxy/v1/citizen/rti/cpios?q=${encodeURIComponent(q)}`);
      if (!res.ok) { if (seq === searchSeq.current) setCpioResults([]); return; }
      const body = (await res.json()) as { data?: Cpio[] };
      if (seq === searchSeq.current) setCpioResults(body.data ?? []);
    } catch { if (seq === searchSeq.current) setCpioResults([]); }
  }, []);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => void searchCpios(cpioQuery), 200);
    return () => clearTimeout(handle);
  }, [cpioQuery, open, searchCpios]);

  function pickCpio(c: Cpio) {
    setSelectedCpio(c);
    setCpioQuery(`${c.name} — ${c.publicAuthority}`);
    setListOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!selectedCpio) {
      setError(t("cpioInvalid"));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/citizen/rti", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: form.subject, description: form.description, cpioRef: selectedCpio.id }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      setMessage(t("registerSuccess"));
      setOpen(false);
      setForm({ subject: "", description: "" });
      setSelectedCpio(null);
      setCpioQuery("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("registerErrorFallback"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="primary" style={{ minHeight: 44 }} onClick={() => setOpen((o) => !o)}>
        {t("registerButton")}
      </Button>
      {open && (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={submit} className="pad" style={{ maxWidth: 560 }}>
            <h4 style={{ marginTop: 0 }}>{t("registerFormTitle")}</h4>
            <label htmlFor="new-rti-subject" style={labelStyle}>{t("subjectLabel")}</label>
            <input id="new-rti-subject" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder={t("subjectPlaceholder")} style={inputStyle} />
            <label htmlFor="new-rti-description" style={labelStyle}>{t("infoSoughtLabel")}</label>
            <textarea id="new-rti-description" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("infoSoughtPlaceholder")} rows={4} style={{ ...inputStyle, minHeight: 100 }} />

            {/* GAP-CITIZEN-RTI-03: pick the CPIO by name/authority; id travels in cpioRef. */}
            <label htmlFor="new-rti-cpio" style={labelStyle}>{t("cpioLabel")}</label>
            <div style={{ position: "relative" }}>
              <input
                id="new-rti-cpio"
                role="combobox"
                aria-expanded={listOpen}
                aria-controls="new-rti-cpio-list"
                aria-autocomplete="list"
                autoComplete="off"
                value={cpioQuery}
                onChange={(e) => { setCpioQuery(e.target.value); setSelectedCpio(null); setListOpen(true); }}
                onFocus={() => setListOpen(true)}
                placeholder={t("cpioPlaceholder")}
                style={inputStyle}
              />
              {listOpen && cpioResults.length > 0 ? (
                <ul id="new-rti-cpio-list" role="listbox" aria-label={t("cpioLabel")} style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--surface, #fff)", border: "1px solid var(--line)", borderRadius: 8, zIndex: 100, listStyle: "none", padding: 0, margin: "2px 0 0", maxHeight: 240, overflow: "auto" }}>
                  {cpioResults.map((c) => (
                    <li
                      key={c.id}
                      role="option"
                      tabIndex={0}
                      aria-selected={selectedCpio?.id === c.id}
                      onClick={() => pickCpio(c)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickCpio(c); } }}
                      style={{ padding: "8px 12px", cursor: "pointer", fontSize: 14 }}
                    >
                      <div style={{ fontWeight: 600 }}>{c.name}{c.designation ? `, ${c.designation}` : ""}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.publicAuthority}{c.department ? ` · ${c.department}` : ""}</div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {selectedCpio ? (
              <p style={{ fontSize: 12, color: "var(--good)", marginTop: -4, marginBottom: 8 }}>
                {t("cpioSelected", { name: selectedCpio.name, authority: selectedCpio.publicAuthority })}
              </p>
            ) : null}

            <Button type="submit" variant="primary" disabled={busy || !selectedCpio} style={{ minHeight: 44 }}>{busy ? t("submitting") : t("submitApplication")}</Button>
            <Button type="button" variant="ghost" style={{ marginLeft: 8, minHeight: 44 }} onClick={() => setOpen(false)}>{t("cancel")}</Button>
          </form>
        </div>
      )}
      {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", marginTop: 8 }}>{message}</p> : null}
      {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>{error}</p> : null}
    </>
  );
}
