import { describe, it, expect } from "vitest";
import { formatPerson, idTail, isRealName, nameLabel, personLabel, roleLabel, roleLabels, unresolvedLabel } from "./labels";

const ID = "82310d88-a7e7-440d-9c1e-0a1b2c3d0d88";

describe("records/labels: names, not ids (UX-R5)", () => {
  const people = new Map([[ID, { name: "Asha Rao", designation: "Section Officer" }]]);

  it("a resolved person reads Name, Designation", () => {
    expect(personLabel(people, ID)).toBe("Asha Rao, Section Officer");
    expect(formatPerson({ name: "Asha Rao", designation: null })).toBe("Asha Rao");
  });

  it("falls back to a real name the service sent", () => {
    expect(personLabel(new Map(), ID, "N. Gupta")).toBe("N. Gupta");
  });

  it("never shows Unknown officer, a UUID or a hex fragment", () => {
    for (const sent of ["Unknown officer", "Unknown vendor", ID, "82310d88", "82310d88…", "Unknown officer (82310d88)", ""]) {
      const label = personLabel(new Map(), ID, sent);
      expect(label).toBe("Name not available (ID ending 0d88)");
      expect(label).not.toMatch(/[0-9a-f]{8}-/);
    }
  });

  it("an empty id with no name is an em dash; a UUID sent as the name with no id is unresolved, not printed", () => {
    expect(personLabel(new Map(), null)).toBe("—");
    expect(personLabel(new Map(), undefined, ID)).toBe(unresolvedLabel(ID));
  });

  it("idTail / unresolvedLabel", () => {
    expect(idTail(ID)).toBe("0d88");
    expect(unresolvedLabel("  ")).toBe("—");
  });

  it("isRealName rejects placeholders", () => {
    expect(isRealName("Dell International Services India Pvt Ltd")).toBe(true);
    expect(isRealName("unknown")).toBe(false);
    expect(isRealName("System")).toBe(false);
  });

  it("nameLabel resolves vendors the same way", () => {
    const vendors = new Map([[ID, "Dell India"]]);
    expect(nameLabel(vendors, ID)).toBe("Dell India");
    expect(nameLabel(new Map(), ID, "Unknown vendor")).toBe("Name not available (ID ending 0d88)");
  });
});

describe("records/labels: role codes", () => {
  it("maps known codes to readable labels", () => {
    expect(roleLabel("proc_head")).toBe("Head of Procurement");
    expect(roleLabel("procurement_admin")).toBe("Procurement administrator");
    expect(roleLabel("tenant_admin")).toBe("Department administrator");
    expect(roleLabel("manager_approval")).toBe("Reporting officer approval");
  });

  it("hides Keycloak plumbing roles", () => {
    expect(roleLabel("default-roles-civitasone")).toBeNull();
    expect(roleLabel("offline_access")).toBeNull();
    expect(roleLabels(["default-roles-civitasone", "proc_head", "proc_head", "uma_authorization"])).toEqual(["Head of Procurement"]);
  });

  it("sentence-cases unknown codes, never prints underscores", () => {
    expect(roleLabel("records_clerk")).toBe("Records clerk");
    expect(roleLabel("")).toBeNull();
  });
});
