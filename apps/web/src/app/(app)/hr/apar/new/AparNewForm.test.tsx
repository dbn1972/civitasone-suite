import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// CLOS3-S2-03: POST /v1/hrms/apar is a queued (F3) write -- it returns {id} before the consumer has written the
// row, so the form must wait for the detail row to be readable before navigating to it.
const pushMock = vi.fn();
const refreshMock = vi.fn();
const routerStub = { push: pushMock, refresh: refreshMock };
vi.mock("next/navigation", () => ({ useRouter: () => routerStub }));

const EMPLOYEES = [
  { id: "550e8400-e29b-41d4-a716-446655440000", label: "Alice Appraisee (E100)" },
  { id: "550e8400-e29b-41d4-a716-446655440001", label: "Bob Reporting (E101)" },
  { id: "550e8400-e29b-41d4-a716-446655440002", label: "Carol Reviewing (E102)" },
  { id: "550e8400-e29b-41d4-a716-446655440003", label: "Dave Accepting (E103)" },
];
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: async (q: string) => EMPLOYEES.filter((e) => e.label.toLowerCase().includes(q.toLowerCase())),
  resolveEmployees: async () => [],
}));

import AparNewForm from "./AparNewForm";

const NEW_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

async function pickEmployee(fieldLabel: string, personLabel: string) {
  const input = screen.getByLabelText(fieldLabel, { exact: false });
  fireEvent.change(input, { target: { value: personLabel.slice(0, 4) } });
  const option = await screen.findByText(personLabel);
  fireEvent.mouseDown(option);
}

/** Fills the form with real timers (EntityPicker debounces), then switches to fake timers and submits. */
async function fillAndSubmit() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AparNewForm />
    </NextIntlClientProvider>,
  );
  await pickEmployee("Employee", "Alice Appraisee (E100)");
  await pickEmployee("Reporting Officer", "Bob Reporting (E101)");
  await pickEmployee("Reviewing Officer", "Carol Reviewing (E102)");
  await pickEmployee("Accepting Authority", "Dave Accepting (E103)");
  vi.useFakeTimers();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /initiate apar/i }));
  });
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("AparNewForm -- CLOS3-S2-03 queued create", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("navigates to the detail page only after the row is readable (GET 404 then 200)", async () => {
    let gets = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ id: NEW_ID }), { status: 201 });
      gets += 1;
      return new Response("{}", { status: gets < 3 ? 404 : 200 });
    });
    await fillAndSubmit();

    expect(pushMock).not.toHaveBeenCalled();
    await advance(600);
    expect(gets).toBeGreaterThanOrEqual(1);
    expect(pushMock).not.toHaveBeenCalled();
    await advance(10_000);
    expect(gets).toBe(3);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(`/hr/apar/${NEW_ID}`);
    expect(fetchMock).toHaveBeenCalledWith(`/api/proxy/v1/hrms/apar/${NEW_ID}`, expect.anything());
  });

  it.each([
    ["an empty body", "{}"],
    ["a non-UUID id", JSON.stringify({ id: "not-a-uuid" })],
    ["a non-JSON body", "<html>"],
  ])("does not navigate and shows an error when the 201 carries %s", async (_label, body) => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(body, { status: 201 });
      return new Response("{}", { status: 200 });
    });
    await fillAndSubmit();
    await advance(15_000);

    expect(pushMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("when the row never becomes readable, shows the accepted notice and a link to the list instead of navigating", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ id: NEW_ID }), { status: 201 });
      return new Response("{}", { status: 404 });
    });
    await fillAndSubmit();
    await advance(60_000);

    expect(pushMock).not.toHaveBeenCalled();
    expect(document.querySelector("[data-accepted-phase='timed_out']")).not.toBeNull();
    const link = screen.getByRole("link", { name: /back to apar list/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/hr/apar");
    // Double-submit guard stays on: a second create would only 409 as a duplicate.
    expect(screen.getByRole("button", { name: /initiat/i })).toBeDisabled();
  });

  it("keeps the existing error path when the POST is not ok", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await fillAndSubmit();
    await advance(1000);

    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't save|could not save|try again/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
