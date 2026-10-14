"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button, ConfirmDialog, Field, HelpTip, Input, Select } from "../../../../_components/ds";
import { buildLocationPatch, type EditableFields } from "../locationTree";

function editableBefore(e: { name: string; type: string; parentId: string | null; addressLine: string | null; city: string | null; postalCode: string | null; lgdCode: string | null }): EditableFields {
  return { name: e.name, type: e.type, parentId: e.parentId, addressLine: e.addressLine, city: e.city, postalCode: e.postalCode, lgdCode: e.lgdCode };
}

interface MinimalLocation {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
}

interface EditingLocation {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  lgdCode: string | null;
}

interface Props {
  /**
   * GAP-HR-LOCATIONS-02: when set, the form edits this location (PATCH) instead
   * of creating one -- same fields, same validation, prefilled; only changed
   * fields are sent. `locations` should already exclude the location itself and
   * its descendants (see locationTree.ts selectableParents).
   */
  editing?: EditingLocation;
  onCancel: () => void;
  onSuccess?: () => void;
  /**
   * GAP-HR-LOCATIONS-NEW-01: existing locations, for the optional "Parent
   * location" select -- without this the form could only ever create
   * top-level locations (parentId was never sent), so the list page's
   * State/District columns and "State-level / District-level" stats
   * (GAP-HR-LOCATIONS-01, which derives them by walking parentId) could
   * never be populated from this form. Optional (defaults to none) so this
   * form still renders standalone in isolation (e.g. existing unit tests).
   */
  locations?: MinimalLocation[];
}

const LOCATION_TYPES = [
  "state",
  "district",
  "block",
  "ward",
  "office",
  "facility",
  "branch",
] as const;

type LocationType = (typeof LOCATION_TYPES)[number];

/**
 * Which existing location types are valid parents for a location of a given
 * type, mirroring the hierarchy implied by the list page's derived State/
 * District columns (state > district > block > ward, with office/facility/
 * branch as leaves that may sit under any of them). A state is always a
 * top-level node. Optional everywhere else (GAP-HR-LOCATIONS-NEW-01's fix
 * steps flag "require parent for non-state types" as its own, separate
 * product decision -- left alone here, same as the backend's own optional
 * parentId).
 */
const ELIGIBLE_PARENT_TYPES: Record<LocationType, readonly LocationType[]> = {
  state: [],
  district: ["state"],
  block: ["district", "state"],
  ward: ["block", "district"],
  office: ["state", "district", "block", "ward"],
  facility: ["state", "district", "block", "ward", "office"],
  branch: ["state", "district", "block", "ward", "office"],
};

export function AddLocationForm({ onCancel, onSuccess, locations = [], editing }: Props) {
  const t = useTranslations("addLocationForm");
  const formId = useId();
  const [name, setName] = useState(editing?.name ?? "");
  const [type, setType] = useState<LocationType>((editing?.type as LocationType | undefined) ?? "office");
  const [parentId, setParentId] = useState(editing?.parentId ?? "");
  const [addressLine, setAddressLine] = useState(editing?.addressLine ?? "");
  const [city, setCity] = useState(editing?.city ?? "");
  const [postalCode, setPostalCode] = useState(editing?.postalCode ?? "");
  const [lgdCode, setLgdCode] = useState(editing?.lgdCode ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"success" | "error">("success");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const formError = useFormError("location");

  const nameId = `${formId}-name`;
  const typeId = `${formId}-type`;
  const parentSelectId = `${formId}-parent`;
  const addressLineId = `${formId}-addressLine`;
  const cityId = `${formId}-city`;
  const postalCodeId = `${formId}-postalCode`;
  const lgdCodeId = `${formId}-lgdCode`;
  const statusId = `${formId}-status`;

  const typeLabels: Record<LocationType, string> = {
    state: t("typeState"),
    district: t("typeDistrict"),
    block: t("typeBlock"),
    ward: t("typeWard"),
    office: t("typeOffice"),
    facility: t("typeFacility"),
    branch: t("typeBranch"),
  };

  // GAP-HR-LOCATIONS-NEW-01: a state has no parent; every other type is
  // filtered to the real-world hierarchy above it.
  const eligibleParentTypes = ELIGIBLE_PARENT_TYPES[type];
  const showParentField = type !== "state";
  const parentOptions = locations.filter((l) => eligibleParentTypes.includes(l.type as LocationType));

  /** Client-side message first, then a backend rejection for the same field. */
  function errFor(field: string): string | undefined {
    return fieldErrorText(field) ?? formError.fieldError(field);
  }

  function fieldErrorText(field: string): string | undefined {
    if (!invalid.has(field)) return undefined;
    switch (field) {
      case "name": return t("nameError");
      case "addressLine": return t("addressLineError");
      case "city": return t("cityError");
      case "postalCode": return t("postalCodeError");
      case "lgdCode": return t("lgdCodeError");
      default: return undefined;
    }
  }

  function editableNow() {
    return {
      name: name.trim(), type, parentId: showParentField && parentId ? parentId : null,
      addressLine: addressLine.trim(), city: city.trim(), postalCode: postalCode.trim(), lgdCode: lgdCode.trim(),
    };
  }

  const isDirty = editing
    ? Object.keys(buildLocationPatch(editableBefore(editing), editableNow())).length > 0
    : name.trim() !== "" ||
      type !== "office" ||
      parentId !== "" ||
      addressLine.trim() !== "" ||
      city.trim() !== "" ||
      postalCode.trim() !== "" ||
      lgdCode.trim() !== "";

  function resetFields() {
    setName("");
    setType("office");
    setParentId("");
    setAddressLine("");
    setCity("");
    setPostalCode("");
    setLgdCode("");
    setMessage(null);
    setInvalid(new Set());
  }

  function handleTypeChange(next: LocationType) {
    setType(next);
    // GAP-HR-LOCATIONS-NEW-01 fix step: selecting type "state" hides/clears
    // the parent field; changing type at all re-filters eligible parents, so
    // a previously-chosen parent of a now-ineligible type is cleared too
    // rather than silently submitted anyway.
    setParentId("");
  }

  function handleCancel() {
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    onCancel();
  }

  function confirmDiscard() {
    resetFields();
    setShowDiscardConfirm(false);
    onCancel();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    const trimName = name.trim();
    const trimAddressLine = addressLine.trim();
    const trimCity = city.trim();
    const trimPostalCode = postalCode.trim();
    const trimLgdCode = lgdCode.trim();
    const errs = new Set<string>();

    if (trimName.length < 1 || trimName.length > 200) errs.add("name");
    if (trimAddressLine.length > 500) errs.add("addressLine");
    if (trimCity.length > 120) errs.add("city");
    // GAP-HR-LOCATIONS-NEW-03: an Indian PIN code is exactly 6 digits, first
    // digit 1-9 -- this used to accept 1-6 digits of anything. location-
    // service's own createLocationBody has no format check at all (just
    // length <=16), so tightening this client-side cannot reject anything
    // the backend would otherwise have accepted.
    if (trimPostalCode && !/^[1-9]\d{5}$/.test(trimPostalCode)) errs.add("postalCode");
    if (trimLgdCode && (!/^\d+$/.test(trimLgdCode) || trimLgdCode.length > 32)) errs.add("lgdCode");

    if (errs.size > 0) {
      setInvalid(errs);
      setTone("error");
      setMessage(t("statusFixFields"));
      return;
    }

    setInvalid(new Set());
    setBusy(true);
    formError.clear();
    try {
      if (editing) {
        const patch = buildLocationPatch(editableBefore(editing), editableNow());
        if (Object.keys(patch).length === 0) {
          setTone("error");
          setMessage(t("noChanges"));
          return;
        }
        const res = await fetch(`/api/proxy/v1/locations/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const resolved = await formError.fromResponse(res, "save");
          setTone("error");
          setMessage(resolved.message);
          return;
        }
        setTone("success");
        setMessage(t("editSuccessMsg", { name: trimName }));
        onSuccess?.();
        return;
      }
      const body: Record<string, string> = { name: trimName, type };
      if (showParentField && parentId) body.parentId = parentId;
      if (trimAddressLine) body.addressLine = trimAddressLine;
      if (trimCity) body.city = trimCity;
      if (trimPostalCode) body.postalCode = trimPostalCode;
      if (trimLgdCode) body.lgdCode = trimLgdCode;

      const res = await fetch("/api/proxy/v1/locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setTone("error");
        setMessage(resolved.message);
        return;
      }

      // resetFields() clears the message, so it must run BEFORE the success
      // message is set or the confirmation is wiped immediately.
      resetFields();
      setTone("success");
      setMessage(t("successMsg", { name: trimName }));
      onSuccess?.();
    } catch (caught) {
      setTone("error");
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      aria-label={t("formAriaLabel")}
      noValidate
      className="card"
      style={{ marginTop: 16 }}
    >
      <div className="card-h">
        <h3>{editing ? t("editHeading") : t("cardHeading")}</h3>
      </div>
      <div className="pad" style={{ display: "grid", gap: 16 }}>
        {/* Status region */}
        <div aria-live="polite" aria-atomic="true" id={statusId}>
          {message && (
            <p
              role={tone === "error" ? "alert" : "status"}
              style={{
                margin: 0,
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 14,
                background: tone === "success" ? "var(--goodbg, #dcfce7)" : "#fee2e2",
                border: `1px solid ${
                  tone === "success" ? "var(--goodbd, #86efac)" : "var(--badbd, #fca5a5)"
                }`,
                color: tone === "success" ? "var(--good, #166534)" : "var(--bad, #b91c1c)",
              }}
            >
              {tone === "success" ? "✅" : "⚠️"} {message}
            </p>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          }}
        >
          {/* Name */}
          <Field id={nameId} label={t("nameLabel")} required error={errFor("name")}>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              maxLength={200}
            />
          </Field>

          {/* Type */}
          <Field id={typeId} label={t("typeLabel")} required>
            <Select value={type} onChange={(e) => handleTypeChange(e.target.value as LocationType)}>
              {LOCATION_TYPES.map((lt) => (
                <option key={lt} value={lt}>
                  {typeLabels[lt]}
                </option>
              ))}
            </Select>
          </Field>

          {/* Parent location (GAP-HR-LOCATIONS-NEW-01) */}
          {showParentField && (
            <Field id={parentSelectId} label={t("parentLabel")} error={formError.fieldError("parentId")}>
              <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">{t("parentNone")}</option>
                {parentOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        {/* Address Line */}
        <Field id={addressLineId} label={t("addressLineLabel")} error={errFor("addressLine")}>
          <Input
            type="text"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            placeholder={t("addressLinePlaceholder")}
            maxLength={500}
          />
        </Field>

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          }}
        >
          {/* City */}
          <Field id={cityId} label={t("cityLabel")} error={errFor("city")}>
            <Input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder={t("cityPlaceholder")}
              maxLength={120}
            />
          </Field>

          {/* Postal Code */}
          <Field id={postalCodeId} label={t("postalCodeLabel")} error={errFor("postalCode")}>
            <Input
              type="text"
              inputMode="numeric"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder={t("postalCodePlaceholder")}
              maxLength={6}
            />
          </Field>

          {/* LGD Code */}
          <Field
            id={lgdCodeId}
            label={
              <>
                {t("lgdCodeLabel")}
                <HelpTip term={t("lgdCodeLabel")}>{t("lgdCodeHelp")}</HelpTip>
              </>
            }
            error={errFor("lgdCode")}
          >
            <Input
              type="text"
              inputMode="numeric"
              value={lgdCode}
              onChange={(e) => setLgdCode(e.target.value)}
              placeholder={t("lgdCodePlaceholder")}
              maxLength={32}
            />
          </Field>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button
            type="submit"
            loading={busy}
            style={{ minHeight: 44, minWidth: 140 }}
          >
            {editing ? (busy ? t("savingBtn") : t("saveBtn")) : busy ? t("addingBtn") : t("addBtn")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleCancel}
            disabled={busy}
            style={{ minHeight: 44 }}
          >
            {t("cancelBtn")}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={showDiscardConfirm}
        title={t("discardConfirmTitle")}
        confirmLabel={t("discardConfirmBtn")}
        danger
        onConfirm={confirmDiscard}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </form>
  );
}

export type { MinimalLocation };
