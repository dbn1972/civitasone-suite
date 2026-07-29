import { describe, it, expect } from "vitest";
import {
  validateSkills, validateCertifications, validateLanguages, validateCredentials,
  type Skill, type Certification, type Language, type Credential,
} from "../src/modules/recruitment/skills-domain.js";

const NOW = Date.parse("2026-07-29T00:00:00Z");

describe("validateSkills", () => {
  it("accepts valid skills and rejects bad proficiency / duplicates", () => {
    expect(validateSkills([{ skill: "SQL", proficiency: "advanced", yearsExperience: 5 }])).toEqual([]);
    expect(validateSkills([{ skill: "SQL", proficiency: "guru" } as Skill]).some((m) => /proficiency/.test(m))).toBe(true);
    expect(validateSkills([{ skill: "SQL", proficiency: "expert" }, { skill: "sql", proficiency: "beginner" }]).some((m) => /duplicate/.test(m))).toBe(true);
  });
});

describe("validateCertifications", () => {
  const C = (over: Partial<Certification> = {}): Certification => ({ name: "PMP", issuer: "PMI", ...over });
  it("accepts a valid certification", () => {
    expect(validateCertifications([C({ issueDate: "2020-01-01", expiryDate: "2026-01-01" })], NOW)).toEqual([]);
  });
  it("rejects expiry before issue", () => {
    expect(validateCertifications([C({ issueDate: "2022-01-01", expiryDate: "2021-01-01" })], NOW).some((m) => /precedes issue/.test(m))).toBe(true);
  });
  it("rejects a future issue date", () => {
    expect(validateCertifications([C({ issueDate: "2030-01-01" })], NOW).some((m) => /future/.test(m))).toBe(true);
  });
  it("requires name + issuer", () => {
    expect(validateCertifications([{ name: "", issuer: "" }], NOW).length).toBeGreaterThanOrEqual(2);
  });
});

describe("validateLanguages", () => {
  it("requires at least one of read/write/speak and rejects duplicates", () => {
    expect(validateLanguages([{ language: "Hindi", canSpeak: true }])).toEqual([]);
    expect(validateLanguages([{ language: "Hindi" } as Language]).some((m) => /read\/write\/speak/.test(m))).toBe(true);
    expect(validateLanguages([{ language: "Hindi", canSpeak: true }, { language: "hindi", canRead: true }]).some((m) => /duplicate/.test(m))).toBe(true);
  });
});

describe("validateCredentials", () => {
  it("validates kind, title and year range", () => {
    expect(validateCredentials([{ kind: "patent", title: "A method", year: 2021 }], NOW)).toEqual([]);
    expect(validateCredentials([{ kind: "blog", title: "x" } as Credential], NOW).some((m) => /kind/.test(m))).toBe(true);
    expect(validateCredentials([{ kind: "publication", title: "x", year: 2099 }], NOW).some((m) => /year/.test(m))).toBe(true);
  });
});
