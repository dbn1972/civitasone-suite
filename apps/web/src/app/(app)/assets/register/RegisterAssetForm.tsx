"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, ConfirmDialog, useConfirmAction } from "../../../_components/ds";
import type { AssetCategoryOption, AssetLocationOption } from "../../../_data/loaders";
import { formatIndianDate, formatMoney, todayIST } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { flattenTree, buildLocationTree } from "../locations/locationTree";

type Props = {
  categories: AssetCategoryOption[];
  /** GAP-ASSETS-LOCATIONS-03: active functional locations to place the asset in (empty => free-text fallback). */
  locations?: AssetLocationOption[];
  /** The locations could not be loaded (as opposed to there being none): free text is offered with a note. */
  locationsFailed?: boolean;
};

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

export function categoryLabel(c: AssetCategoryOption): string {
  return `${c.name}${c.code ? ` (${c.code})` : ""} · ${c.depMethod} ${c.depRate}% · ${c.usefulLifeYears} yrs`;
}

export function RegisterAssetForm({ categories, locations = [], locationsFailed = false }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    code: "",
    categoryId: "",
    assetType: "fixed",
    acquisitionCost: "",
    // GAP-ASSETS-REGISTER-06: capitalisation date is chosen (backdating is
    // allowed), defaulting to today in India -- never the UTC day.
    acquisitionDate: todayIST(),
    location: "",
    locationId: "",
  });
  // The asset is placed in a registered functional location (nested by parent). With none registered, or when
  // the list could not be loaded, the form falls back to free text rather than blocking registration.
  const locationOptions = useMemo(() => flattenTree(buildLocationTree(locations)), [locations]);
  const hasLocations = locationOptions.length > 0;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  // GAP-ASSETS-REGISTER-07: once the service accepted the create, the form
  // stays locked -- a second click would register a duplicate asset.
  const [done, setDone] = useState(false);
  const formError = useFormError("asset");

  const category = categories.find((c) => c.id === form.categoryId) ?? null;
  // Positive rupees only (no zero-cost capitalisation) and within the range a
  // JSON number carries exactly.
  const rawCostMinor = rupeesToMinorString(form.acquisitionCost);
  const costMinor = rawCostMinor !== null && Number.isSafeInteger(Number(rawCostMinor)) ? rawCostMinor : null;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Enter the asset name.";
    // GAP-ASSETS-REGISTER-03: the asset-service requires a code and has no
    // server-side numbering, so the clerk supplies it -- no random client-side
    // codes that can collide.
    if (!form.code.trim()) next.code = "Enter the asset code.";
    else if (form.code.trim().length > 64) next.code = "Asset code must be at most 64 characters.";
    if (!category) next.categoryId = "Choose a category.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.acquisitionDate)) next.acquisitionDate = "Choose the acquisition date.";
    else if (form.acquisitionDate > todayIST()) next.acquisitionDate = "Acquisition date cannot be in the future.";
    if (costMinor === null) next.acquisitionCost = "Enter an acquisition cost greater than zero, in rupees (up to 2 decimals).";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // GAP-ASSETS-REGISTER-01: creating an asset master record is confirmed with
  // a reason, like every other register-changing action in this module.
  const create = useConfirmAction({
    onConfirm: async (reason) => {
      if (!category || costMinor === null) throw new UserFacingError("Complete the form first.");
      setMessage("");
      let res: Response;
      try {
        res = await fetch("/api/proxy/v1/asset/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim(),
          categoryId: category.id,
          assetType: form.assetType,
          acquisitionCost: Number(costMinor),
          // GAP-ASSETS-REGISTER-02: depreciation follows the chosen category.
          depMethod: category.depMethod,
          depRate: category.depRate,
          usefulLifeYears: category.usefulLifeYears,
          acquisitionDate: form.acquisitionDate,
          // A chosen register location sends its id (the service stores the name for display); otherwise free text.
          ...(hasLocations && form.locationId ? { locationId: form.locationId } : { location: form.location.trim() || undefined }),
          notes: (reason ?? "").trim() || undefined,
        }),
        });
      } catch (caught) {
        throw UserFacingError.from(formError.fromException("save", caught));
      }
      // GAP-ASSETS-REGISTER-04: a failure shows plain-language copy (never the
      // raw response body), inside the dialog's role=alert error region.
      if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
      formError.clear();
      const body = (await res.json().catch(() => ({}))) as { id?: unknown };
      setDone(true);
      setMessage(`Asset ${form.code.trim()} submitted for registration. It will appear in the register shortly.`);
      if (typeof body.id === "string") router.push(`/assets/${body.id}`);
    },
  });

  function field(id: string, key: string) {
    return {
      id,
      "aria-invalid": !!errors[key] || undefined,
      "aria-describedby": errors[key] ? `${id}-err` : undefined,
    };
  }
  function err(id: string, key: string) {
    return errors[key] ? <p id={`${id}-err`} role="alert" style={{ color: "var(--bad)", fontSize: 12, margin: "4px 0 0" }}>{errors[key]}</p> : null;
  }

  return (
    <>
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: "var(--panel)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (validate()) create.trigger();
          }}
          className="pad"
        >
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ast-name">Name</label>
              <input {...field("ast-name", "name")} aria-required="true" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
              {err("ast-name", "name")}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ast-code">Asset code</label>
              <input {...field("ast-code", "code")} aria-required="true" maxLength={64} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} style={inputStyle} />
              {err("ast-code", "code")}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ast-category">Category</label>
              <select {...field("ast-category", "categoryId")} aria-required="true" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} style={inputStyle}>
                <option value="">Choose a category…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c)}</option>)}
              </select>
              {err("ast-category", "categoryId")}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ast-type">Type</label>
              <select id="ast-type" value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })} style={inputStyle}>
                <option value="fixed">Fixed</option>
                <option value="infra">Infrastructure</option>
                <option value="it">IT</option>
                <option value="vehicle">Vehicle</option>
                <option value="movable">Movable</option>
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ast-cost">Acquisition cost (₹)</label>
              <input {...field("ast-cost", "acquisitionCost")} aria-required="true" inputMode="decimal" value={form.acquisitionCost} onChange={(e) => setForm({ ...form, acquisitionCost: e.target.value })} style={inputStyle} />
              {err("ast-cost", "acquisitionCost")}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ast-date">Acquisition date</label>
              <input {...field("ast-date", "acquisitionDate")} type="date" aria-required="true" max={todayIST()} value={form.acquisitionDate} onChange={(e) => setForm({ ...form, acquisitionDate: e.target.value })} style={inputStyle} />
              {err("ast-date", "acquisitionDate")}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ast-loc">Location</label>
              {hasLocations ? (
                <select id="ast-loc" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} style={inputStyle}>
                  <option value="">No location</option>
                  {locationOptions.map((l) => (
                    <option key={l.id} value={l.id}>{`${"— ".repeat(l.depth)}${l.code} · ${l.name}`}</option>
                  ))}
                </select>
              ) : (
                <input id="ast-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} style={inputStyle} />
              )}
              {locationsFailed ? (
                <p role="status" style={{ color: "var(--muted)", fontSize: 12, margin: "4px 0 0" }}>The location list could not be loaded, so type the location instead.</p>
              ) : null}
            </div>
          </div>
          <Button type="submit" disabled={create.busy || done} style={{ marginTop: 12 }}>Register asset</Button>
        </form>
      </div>

      <ConfirmDialog
        open={create.open}
        title="Register this asset?"
        description={
          <>
            Creates <b>{form.code.trim()}</b> · <b>{form.name.trim()}</b> in the asset register, acquired on{" "}
            <b>{formatIndianDate(form.acquisitionDate)}</b> at an acquisition cost of <b>{formatMoney(costMinor)}</b>, depreciated per <b>{category ? categoryLabel(category) : "—"}</b>.
            An asset with a wrong cost or category is hard to reverse. Provide a reason to proceed.
          </>
        }
        confirmLabel="Register asset"
        requireReason
        reasonLabel="Reason / authorisation"
        busy={create.busy}
        errorMessage={create.error}
        onConfirm={create.confirm}
        onCancel={create.cancel}
      />
    </>
  );
}
