import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApplyForm } from "./ApplyForm";
import { CAREERS_CONSENT_VERSION } from "../consent";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fill(opts: { consent?: boolean } = {}) {
  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "Priya Das" } });
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "priya@example.com" } });
  if (opts.consent !== false) fireEvent.click(screen.getByRole("checkbox", { name: /privacy notice/i }));
  fireEvent.click(screen.getByRole("button", { name: /submit application/i }));
}

const OK = () => new Response(JSON.stringify({ id: "11111111-2222-3333-4444-555555abc123", applicationNo: "REC/2026/0042", status: "applied" }), { status: 202 });

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]![1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("ApplyForm reference", () => {
  it("shows the server applicationNo, never a client-derived APP-<year> string", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => OK()));
    render(<ApplyForm jobOpeningId="job-1" />);
    fill();
    await waitFor(() => expect(screen.getByText("REC/2026/0042")).toBeTruthy());
    expect(screen.queryByText(/APP-\d{4}-ABC123/)).toBeNull();
    const link = screen.getByRole("link", { name: /track my application/i });
    expect(link.getAttribute("href")).toContain(encodeURIComponent("REC/2026/0042"));
  });

  it("falls back to an emailed-reference message when applicationNo is null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "11111111-2222-3333-4444-555555abc123", applicationNo: null }), { status: 202 })));
    render(<ApplyForm jobOpeningId="job-1" />);
    fill();
    await waitFor(() => expect(screen.getByText("Reference will be emailed")).toBeTruthy());
    expect(screen.queryByText(/APP-/)).toBeNull();
  });

  it("on 409 DUPLICATE_APPLICATION shows the existing applicationNo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "DUPLICATE_APPLICATION", message: "x", applicationNo: "REC/2026/0007" }), { status: 409 })));
    render(<ApplyForm jobOpeningId="job-1" />);
    fill();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("REC/2026/0007"));
  });
});

// GAP-RECRUITMENT-CAREERS-DETAIL-02
describe("ApplyForm DPDP consent", () => {
  it("blocks submit without the consent box: no network call, inline role=alert error", async () => {
    const fetchMock = vi.fn(async () => OK());
    vi.stubGlobal("fetch", fetchMock);
    render(<ApplyForm jobOpeningId="job-1" />);
    fill({ consent: false });
    await waitFor(() => expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/accept the privacy notice/i));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the notice (purpose + retention) and sends consent + notice version in the body", async () => {
    const fetchMock = vi.fn(async () => OK());
    vi.stubGlobal("fetch", fetchMock);
    render(<ApplyForm jobOpeningId="job-1" />);
    expect(screen.getByText(/only to assess your application/i)).toBeTruthy();
    expect(screen.getByText(/recruitment records must be retained/i)).toBeTruthy();
    fill();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetchMock)).toMatchObject({ consent: true, consentVersion: CAREERS_CONSENT_VERSION });
  });
});

// GAP-RECRUITMENT-CAREERS-DETAIL-05
describe("ApplyForm field validation", () => {
  it("malformed email: inline error under Email, no request sent", async () => {
    const fetchMock = vi.fn(async () => OK());
    vi.stubGlobal("fetch", fetchMock);
    render(<ApplyForm jobOpeningId="job-1" />);
    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "Priya Das" } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /privacy notice/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit application/i }));
    const email = screen.getByLabelText(/Email/);
    await waitFor(() => expect(email.getAttribute("aria-invalid")).toBe("true"));
    expect(document.getElementById(email.getAttribute("aria-describedby")!)!.textContent).toMatch(/valid email/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(email);
  });

  it("short mobile and 1-char name are rejected client-side, mirroring the backend", async () => {
    const fetchMock = vi.fn(async () => OK());
    vi.stubGlobal("fetch", fetchMock);
    render(<ApplyForm jobOpeningId="job-1" />);
    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "P" } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "p@example.com" } });
    fireEvent.change(screen.getByLabelText(/Mobile/), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /privacy notice/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit application/i }));
    await waitFor(() => expect(screen.getByLabelText(/Mobile/).getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByLabelText(/Full name/).getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("server 400 fieldErrors are shown under their input (Mobile)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: "VALIDATION_FAILED", message: "invalid request",
      fieldErrors: [{ field: "mobile", message: "Please enter a valid mobile number" }],
    }), { status: 400 })));
    render(<ApplyForm jobOpeningId="job-1" />);
    fill();
    const mobile = screen.getByLabelText(/Mobile/);
    await waitFor(() => expect(mobile.getAttribute("aria-invalid")).toBe("true"));
    const ids = mobile.getAttribute("aria-describedby")!.split(" ");
    expect(ids.map((i) => document.getElementById(i)?.textContent).join(" ")).toContain("Please enter a valid mobile number");
  });

  it("hint text is associated with the mobile input via aria-describedby (not placeholder-only)", () => {
    render(<ApplyForm jobOpeningId="job-1" />);
    const mobile = screen.getByLabelText(/Mobile/);
    expect(document.getElementById(mobile.getAttribute("aria-describedby")!)!.textContent).toMatch(/10 digits/);
  });
});

// GAP-RECRUITMENT-CAREERS-DETAIL-10
describe("ApplyForm internship stipend (rupees -> paise)", () => {
  function internship() {
    render(<ApplyForm jobOpeningId="job-1" vacancyType="internship" />);
  }
  it("'15000.5' is sent as exactly 1500050 paise", async () => {
    const fetchMock = vi.fn(async () => OK());
    vi.stubGlobal("fetch", fetchMock);
    internship();
    fireEvent.change(screen.getByLabelText(/Expected stipend/), { target: { value: "15000.5" } });
    fill();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).stipendExpectedMinor).toBe(1500050);
  });

  it("'1.005' (float-sensitive, 3 decimals) is rejected with 'up to 2 decimal places' and not submitted", async () => {
    const fetchMock = vi.fn(async () => OK());
    vi.stubGlobal("fetch", fetchMock);
    internship();
    fireEvent.change(screen.getByLabelText(/Expected stipend/), { target: { value: "15000.555" } });
    fill();
    await waitFor(() => expect(screen.getByLabelText(/Expected stipend/).getAttribute("aria-invalid")).toBe("true"));
    expect(document.body.textContent).toMatch(/up to 2 decimal places/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a negative stipend is rejected client-side", async () => {
    const fetchMock = vi.fn(async () => OK());
    vi.stubGlobal("fetch", fetchMock);
    internship();
    fireEvent.change(screen.getByLabelText(/Expected stipend/), { target: { value: "-5" } });
    fill();
    await waitFor(() => expect(screen.getByLabelText(/Expected stipend/).getAttribute("aria-invalid")).toBe("true"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// GAP-RECRUITMENT-CAREERS-DETAIL-09 / -07
describe("ApplyForm copy and styling", () => {
  it("placeholders do not name Delhi institutions", () => {
    const { container, unmount } = render(<ApplyForm jobOpeningId="job-1" vacancyType="internship" />);
    const all = Array.from(container.querySelectorAll("input")).map((i) => i.getAttribute("placeholder") ?? "").join(" | ");
    expect(all).not.toMatch(/Delhi|SRCC|IIT/i);
    unmount();
    const a = render(<ApplyForm jobOpeningId="job-1" vacancyType="apprenticeship" />);
    expect(Array.from(a.container.querySelectorAll("input")).map((i) => i.getAttribute("placeholder") ?? "").join(" ")).not.toMatch(/\/DL\//);
  });

  it("submit button uses the shared careers primary colour, not the old indigo", () => {
    render(<ApplyForm jobOpeningId="job-1" />);
    const btn = screen.getByRole("button", { name: /submit application/i });
    expect(btn.getAttribute("style")).toMatch(/rgb\(21, 64, 137\)|#154089/i);
  });
});
