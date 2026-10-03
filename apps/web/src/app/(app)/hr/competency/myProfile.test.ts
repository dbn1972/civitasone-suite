import { describe, it, expect } from "vitest";
import { buildMyRadar, hasEnoughForRadar, MAX_RADAR_AXES } from "./myProfile";

const DEFS = [
  { id: "c1", name: "Leadership", maxLevel: 5, certifiedLevel: 3 },
  { id: "c2", name: "Communication", maxLevel: 5, certifiedLevel: 3 },
  { id: "c3", name: "Data Analysis", maxLevel: 8, certifiedLevel: 4 },
  { id: "c4", name: "Integrity", maxLevel: 5 },
];

describe("buildMyRadar", () => {
  it("plots the viewer's real held levels against each competency's certified level", () => {
    const r = buildMyRadar([{ competencyId: "c1", currentLevel: 2 }, { competencyId: "c2", currentLevel: 4 }, { competencyId: "c3", currentLevel: 6 }], DEFS);
    expect(r.scores).toEqual([
      { label: "Data Analysis", current: 6, required: 4 },
      { label: "Communication", current: 4, required: 3 },
      { label: "Leadership", current: 2, required: 3 },
    ]);
    // scale follows the biggest plotted max level, never below 5
    expect(r.maxValue).toBe(8);
  });

  it("ignores held levels whose competency definition is unknown (no invented labels)", () => {
    const r = buildMyRadar([{ competencyId: "gone", currentLevel: 3 }, { competencyId: "c1", currentLevel: 1 }], DEFS);
    expect(r.scores.map((s) => s.label)).toEqual(["Leadership"]);
  });

  it("a competency with no certified level has required 0 rather than an invented target", () => {
    expect(buildMyRadar([{ competencyId: "c4", currentLevel: 2 }], DEFS).scores[0]).toEqual({ label: "Integrity", current: 2, required: 0 });
  });

  it("caps the axes so the chart stays readable", () => {
    const defs = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, name: `Comp ${String(i).padStart(2, "0")}`, maxLevel: 5, certifiedLevel: 3 }));
    const held = defs.map((d, i) => ({ competencyId: d.id, currentLevel: (i % 5) + 1 }));
    expect(buildMyRadar(held, defs).scores.length).toBe(MAX_RADAR_AXES);
  });

  it("needs at least 3 axes to draw a radar", () => {
    expect(hasEnoughForRadar(buildMyRadar([{ competencyId: "c1", currentLevel: 1 }], DEFS))).toBe(false);
    expect(hasEnoughForRadar(buildMyRadar([{ competencyId: "c1", currentLevel: 1 }, { competencyId: "c2", currentLevel: 1 }, { competencyId: "c3", currentLevel: 1 }], DEFS))).toBe(true);
  });
});
