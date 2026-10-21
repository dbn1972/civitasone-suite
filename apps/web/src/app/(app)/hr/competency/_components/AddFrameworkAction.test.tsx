import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AddFrameworkAction } from "./AddFrameworkAction";

const FRAMEWORK_ID = "11111111-2222-4333-8444-555555555555";

describe("AddFrameworkAction (GAP-HR-COMPETENCY-02)", () => {
  const fetchMock = vi.fn();

  /** POST -> 201 {id}; each GET of the frameworks list answers the next entry of `lists`. */
  function routeFetch(lists: unknown[]) {
    let gets = 0;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ id: FRAMEWORK_ID, status: "active" }), { status: 201 });
      }
      gets += 1;
      return new Response(JSON.stringify(lists[Math.min(gets - 1, lists.length - 1)]), { status: 200 });
    });
    return () => gets;
  }
  const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

  beforeEach(() => {
    fetchMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function renderAction() {
    return render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddFrameworkAction />
      </NextIntlClientProvider>,
    );
  }
  async function flush(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  async function createFramework(name = "Core Competencies") {
    renderAction();
    fireEvent.click(screen.getByRole("button", { name: /add framework/i }));
    fireEvent.change(screen.getByLabelText(/framework name/i), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await flush();
  }

  it("says 'Submitted', not done, straight after the 201 -- the row is inserted asynchronously", async () => {
    routeFetch([[]]);
    await createFramework();
    expect(posts()).toHaveLength(1);
    expect(screen.getByText(/submitted — the framework will appear in the list shortly/i)).toBeInTheDocument();
    expect(screen.queryByText(/^done/i)).not.toBeInTheDocument();
    // the form is closed and the Add button is held while confirmation is pending
    expect(screen.queryByLabelText(/framework name/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add framework/i })).toBeDisabled();
  });

  it("refreshes the page data only once the new framework shows up in the list (2nd poll)", async () => {
    const gets = routeFetch([[{ id: "other" }], [{ id: "other" }, { id: FRAMEWORK_ID }]]);
    await createFramework();
    await flush(500); // 1st poll: not there yet
    expect(gets()).toBe(1);
    expect(refreshMock).not.toHaveBeenCalled();
    await flush(800); // 2nd poll: present
    expect(gets()).toBe(2);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/^done/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add framework/i })).toBeEnabled();
  });

  it("when the framework never appears it says 'still processing' with a manual Refresh, not an error", async () => {
    routeFetch([[]]);
    await createFramework();
    await flush(10_000);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/still processing/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /refresh now/i }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("shows a clerk-safe message, never the raw server text, when the POST fails", async () => {
    fetchMock.mockResolvedValue(new Response("hrms-service competency insert trace at line 12", { status: 500 }));
    await createFramework();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/couldn't save/i);
    expect(alert.textContent).not.toMatch(/hrms-service/);
    expect(alert.textContent).not.toMatch(/\b500\b/);
    // the form stays open so the typed name is not lost
    expect(screen.getByLabelText(/framework name/i)).toHaveValue("Core Competencies");
  });

  it("requires a real name before posting anything (a blank one passes the native required check)", async () => {
    renderAction();
    fireEvent.click(screen.getByRole("button", { name: /add framework/i }));
    fireEvent.change(screen.getByLabelText(/framework name/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Framework name is required.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
