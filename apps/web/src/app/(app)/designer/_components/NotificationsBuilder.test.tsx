import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { emptyNotificationsDesign } from "@/app/_components/ds/designer/notificationTypes";
import type { NotificationsDesignState } from "@/app/_components/ds/designer";
import { persistNotificationTemplates } from "../_data/notificationBuilderApi";
import { NotificationsBuilder } from "./NotificationsBuilder";

vi.mock("../_data/notificationBuilderApi", async () => {
  const actual = await vi.importActual<typeof import("../_data/notificationBuilderApi")>(
    "../_data/notificationBuilderApi",
  );
  return {
    ...actual,
    persistNotificationTemplates: vi.fn(async (design: unknown) => design),
  };
});

describe("NotificationsBuilder", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows summary and opens editor with FormRenderer sample preview", () => {
    render(
      <NotificationsBuilder
        serviceKey="tl"
        serviceName="Trade License"
        pattern="certificate"
        initial={emptyNotificationsDesign("certificate")}
      />,
    );

    expect(screen.getByTestId("notifications-summary")).toHaveTextContent(/messages on/i);
    fireEvent.click(screen.getByLabelText(/Edit Application submitted SMS template/i));
    expect(screen.getByTestId("notification-sample-form")).toBeInTheDocument();
    expect(screen.getByLabelText(/Applicant name/i)).toBeInTheDocument();
  });

  // GAP-DESIGNER-DETAIL-B8-01: locale tabs + the completeness warning follow
  // the service's own locales, not a hard-coded en/hi.
  it("renders English + Odia tabs (not Hindi) for an ['en','or'] service and warns about the missing Odia locale", () => {
    render(
      <NotificationsBuilder
        serviceKey="tl"
        serviceName="Trade License"
        pattern="certificate"
        locales={["en", "or"]}
        initial={emptyNotificationsDesign("certificate")}
      />,
    );

    // The seed fills en + hi, so en/or is incomplete and the warning names Odia,
    // never "Hindi or English".
    const summary = screen.getByTestId("notifications-summary");
    expect(summary).toHaveTextContent(/ଓଡ଼ିଆ/);
    expect(summary).not.toHaveTextContent(/Hindi or English/);

    // Open a cell → the locale tabs are English + Odia, with no Hindi tab.
    fireEvent.click(screen.getByLabelText(/Edit Application submitted SMS template/i));
    const tablist = screen.getByRole("tablist", { name: /locale/i });
    const tabNames = screen.getAllByRole("tab").map((t) => t.textContent ?? "");
    expect(tablist).toBeInTheDocument();
    expect(tabNames.some((n) => n.includes("English"))).toBe(true);
    expect(tabNames.some((n) => n.includes("ଓଡ଼ିଆ"))).toBe(true);
    expect(tabNames.some((n) => n.includes("हिंदी"))).toBe(false);
  });
});

// CLOS3-S1-04: persistNotificationTemplates returns a new {matrix} each call; setDesign(saved) re-armed
// autosave so every enabled cell was GET+written every 2s with no edits.
describe("NotificationsBuilder autosave settles (CLOS3-S1-04)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const writes = () =>
    fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== undefined);
  const advance = async (times: number) => {
    for (let i = 0; i < times; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
    }
  };
  const initial = {
    matrix: { submitted: { email: { enabled: true, body: { en: "Hello" }, subject: { en: "S" } } } },
  } as unknown as NotificationsDesignState;

  beforeEach(async () => {
    vi.useFakeTimers();
    const actual = await vi.importActual<typeof import("../_data/notificationBuilderApi")>(
      "../_data/notificationBuilderApi",
    );
    vi.mocked(persistNotificationTemplates).mockImplementation(actual.persistNotificationTemplates);
    fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = init?.method === undefined ? [{ id: "t1", name: "svc:k:submitted:email" }] : { id: "t1" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops writing after the first save cycle", async () => {
    render(<NotificationsBuilder serviceKey="k" pattern="certificate" initial={initial} />);
    await advance(5);
    expect(writes()).toHaveLength(1);
  });

  it("writes again after an edit, then settles", async () => {
    render(<NotificationsBuilder serviceKey="k" pattern="certificate" initial={initial} />);
    await advance(3);
    expect(writes()).toHaveLength(1);
    fireEvent.click(screen.getByTestId("cell-submitted-email"));
    fireEvent.change(screen.getByTestId("template-body"), { target: { value: "Changed wording" } });
    await advance(5);
    expect(writes()).toHaveLength(2);
  });
  it("reports offline, not saved, and retries on the next edit when the template list is unreadable", async () => {
    let listOk = false;
    fetchMock.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === undefined) {
        return listOk
          ? new Response(JSON.stringify([{ id: "t1", name: "svc:k:submitted:email" }]), { status: 200 })
          : new Response("", { status: 503 });
      }
      return new Response(JSON.stringify({ id: "t1" }), { status: 200 });
    });
    const onSaveState = vi.fn();
    render(<NotificationsBuilder serviceKey="k" pattern="certificate" initial={initial} onSaveState={onSaveState} />);
    await advance(2);
    expect(onSaveState).toHaveBeenCalledWith("offline");
    expect(onSaveState).not.toHaveBeenCalledWith("saved");
    expect(writes()).toHaveLength(0);
    listOk = true;
    fireEvent.click(screen.getByTestId("cell-submitted-email"));
    fireEvent.change(screen.getByTestId("template-body"), { target: { value: "Changed wording" } });
    await advance(2);
    expect(onSaveState).toHaveBeenCalledWith("saved");
    expect(writes()).toHaveLength(1);
  });
});
