/** B6: the screen manifest is keyed on the catalogue manifestKey, not on the edition string. Pure. */
import { describe, expect, it } from "vitest";
import { manifestKeyFor } from "@civitasone/tenant-profile";
import { resolveManifest } from "../src/screen-manifest.js";

const settings = { msme: { sector: "manufacturing" } };

describe("B6 screen manifest by manifestKey", () => {
  it("small_office (manifestKey msme) with a sector gets the sector manifest", () => {
    const m = resolveManifest("small_office", settings, manifestKeyFor(null, "small_office"));
    expect(m.sector).toBe("manufacturing");
    expect(m.features.production).toBe(true);
  });
  it("govt, psu and section8 (manifestKey default) get the unchanged generic manifest even if settings carry an msme sector", () => {
    for (const e of ["govt", "govt_dept", "psu", "section8"]) {
      const m = resolveManifest(e, settings, manifestKeyFor(null, e));
      expect(m.sector, e).toBeNull();
      expect(m.features, e).toEqual({});
    }
  });
  it("the key, not the edition word, decides", () => {
    expect(resolveManifest("section8", settings, "msme").sector).toBe("manufacturing");
    expect(resolveManifest("small_office", settings, "default").sector).toBeNull();
  });
  it("omitting the key derives it from the edition (back-compat)", () => {
    expect(resolveManifest("small_office", settings).sector).toBe("manufacturing");
    expect(resolveManifest("govt", settings).sector).toBeNull();
  });
});
