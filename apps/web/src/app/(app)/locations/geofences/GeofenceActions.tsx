"use client";

/**
 * GAP-LOCATIONS-GEOFENCES-02: manage the geofence register. location-service already exposes
 * POST /v1/geofences and PUT /v1/geofences/:id; this adds the form that creates a circular geofence and
 * the per-row switch that activates / deactivates one. The page only renders these for roles the service
 * lets write (the service stays the authority). Polygon editing is not offered here.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ActionButton, AcceptedNotice, Button, Card, Field, Input, Select } from "../../../_components/ds";
import { useRegisterWrite } from "../_useRegisterWrite";

const GEOFENCE_TYPES = ["office", "site", "zone"] as const;

/** Poll target for a create / toggle: the single-geofence read. */
const READ = (id: string) => `/v1/geofences/${encodeURIComponent(id)}`;

export function GeofenceCreateForm() {
  const t = useTranslations("locationsOps.geofences");
  const { request, accepted, formError } = useRegisterWrite("geofence", { read: READ });
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof GEOFENCE_TYPES)[number]>("site");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState("");
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const err = (field: string) => localErrors[field] ?? formError.fieldError(field);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const centerLat = Number(lat);
    const centerLng = Number(lng);
    const radiusMeters = Number(radius);
    const problems: Record<string, string> = {};
    if (!name.trim()) problems.name = t("errName");
    if (lat.trim() === "" || !Number.isFinite(centerLat) || centerLat < -90 || centerLat > 90) problems.centerLat = t("errLat");
    if (lng.trim() === "" || !Number.isFinite(centerLng) || centerLng < -180 || centerLng > 180) problems.centerLng = t("errLng");
    if (radius.trim() === "" || !Number.isInteger(radiusMeters) || radiusMeters <= 0) problems.radiusMeters = t("errRadius");
    setLocalErrors(problems);
    if (Object.keys(problems).length > 0) return;
    await accepted.run(() =>
      request("/v1/geofences", "POST", { name: name.trim(), type, centerLat, centerLng, radiusMeters, active: true }),
    );
  }

  // Clear the form once the create is on its way (the notice below says what happened).
  const { phase } = accepted;
  useEffect(() => {
    if (phase === "accepted" || phase === "pending") {
      setName(""); setLat(""); setLng(""); setRadius(""); setType("site");
    }
  }, [phase]);

  return (
    <Card title={t("manageTitle")}>
      <form className="pad" onSubmit={(e) => void submit(e)} noValidate style={{ display: "grid", gap: 12, maxWidth: 520 }}>
        <Field label={t("nameLabel")} required error={err("name")}>
          <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("typeLabel")} required error={err("type")}>
          <Select value={type} onChange={(e) => setType(e.target.value as (typeof GEOFENCE_TYPES)[number])}>
            {GEOFENCE_TYPES.map((v) => (
              <option key={v} value={v}>{t(`types.${v}`)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("latLabel")} required error={err("centerLat")}>
          <Input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
        </Field>
        <Field label={t("lngLabel")} required error={err("centerLng")}>
          <Input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
        </Field>
        <Field label={t("radiusLabel")} required error={err("radiusMeters")}>
          <Input inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} />
        </Field>
        <div>
          <Button type="submit" disabled={accepted.isBusy} style={{ minHeight: 44 }}>
            {accepted.isBusy ? t("saving") : t("submit")}
          </Button>
        </div>
        <AcceptedNotice {...accepted.noticeProps} />
      </form>
    </Card>
  );
}

/** Per-row switch: PUT /v1/geofences/:id { active }. */
export function GeofenceToggle({ id, name, active }: { id: string; name: string; active: boolean }) {
  const t = useTranslations("locationsOps.geofences");
  const { request, accepted } = useRegisterWrite("geofence", {
    read: READ,
    isDone: (body) => (body as { active?: unknown })?.active === !active,
  });
  const sent = useRef<{ id?: string }>({});
  return (
    <>
      <ActionButton
        label={active ? t("deactivate") : t("activate")}
        className="btn ghost"
        danger={active}
        confirmTitle={active ? t("deactivateTitle") : t("activateTitle")}
        confirmDescription={active ? t("deactivateDescription", { name }) : t("activateDescription", { name })}
        confirmLabel={active ? t("deactivate") : t("activate")}
        onConfirm={async () => { sent.current = await request(`/v1/geofences/${encodeURIComponent(id)}`, "PUT", { active: !active }); }}
        onSuccess={() => void accepted.accept({ id: sent.current.id ?? id })}
      />
      <AcceptedNotice {...accepted.noticeProps} />
    </>
  );
}
