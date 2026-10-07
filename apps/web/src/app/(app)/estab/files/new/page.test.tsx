import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import NewFilePage from "./page";

function fill(subject = "Road repair request") {
  fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: subject } });
}

describe("NewFilePage (estab) — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("shows a clerk-safe message, never the raw backend text, when creating the file fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "dept quota exceeded for open files" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<NewFilePage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create File" }));

    await waitFor(() => expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/dept quota exceeded/i);
    expect(document.body.textContent).not.toMatch(/\b422\b/);
  });
});

describe("NewFilePage (estab) — classification is sent verbatim, no lossy remap (GAP-ESTAB-FILES-NEW-01)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("offers only the four server-enforced tiers and never the dishonest Unclassified/Restricted labels", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<NewFilePage />);
    const options = Array.from(
      (screen.getByLabelText("Classification") as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(options).toEqual(["public", "confidential", "secret", "top_secret"]);
  });

  it("sends the selected classification value unchanged (secret stays secret)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "f1" }), { status: 201 }));
    render(<NewFilePage />);
    fill();
    fireEvent.change(screen.getByLabelText("Classification"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Create File" }));

    await waitFor(() => {
      const postCall = fetchSpy.mock.calls.find(
        (c) => typeof c[0] === "string" && String(c[0]).includes("/estab/files") && (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse((postCall![1] as RequestInit).body as string);
      expect(body.classification).toBe("secret");
    });
  });
});

describe("NewFilePage (estab) — no double submit (GAP-ESTAB-FILES-NEW-05)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("fires exactly one POST even on a rapid double click after success", async () => {
    const postCalls: unknown[][] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST") { postCalls.push([url, init]); return Promise.resolve(new Response(JSON.stringify({ id: "f1", fileNo: "ADMIN/2026/0001" }), { status: 201 })); }
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
    render(<NewFilePage />);
    fill();
    const btn = screen.getByRole("button", { name: "Create File" });
    fireEvent.click(btn);
    fireEvent.click(btn);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/estab/files/f1"));
    expect(postCalls.filter((c) => String(c[0]).includes("/estab/files")).length).toBe(1);
    // Submit control is latched disabled after a successful create.
    expect(screen.getByRole("button", { name: /Creating…|Created/ })).toBeDisabled();
  });
});

describe("NewFilePage (estab) — shows allocated file number (GAP-ESTAB-FILES-NEW-06)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("surfaces the server-allocated fileNo in the success banner", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ id: "f1", fileNo: "ADMIN/2026/0042" }), { status: 201 }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
    render(<NewFilePage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /Create File/ }));

    await waitFor(() => expect(screen.getByText(/File ADMIN\/2026\/0042 created/)).toBeInTheDocument());
  });
});

describe("NewFilePage (estab) — a11y error banner (GAP-ESTAB-FILES-NEW-04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("marks the error banner role=alert and moves focus to it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    render(<NewFilePage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create File" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveFocus();
  });
});

describe("NewFilePage (estab) — cancel confirms when dirty (GAP-ESTAB-FILES-NEW-07)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("navigates immediately when the form is empty", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<NewFilePage />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(pushMock).toHaveBeenCalledWith("/estab/list");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows a discard confirmation when the officer typed something", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<NewFilePage />);
    fill("A half-typed subject");
    fireEvent.click(screen.getByText("Cancel"));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
