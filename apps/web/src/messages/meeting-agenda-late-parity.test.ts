import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

const KEYS = ["agendaPastDeadline", "agendaPastDeadlineNoDate", "agendaPastDeadlineAskChair", "agendaLateReasonLabel", "agendaLateSubmit", "agendaLateAdded", "agendaLocked"];

describe("meetingLifecycle late-agenda strings", () => {
  const E = (en as unknown as { meetingLifecycle: Record<string, string> }).meetingLifecycle;
  const H = (hi as unknown as { meetingLifecycle: Record<string, string> }).meetingLifecycle;
  it.each(KEYS)("%s exists in English and Hindi, Hindi is Devanagari, and the {date} placeholder matches", (k) => {
    expect(E[k]).toBeTruthy();
    expect(H[k]).toMatch(/[ऀ-ॿ]/);
    expect(H[k]).not.toBe(E[k]);
    expect(H[k]!.includes("{date}")).toBe(E[k]!.includes("{date}"));
  });
});

describe("meetingLifecycle late-request strings", () => {
  const E = (en as unknown as { meetingLifecycle: Record<string, any> }).meetingLifecycle;
  const H = (hi as unknown as { meetingLifecycle: Record<string, any> }).meetingLifecycle;
  const flat = (o: Record<string, any>, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  const get = (o: Record<string, any>, path: string) => path.split(".").reduce<any>((a, k) => a?.[k], o) as string;
  const keys = flat(Object.fromEntries(Object.entries(E).filter(([k]) => k.startsWith("lateReq"))));
  it("has English and Hindi for every lateReq* key, with matching placeholders", () => {
    expect(keys.length).toBeGreaterThanOrEqual(17);
    for (const k of keys) {
      expect(get(H, k), k).toMatch(/[\u0900-\u097F]/);
      expect(/\{reason\}/.test(get(H, k))).toBe(/\{reason\}/.test(get(E, k)));
    }
  });
});
