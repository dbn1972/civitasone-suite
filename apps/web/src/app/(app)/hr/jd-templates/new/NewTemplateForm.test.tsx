import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: refreshMock }),
}));

import { NewTemplateForm } from "./NewTemplateForm";

const NEW_ID = "7d3f1c52-9b0e-4a64-8f21-6c5d4e3b2a10";
const EDIT_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function renderForm(templateId?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <NewTemplateForm {...(templateId ? { templateId } : {})} />
    </NextIntlClientProvider>,
  );
}

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

async function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/Template name/), { target: { value: "Junior Analyst" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
  });
}

describe("NewTemplateForm create -- GAP-HR-JD-TEMPLATES-NEW-01 (202 is not 'done')", () => {
  beforeEach(() => vi.useFakeTimers());

  it("says 'submitted', polls the new template's own GET, and moves to the library with ?created=<id> once it exists", async () => {
    let gets = 0;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ id: NEW_ID, status: "accepted" }, 202);
      gets += 1;
      // the queue consumer has not inserted the row for the first two looks
      return gets < 3 ? json({ code: "NOT_FOUND" }, 404) : json({ id: NEW_ID, name: "Junior Analyst" });
    });
    renderForm();
    await fillAndSubmit();

    expect(screen.getByText("Template submitted — it will appear in the library shortly.")).toBeInTheDocument();
    expect(screen.queryByText(/successfully/i)).not.toBeInTheDocument();
    // nothing navigates on a timer or on the bare 202
    expect(pushMock).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });

    expect(fetchMock).toHaveBeenCalledWith(`/api/proxy/v1/hrms/jd-templates/${NEW_ID}`);
    expect(gets).toBe(3);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(`/hr/jd-templates?created=${NEW_ID}`);
  });

  it("offers Continue while the write is still pending, and Continue carries the created id so the list can show a pending row", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ id: NEW_ID, status: "accepted" }, 202);
      return json({ code: "NOT_FOUND" }, 404);
    });
    renderForm();
    await fillAndSubmit();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(pushMock).toHaveBeenCalledWith(`/hr/jd-templates?created=${NEW_ID}`);
  });

  it("never navigates on its own when the template never shows (poll budget spent) -- the user keeps the choice", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ id: NEW_ID, status: "accepted" }, 202);
      return json({ code: "NOT_FOUND" }, 404);
    });
    renderForm();
    await fillAndSubmit();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });

    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Still processing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("a rejected POST shows an error and starts no polling", async () => {
    fetchMock.mockResolvedValue(json({ code: "INTERNAL", message: "boom" }, 500));
    renderForm();
    await fillAndSubmit();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("NewTemplateForm edit load -- GAP-HR-JD-TEMPLATES-DETAIL-04", () => {
  it("shows a labelled skeleton region while the template loads (no bare text line)", async () => {
    let release: (r: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Response>((res) => { release = res; }));
    renderForm(EDIT_ID);

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveAccessibleName("Loading template…");
    expect(screen.queryByLabelText(/Template name/)).not.toBeInTheDocument();

    await act(async () => { release(json({ name: "Existing", vacancyType: "regular" })); });
    expect(await screen.findByLabelText(/Template name/)).toHaveValue("Existing");
    expect(screen.queryByRole("status", { name: "Loading template…" })).not.toBeInTheDocument();
  });

  it("an unknown id says 'not found' and offers no retry (it cannot help)", async () => {
    fetchMock.mockResolvedValue(json({ code: "NOT_FOUND" }, 404));
    renderForm(EDIT_ID);

    expect(await screen.findByText("This template could not be found. It may have been removed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to JD Templates" })).toBeInTheDocument();
  });

  it("a 500 says it could not be loaded and offers Try again, which re-fetches and shows the form", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ code: "INTERNAL" }, 500))
      .mockResolvedValueOnce(json({ name: "Recovered", vacancyType: "internship" }));
    renderForm(EDIT_ID);

    expect(await screen.findByText("This template could not be loaded. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText(/may have been removed/)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByLabelText(/Template name/)).toHaveValue("Recovered");
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
  });

  it("a network failure is treated like a 5xx: retryable, not 'not found'", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(json({ name: "Back online" }));
    renderForm(EDIT_ID);

    expect(await screen.findByText("This template could not be loaded. Please try again.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await screen.findByLabelText(/Template name/)).toHaveValue("Back online");
  });
});

describe("NewTemplateForm edit save", () => {
  it("PATCH keeps the plain accepted notice (nothing new to look up) and does not poll", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return json({ id: EDIT_ID, status: "accepted" });
      return json({ name: "Existing", vacancyType: "regular" });
    });
    renderForm(EDIT_ID);
    await screen.findByLabelText(/Template name/);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    expect(screen.getByText("Update submitted — it will appear shortly.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === undefined)).toHaveLength(1); // only the initial load
    expect(pushMock).not.toHaveBeenCalled();
  });
});
