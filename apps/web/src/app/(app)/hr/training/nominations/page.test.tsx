import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["hr_admin"] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import TrainingNominationsPage from "./page";

type Raw = {
  id: string;
  trainingId: string;
  employee: string;
  department: string;
  program: string;
  nominatedBy: string;
  nominationDate: string;
  programDate: string;
  status: string;
};

function raw(overrides: Partial<Raw> & Pick<Raw, "id" | "trainingId">): Raw {
  return {
    employee: "Priya Nair",
    department: "Finance",
    program: "Ethics Workshop",
    nominatedBy: "Arjun Rao",
    nominationDate: "2026-09-01",
    programDate: "2026-10-01",
    status: "nominated",
    ...overrides,
  };
}

/** Feeds the page's own mapResponse the way the real fetchJson would. */
function respondWith(rows: Raw[], opts: { total?: number; source?: "api" | "error" } = {}) {
  fetchJsonMock.mockImplementation(
    async (_url: string, fallback: unknown, o?: { mapResponse?: (p: unknown) => unknown }) => {
      if (opts.source === "error") return { data: fallback, source: "error" };
      return {
        data: o?.mapResponse?.({ data: rows, total: opts.total ?? rows.length, truncated: false }),
        source: "api",
      };
    },
  );
}

async function renderPage() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await TrainingNominationsPage()}
    </NextIntlClientProvider>,
  );
}

const statValue = (label: string) => screen.getByText(label).closest(".stat")?.querySelector(".val")?.textContent;

describe("TrainingNominationsPage Programs stat (GAP-HR-TRAINING-NOMINATIONS-05)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("counts two programmes that share a title but have different trainingIds as 2", async () => {
    respondWith([
      raw({ id: "n1", trainingId: "tr-a", program: "Ethics Workshop" }),
      raw({ id: "n2", trainingId: "tr-b", program: "Ethics Workshop" }),
    ]);
    await renderPage();
    expect(statValue("Programs")).toBe("2");
  });

  it("counts several nominations for the same programme once", async () => {
    respondWith([
      raw({ id: "n1", trainingId: "tr-a" }),
      raw({ id: "n2", trainingId: "tr-a", employee: "Arjun Rao" }),
      raw({ id: "n3", trainingId: "tr-a", employee: "Meera Iyer" }),
    ]);
    await renderPage();
    expect(statValue("Programs")).toBe("1");
    expect(statValue("Total")).toBe("3");
  });

  it("shows an em dash, not a fabricated 0, when the load failed", async () => {
    respondWith([], { source: "error" });
    await renderPage();
    expect(statValue("Programs")).toBe("—");
  });

  it("uses the translated back label and the descriptive filter placeholder", async () => {
    respondWith([raw({ id: "n1", trainingId: "tr-a" })]);
    await renderPage();
    expect(screen.getByRole("link", { name: /back to hr/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Filter by employee, programme or status…")).toBeInTheDocument();
  });
});

describe("trainingNominations Hindi namespace (GAP-HR-TRAINING-NOMINATIONS-05)", () => {
  it("has every English key, so the Hindi page can translate the back link and the filter placeholder", () => {
    const en = enMessages.trainingNominations as Record<string, string>;
    const hi = hiMessages.trainingNominations as Record<string, string>;
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
    expect(hi.backLabel).not.toBe(en.backLabel);
    expect(hi.filterPlaceholder).not.toBe(en.filterPlaceholder);
  });
});
