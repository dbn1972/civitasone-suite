import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// The departments a file can be opened in (enrolled operator divisions). One by default, so the
// form selects it; individual tests override it.
const depts = vi.hoisted(() => ({
  value: { loaded: true, failed: false, forbidden: false, divisions: ["ADMIN"] } as {
    loaded: boolean; failed: boolean; forbidden?: boolean; divisions: string[];
  },
}));
vi.mock("@/lib/estab/useEstabDivisions", () => ({ useEstabDivisions: () => depts.value }));

import NewFilePage from "./page";

function fill(subject = "Road repair request") {
  fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: subject } });
}

describe("NewFilePage (estab) — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    depts.value = { loaded: true, failed: false, divisions: ["ADMIN"] };
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
    depts.value = { loaded: true, failed: false, divisions: ["ADMIN"] };
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
    depts.value = { loaded: true, failed: false, divisions: ["ADMIN"] };
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

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/estab/files/f1?created=1"));
    expect(postCalls.filter((c) => String(c[0]).includes("/estab/files")).length).toBe(1);
    // Submit control is latched disabled after a successful create.
    expect(screen.getByRole("button", { name: /Creating…|Created/ })).toBeDisabled();
  });
});

describe("NewFilePage (estab) — the allocated file number is shown on the file page (GAP-ESTAB-FILES-NEW-06)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    depts.value = { loaded: true, failed: false, divisions: ["ADMIN"] };
  });

  // The real service acknowledges a create with 202 { id, status, correlationId }: the gapless file number is
  // allocated later, when the command is processed, so the response has no fileNo.
  const ACK = { id: "f1", status: "accepted", correlationId: "c-1" };

  it("Given the real 202 acknowledgement, Then the officer is sent to the file with ?created=1 and no invented number is shown", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_i: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify(init?.method === "POST" ? ACK : { data: [] }), { status: init?.method === "POST" ? 202 : 200 })));
    render(<NewFilePage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /Create File/ }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/estab/files/f1?created=1"));
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch(/File created with an opening yellow note/);
    // No file number is available yet, so none may be shown.
    expect(banner.textContent).not.toMatch(/\b[A-Z]+\/\d/);
  });

  it("Given an acknowledgement with no id, Then it falls back to the register instead of doing nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_i: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify(init?.method === "POST" ? {} : { data: [] }), { status: init?.method === "POST" ? 202 : 200 })));
    render(<NewFilePage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /Create File/ }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/estab/list"));
    expect(screen.getByRole("status").textContent).toMatch(/Find it in the file register/);
  });
});

describe("NewFilePage (estab) — a11y error banner (GAP-ESTAB-FILES-NEW-04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    depts.value = { loaded: true, failed: false, divisions: ["ADMIN"] };
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
    depts.value = { loaded: true, failed: false, divisions: ["ADMIN"] };
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

describe("NewFilePage (estab) — department is a pick-list, never free text or a silent ADMIN (GAP-ESTAB-FILES-NEW-03)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    depts.value = { loaded: true, failed: false, divisions: ["ADMIN", "Finance"] };
  });

  const postBody = (fetchSpy: { mock: { calls: unknown[][] } }) => {
    const call = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    return call ? JSON.parse((call[1] as RequestInit).body as string) : null;
  };

  it("Given two departments, Then the field is a select listing only them and nothing is preselected", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(<NewFilePage />);
    const dept = screen.getByLabelText("Department") as HTMLSelectElement;
    expect(dept.tagName).toBe("SELECT");
    expect(Array.from(dept.options).map((o) => o.value)).toEqual(["", "ADMIN", "Finance"]);
    expect(dept.value).toBe("");
  });

  it("Given no department was chosen, When the form is submitted, Then nothing is posted and the officer is told to select one", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(<NewFilePage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create File" }));
    expect(await screen.findByText("Select a department.")).toBeInTheDocument();
    expect(postBody(fetchSpy)).toBeNull();
  });

  it("Given Finance was chosen, Then Finance is posted, not ADMIN", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_i: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify(init?.method === "POST" ? { id: "f1" } : { data: [] }), { status: init?.method === "POST" ? 201 : 200 })));
    render(<NewFilePage />);
    fill();
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "Finance" } });
    fireEvent.click(screen.getByRole("button", { name: "Create File" }));
    await waitFor(() => expect(postBody(fetchSpy)?.dept).toBe("Finance"));
  });

  it.each([
    ["no operators are enrolled (empty list)", { loaded: true, failed: false, divisions: [] as string[] }, /No department list is available/i],
    ["the operators list is not readable for the role (403)", { loaded: true, failed: true, forbidden: true, divisions: [] as string[] }, /No department list is available/i],
  ])("Given %s, Then Department is a typed field with an explanation, and the typed value is posted", async (_n, value, note) => {
    depts.value = value;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_i: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify(init?.method === "POST" ? { id: "f1" } : { data: [] }), { status: init?.method === "POST" ? 201 : 200 })));
    render(<NewFilePage />);
    const dept = screen.getByLabelText("Department") as HTMLInputElement;
    expect(dept.tagName).toBe("INPUT");
    expect(dept.disabled).toBe(false);
    expect(screen.getByRole("note").textContent).toMatch(note);
    fill();
    fireEvent.change(dept, { target: { value: "Legal" } });
    fireEvent.click(screen.getByRole("button", { name: "Create File" }));
    await waitFor(() => expect(postBody(fetchSpy)?.dept).toBe("Legal"));
  });
});

describe("NewFilePage (estab) — a failed department load never falls back to typing (GAP-ESTAB-FILES-NEW-03)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("Given the department list failed to load (a network or server error), Then Department is a disabled select with an alert, and nothing can be posted", async () => {
    depts.value = { loaded: true, failed: true, forbidden: false, divisions: [] };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(<NewFilePage />);
    const dept = screen.getByLabelText("Department") as HTMLSelectElement;
    expect(dept.tagName).toBe("SELECT");
    expect(dept.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/Departments could not be loaded/i);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create File" }));
    expect(await screen.findByText("Select a department.")).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("Given the list is still loading, Then Department is a disabled select, not an input", () => {
    depts.value = { loaded: false, failed: false, forbidden: false, divisions: [] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(<NewFilePage />);
    const dept = screen.getByLabelText("Department") as HTMLSelectElement;
    expect(dept.tagName).toBe("SELECT");
    expect(dept.disabled).toBe(true);
  });
});

describe("NewFilePage (estab) — parent file and DAK pickers show numbers, never id fragments", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    depts.value = { loaded: true, failed: false, divisions: ["ADMIN"] };
  });

  it("after a parent file is picked, the field and the confirmation show its file number", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/files/search")) {
        return Promise.resolve(new Response(JSON.stringify({ data: [{ id: "3f9a1c2e-1111-4222-8333-444455556666", fileNo: "ADMIN/00007/2026", subject: "Road" }] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
    render(<NewFilePage />);
    fireEvent.change(screen.getByLabelText(/Parent file/i), { target: { value: "road" } });
    fireEvent.click(await screen.findByRole("button", { name: /ADMIN\/00007\/2026 — Road/ }));
    expect(await screen.findByText(/Selected: ADMIN\/00007\/2026/)).toBeInTheDocument();
    expect((screen.getByLabelText(/Parent file/i) as HTMLInputElement).value).toBe("ADMIN/00007/2026 — Selected");
    expect(document.body.textContent).not.toContain("3f9a1c2e");
  });

  it("a DAK without a number is not offered (it could only be labelled by an id fragment)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/estab/dak")) {
        return Promise.resolve(new Response(JSON.stringify({ data: [{ id: "aaaaaaaa-1111-4222-8333-444455556666" }, { id: "bbbbbbbb-1111-4222-8333-444455556666", dakNo: "DAK/2026/9" }] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
    render(<NewFilePage />);
    await waitFor(() => expect(document.body.innerHTML).toContain("DAK/2026/9"));
    expect(document.body.innerHTML).not.toContain("aaaaaaaa");
  });
});

describe("NewFilePage (estab) — one DAK, one file (GAP-ESTAB-FILES-NEW-02)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    depts.value = { loaded: true, failed: false, divisions: ["ADMIN"] };
  });

  const DAKS = [
    { id: "11111111-1111-4111-8111-111111111111", dakNo: "DAK/2026/1", status: "received", fileId: null },
    { id: "22222222-2222-4222-8222-222222222222", dakNo: "DAK/2026/2", status: "file_opened", fileId: "33333333-3333-4333-8333-333333333333" },
  ];

  function mockApi(fetchPosts: unknown[][] = []) {
    return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") { fetchPosts.push([url, init]); return Promise.resolve(new Response(JSON.stringify({ id: "f1" }), { status: 202 })); }
      if (url.includes("/estab/dak")) return Promise.resolve(new Response(JSON.stringify({ data: DAKS }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
  }

  it("only DAK entries that are not yet linked to a file are offered", async () => {
    mockApi();
    render(<NewFilePage />);
    await waitFor(() => expect(document.querySelector("#dak-options option")).toBeTruthy());
    const offered = Array.from(document.querySelectorAll("#dak-options option")).map((o) => (o as HTMLOptionElement).value);
    expect(offered).toEqual(["DAK/2026/1"]);
  });

  it("choosing a DAK posts its inwardId along with the number", async () => {
    const posts: unknown[][] = [];
    mockApi(posts);
    render(<NewFilePage />);
    await waitFor(() => expect(document.querySelector("#dak-options option")).toBeTruthy());
    fill();
    fireEvent.change(document.getElementById("dakNo") as HTMLInputElement, { target: { value: "DAK/2026/1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create File" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(JSON.parse((posts[0]![1] as RequestInit).body as string)).toMatchObject({ dakNo: "DAK/2026/1", inwardId: "11111111-1111-4111-8111-111111111111" });
  });

  it("a typed DAK number that is not an offered entry (or is already linked) blocks the submit", async () => {
    const posts: unknown[][] = [];
    mockApi(posts);
    render(<NewFilePage />);
    await waitFor(() => expect(document.querySelector("#dak-options option")).toBeTruthy());
    fill();
    fireEvent.change(document.getElementById("dakNo") as HTMLInputElement, { target: { value: "DAK/2026/2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create File" }));
    expect(await screen.findByText(/not yet linked to a file/i)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it("a 409 from the service (DAK linked meanwhile) shows a humanised message, never the code", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ code: "DAK_ALREADY_LINKED", message: "this DAK is already linked to a file" }), { status: 409 }));
      if (url.includes("/estab/dak")) return Promise.resolve(new Response(JSON.stringify({ data: DAKS }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
    render(<NewFilePage />);
    await waitFor(() => expect(document.querySelector("#dak-options option")).toBeTruthy());
    fill();
    fireEvent.change(document.getElementById("dakNo") as HTMLInputElement, { target: { value: "DAK/2026/1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create File" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/DAK_ALREADY_LINKED|409|already linked to a file/);
    expect(alert.textContent?.length).toBeGreaterThan(10);
  });
});
