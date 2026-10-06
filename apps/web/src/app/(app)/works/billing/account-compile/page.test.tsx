import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import AccountCompilePage from "./page";

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/** Mock the prior-compiles GET (returns `prior` rows) and the POST. */
function mockFetch(opts: { prior?: unknown[]; postStatus?: number; postBody?: unknown } = {}) {
  const { prior = [], postStatus = 202, postBody = { data: { id: "job-123", correlationId: "corr-1" } } } = opts;
  return vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && url.includes("/account-compile")) {
      return Promise.resolve(new Response(JSON.stringify({ data: prior }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    return Promise.resolve(new Response(JSON.stringify(postBody), { status: postStatus, headers: { "content-type": "application/json" } }));
  }) as typeof fetch);
}

describe("AccountCompilePage — ACCOUNT-COMPILE-01 confirm + reference", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("opens a confirm dialog (no POST) on Compile, naming period and recipient; Cancel makes no request", async () => {
    const fetchSpy = mockFetch();
    renderWithToast(<AccountCompilePage />);

    fireEvent.change(screen.getByLabelText(/Submitted To/i), { target: { value: "Treasury Officer, Bhubaneswar" } });
    fireEvent.click(screen.getByRole("button", { name: "Compile Account" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Treasury Officer, Bhubaneswar/)).toBeInTheDocument();
    // No POST yet — only the prior-check GET may have fired.
    const posts = fetchSpy.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(posts.length).toBe(0);

    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    const postsAfterCancel = fetchSpy.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(postsAfterCancel.length).toBe(0);
  });

  it("posts once on confirm and shows the returned reference without auto-redirecting", async () => {
    const fetchSpy = mockFetch();
    renderWithToast(<AccountCompilePage />);

    fireEvent.change(screen.getByLabelText(/Submitted To/i), { target: { value: "Treasury Officer, Bhubaneswar" } });
    fireEvent.click(screen.getByRole("button", { name: "Compile Account" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit to treasury" }));

    await waitFor(() => expect(screen.getByText(/Reference:/)).toBeInTheDocument());
    expect(screen.getByText("job-123")).toBeInTheDocument();
    // honest, no auto-redirect: a "Go to billing" link is offered instead
    expect(screen.getByRole("link", { name: /Go to billing/i })).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();

    const posts = fetchSpy.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(posts.length).toBe(1);
  });
});

describe("AccountCompilePage — ACCOUNT-COMPILE-03 already-compiled warning", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("warns when the selected month/year was already compiled", async () => {
    mockFetch({ prior: [{ id: "c1", status: "submitted", submittedTo: "Treasury Officer, Bhubaneswar", submittedAt: "2026-05-01" }] });
    renderWithToast(<AccountCompilePage />);
    await waitFor(() => expect(screen.getByText(/has already been compiled/)).toBeInTheDocument());
  });
});

describe("AccountCompilePage — ACCOUNT-COMPILE-04 FY ordering + payload", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("orders the month select FY-first (April is the first option)", () => {
    mockFetch();
    renderWithToast(<AccountCompilePage />);
    const monthSelect = screen.getByLabelText(/Month/i) as HTMLSelectElement;
    expect(monthSelect.options[0].textContent).toBe("April");
    expect(monthSelect.options[0].value).toBe("4");
  });

  it("sends the CALENDAR month/year in the payload even though the list is FY-ordered", async () => {
    const fetchSpy = mockFetch();
    renderWithToast(<AccountCompilePage />);
    fireEvent.change(screen.getByLabelText(/Month/i), { target: { value: "1" } }); // January
    fireEvent.change(screen.getByLabelText(/Submitted To/i), { target: { value: "Treasury Officer, Bhubaneswar" } });
    fireEvent.click(screen.getByRole("button", { name: "Compile Account" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit to treasury" }));

    await waitFor(() => {
      const post = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body.month).toBe(1);
      expect(typeof body.year).toBe("number");
    });
  });
});

describe("AccountCompilePage — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when the compile request fails", async () => {
    mockFetch({ postStatus: 409, postBody: {} });
    renderWithToast(<AccountCompilePage />);

    fireEvent.change(screen.getByLabelText(/Submitted To/i), { target: { value: "Treasury Officer, Bhubaneswar" } });
    fireEvent.click(screen.getByRole("button", { name: "Compile Account" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit to treasury" }));

    await waitFor(() =>
      expect(
        screen.getAllByText(/This account compile was changed by someone else\. Refresh to see the latest version, then try again\./).length,
      ).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/\b409\b/)).not.toBeInTheDocument();
  });
});
