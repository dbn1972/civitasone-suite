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
