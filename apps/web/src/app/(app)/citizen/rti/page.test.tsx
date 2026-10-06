import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// GAP-CITIZEN-RTI-06: roleGuard reads the session cookie via next/headers,
// unavailable under jsdom — mock it so we control the viewer's roles.
const rolesMock = vi.fn<() => string[]>(() => []);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  hasAnyRole: (sessionRoles: string[], allowed: string[]) => sessionRoles.some((r) => allowed.includes(r)),
}));

// Same scoped getTranslations workaround as grievances/page.test.tsx: next-intl's
// react-server conditional export is not set under Vitest's plain jsdom, so the
// real getTranslations throws in a Server Component test. Back it with en.json.
vi.mock("next-intl/server", async () => {
  const messages = (await import("@/messages/en.json")).default as Record<string, unknown>;
  function resolve(obj: unknown, dotted: string): unknown {
    return dotted.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
  }
  function makeT(namespace?: string) {
    const scope = namespace ? resolve(messages, namespace) : messages;
    return (key: string, values?: Record<string, unknown>) => {
      const found = resolve(scope, key);
      let str = typeof found === "string" ? found : key;
      if (values) for (const [k, v] of Object.entries(values)) str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      return str;
    };
  }
  return {
    getTranslations: async (namespace?: string) => makeT(namespace),
    getLocale: async () => "en",
    getMessages: async () => messages,
  };
});

import RTIPage from "./page";

async function render(page: Promise<React.ReactElement>) {
  const ui = await page;
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const OPEN_RTI = {
  id: "r1", rtiNo: "RTI-1", applicantName: "A", subject: "s", publicAuthority: "PWD",
  filedDate: "2099-01-01", deadlineDate: "2099-01-31", status: "received", isFirstAppeal: false,
};
const OVERDUE_RTI = {
  id: "r2", rtiNo: "RTI-2", applicantName: "B", subject: "s", publicAuthority: "PWD",
  filedDate: "2000-01-01", deadlineDate: "2000-01-31", status: "received", isFirstAppeal: false,
};
const REPLIED_RTI = {
  id: "r3", rtiNo: "RTI-3", applicantName: "C", subject: "s", publicAuthority: "PWD",
  filedDate: "2000-01-01", deadlineDate: "2000-01-31", status: "replied", isFirstAppeal: false,
};

describe("RTIPage", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); rolesMock.mockReset(); rolesMock.mockReturnValue([]); });

  it("GAP-CITIZEN-RTI-01: on source:'error' it shows the retry state and NO fabricated zeros / empty state", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await render(RTIPage());
    // RefreshErrorState copy (not the 'no applications' empty state).
    expect(screen.getByText("We couldn't load RTI applications.")).toBeInTheDocument();
    expect(screen.queryByText(enMessages.citizenRti.emptyTitle)).not.toBeInTheDocument();
    // Stat cards render "—", never a real-looking 0.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("GAP-CITIZEN-RTI-04: Open and Overdue stats match the segment predicates", async () => {
    fetchJsonMock.mockResolvedValue({ data: [OPEN_RTI, OVERDUE_RTI, REPLIED_RTI], source: "api" });
    const { container } = await render(RTIPage());
    // The four stat cards live in the stat grid; find each card by its label
    // text and read the adjacent ".val" value, so "Open" appearing again as a
    // segment tab below does not confuse the assertion.
    const statValueFor = (label: string): string | null => {
      const labs = Array.from(container.querySelectorAll(".lab"));
      const lab = labs.find((n) => n.textContent?.trim() === label);
      const card = lab?.closest(".stat");
      return card?.querySelector(".val")?.textContent?.trim() ?? null;
    };
    // Open = not closed => OPEN_RTI + OVERDUE_RTI = 2
    expect(statValueFor(enMessages.citizenRti.statOpen)).toBe("2");
    // Overdue = past deadline & not closed => OVERDUE_RTI = 1 (the card the fix added)
    expect(statValueFor(enMessages.citizenRti.statOverdue)).toBe("1");
    // Replied = 1
    expect(statValueFor(enMessages.citizenRti.statReplied)).toBe("1");
  });

  it("GAP-CITIZEN-RTI-06: a non-officer viewer sees the applicant name masked (DPDP)", async () => {
    rolesMock.mockReturnValue(["citizen"]);
    const named = { ...OPEN_RTI, applicantName: "Ramesh Kumar" };
    fetchJsonMock.mockResolvedValue({ data: [named], source: "api" });
    await render(RTIPage());
    expect(screen.queryByText("Ramesh Kumar")).not.toBeInTheDocument();
    // maskName("Ramesh Kumar") -> "R••••• K•••r"
    expect(screen.getByText("R••••• K•••r")).toBeInTheDocument();
  });

  it("GAP-CITIZEN-RTI-06: a citizen officer sees the full applicant name", async () => {
    rolesMock.mockReturnValue(["citizen_officer"]);
    const named = { ...OPEN_RTI, applicantName: "Ramesh Kumar" };
    fetchJsonMock.mockResolvedValue({ data: [named], source: "api" });
    await render(RTIPage());
    expect(screen.getByText("Ramesh Kumar")).toBeInTheDocument();
  });
});
