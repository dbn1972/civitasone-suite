/**
 * Fix 4 (P1 security): private keys / device secrets must never be serialized
 * in API responses. The location list endpoint returned rsaPrivateKey (used to
 * sign pass QR codes) and rsaPublicKey; device read endpoints returned the
 * (encrypted) auth token hashes. These serializers strip that material.
 */
import { describe, it, expect } from "vitest";
import { toPublicLocation } from "../src/modules/location/repo.js";
import { toPublicDevice } from "../src/modules/device-registry/repo.js";
import type { LocationRow } from "../src/modules/location/schema.js";
import type { DeviceRow } from "../src/modules/device-registry/schema.js";

describe("Fix 4 — secret stripping in read DTOs", () => {
  it("toPublicLocation removes the RSA key pair", () => {
    const row = {
      id: "loc-1",
      tenantId: "t-1",
      name: "HQ",
      address: null,
      businessHours: {},
      capacity: 500,
      capacityThreshold: 450,
      active: true,
      rsaPublicKey: "PUBLIC_KEY_MATERIAL",
      rsaPrivateKey: "-----BEGIN RSA PRIVATE KEY-----secret-----END-----",
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "u",
      updatedBy: "u",
      version: 1,
    } as unknown as LocationRow;

    const dto = toPublicLocation(row);

    expect("rsaPrivateKey" in dto).toBe(false);
    expect("rsaPublicKey" in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(dto)).not.toContain("PUBLIC_KEY_MATERIAL");
    // Non-secret fields are preserved.
    expect(dto.name).toBe("HQ");
    expect(dto.id).toBe("loc-1");
  });

  it("toPublicDevice removes the auth token hashes and cert fingerprint", () => {
    const row = {
      id: "dev-1",
      tenantId: "t-1",
      name: "Gate Kiosk",
      deviceType: "kiosk",
      status: "active",
      online: true,
      deviceTokenHash: "enc:v2:SECRET_TOKEN_HASH",
      oldTokenHash: "enc:v2:OLD_SECRET",
      certificateFingerprint: "AA:BB:CC:DD",
      version: 1,
    } as unknown as DeviceRow;

    const dto = toPublicDevice(row);

    expect("deviceTokenHash" in dto).toBe(false);
    expect("oldTokenHash" in dto).toBe(false);
    expect("certificateFingerprint" in dto).toBe(false);
    const json = JSON.stringify(dto);
    expect(json).not.toContain("SECRET_TOKEN_HASH");
    expect(json).not.toContain("OLD_SECRET");
    expect(json).not.toContain("AA:BB:CC:DD");
    // Non-secret fields preserved.
    expect(dto.name).toBe("Gate Kiosk");
  });
});
