"use client";

/**
 * GAP-LOCATIONS-INFRASTRUCTURE-02: add an infrastructure asset to the register. location-service exposes
 * POST /v1/locations/infrastructure (create only: there is no edit or archive endpoint for this register),
 * so this is the one in-app action. GAP-LOCATIONS-INFRASTRUCTURE-06: an asset can be linked to its asset-register record. The page only renders it for roles the service lets write.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AcceptedNotice, Button, Card, Field, Input, Select } from "../../../_components/ds";
import { useRegisterWrite } from "../_useRegisterWrite";
import type { AssetLinkOption } from "../_data";

export const INFRA_TYPES = ["road", "bridge", "building", "water_supply", "drainage", "power_line", "telecom_tower", "park"] as const;
type InfraType = (typeof INFRA_TYPES)[number];

export function InfrastructureCreateForm({ assetOptions = [] }: { assetOptions?: AssetLinkOption[] }) {
  const t = useTranslations("locationsOps.infra");
  const { request, accepted, formError } = useRegisterWrite("infrastructure asset", {
    read: (id) => `/v1/locations/infrastructure/${encodeURIComponent(id)}`,
  });
  const [name, setName] = useState("");
  const [type, setType] = useState<InfraType>("road");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [capacity, setCapacity] = useState("");
  const [condition, setCondition] = useState("");
  const [assetId, setAssetId] = useState("");
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const err = (field: string) => localErrors[field] ?? formError.fieldError(field);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const latN = Number(lat);
    const lngN = Number(lng);
    const problems: Record<string, string> = {};
    if (!name.trim()) problems.name = t("errName");
    if (lat.trim() === "" || !Number.isFinite(latN) || latN < -90 || latN > 90) problems.lat = t("errLat");
    if (lng.trim() === "" || !Number.isFinite(lngN) || lngN < -180 || lngN > 180) problems.lng = t("errLng");
    setLocalErrors(problems);
    if (Object.keys(problems).length > 0) return;
    await accepted.run(() =>
      request("/v1/locations/infrastructure", "POST", {
        name: name.trim(),
        type,
        lat: latN,
        lng: lngN,
        ...(capacity.trim() ? { capacity: capacity.trim() } : {}),
        ...(condition ? { conditionScore: Number(condition) } : {}),
        ...(assetId ? { assetId } : {}),
      }),
    );
  }

  const { phase } = accepted;
  useEffect(() => {
    if (phase === "accepted" || phase === "pending") {
      setName(""); setLat(""); setLng(""); setCapacity(""); setCondition(""); setAssetId(""); setType("road");
    }
  }, [phase]);

  return (
    <Card title={t("manageTitle")}>
      <form className="pad" onSubmit={(e) => void submit(e)} noValidate style={{ display: "grid", gap: 12, maxWidth: 520 }}>
        <Field label={t("nameLabel")} required error={err("name")}>
          <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("typeLabel")} required error={err("type")}>
          <Select value={type} onChange={(e) => setType(e.target.value as InfraType)}>
            {INFRA_TYPES.map((v) => (
              <option key={v} value={v}>{t(`types.${v}`)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("latLabel")} required error={err("lat")}>
          <Input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
        </Field>
        <Field label={t("lngLabel")} required error={err("lng")}>
          <Input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
        </Field>
        <Field label={t("capacityLabel")} error={err("capacity")}>
          <Input value={capacity} maxLength={128} onChange={(e) => setCapacity(e.target.value)} />
        </Field>
        <Field label={t("conditionLabel")} error={err("conditionScore")}>
          <Select value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">{t("conditionUnknown")}</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={String(n)}>{`${n}/5`}</option>
            ))}
          </Select>
        </Field>
        {assetOptions.length > 0 ? (
          <Field label={t("assetLabel")} error={err("assetId")}>
            <Select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">{t("assetNone")}</option>
              {assetOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </Select>
          </Field>
        ) : null}
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
