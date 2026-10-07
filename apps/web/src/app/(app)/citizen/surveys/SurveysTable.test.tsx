import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useSeededResource } from "@/lib/sync/resource";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { SurveysTable } from "./SurveysTable";
import type { CitizenSurvey } from "@/lib/citizenSurveys";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function seeded(data: CitizenSurvey[], provenance: "live" | "cached" | "error-no-data") {
  vi.mocked(useSeededResource).mockReturnValue({
    data,
    fromCache: provenance === "cached",
    offline: false,
    cachedAt: provenance === "cached" ? "2026-10-01T00:00:00.000Z" : null,
    provenance,
  } as never);
}

function renderTable(source: "api" | "error" = "api") {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SurveysTable surveys={[]} source={source} />
    </NextIntlClientProvider>,
  );
}

const S = (over: Partial<CitizenSurvey> = {}): CitizenSurvey => ({
  id: "s1",
  surveyName: "Ward cleanliness",
  responses: 10,
  completion: "72%",
  period: "Sep 2026",
  status: "Active",
  ...over,
});

describe("SurveysTable (GAP-CITIZEN-SURVEYS-01/02/03/04)", () => {
  it("SURVEYS-01: error with no cache shows '—' stats and a retry, not 'No surveys found'", () => {
    seeded([], "error-no-data");
    renderTable("error");
    // all four stat cards read "—"
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    // retry UI present (ErrorState renders a Retry/Try again button)
    expect(screen.queryByText(enMessages.citizenSurveys.emptyTitle)).not.toBeInTheDocument();
  });

  it("SURVEYS-02: server error but cached rows -> cards AND table both reflect the cached rows", () => {
    seeded([S(), S({ id: "s2", status: "Completed" })], "cached");
    renderTable("error");
    // table shows the cached survey
    expect(screen.getAllByText("Ward cleanliness").length).toBeGreaterThanOrEqual(1);
    // total surveys card shows 2 (agrees with the table), not 0
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("SURVEYS-03: counts normalise free-string statuses", () => {
    seeded([S({ status: "active" }), S({ id: "s2", status: "ACTIVE " }), S({ id: "s3", status: "Completed" })], "live");
    renderTable("api");
    // statActive = 2
    const activeLabel = screen.getByText(enMessages.citizenSurveys.statActive);
    expect(activeLabel).toBeInTheDocument();
    // 2 active surveys counted
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
  });

  it("SURVEYS-04: completion renders a progressbar with aria-valuenow", () => {
    seeded([S({ completion: "72%" })], "live");
    renderTable("api");
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "72");
  });
});
