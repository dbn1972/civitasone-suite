import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { APIKeyActions } from "./APIKeyActions";

const SCOPES_URL = "/api/proxy/v1/admin/api-keys/scopes";
const CATALOGUE = ["config:read", "config:write", "api-keys:read"];

/** fetch mock: the scope catalogue GET always succeeds; everything else goes to `rest`. */
function mockFetch(rest: () => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    String(input) === SCOPES_URL
      ? new Response(JSON.stringify({ data: CATALOGUE }), { status: 200, headers: { "content-type": "application/json" } })
      : rest(),
  );
}
const writeCalls = (spy: ReturnType<typeof mockFetch>) => spy.mock.calls.filter((c) => String(c[0]) !== SCOPES_URL);
async function pickScope(scope: string) {
  fireEvent.click(await screen.findByRole("checkbox", { name: scope }));
}

describe("APIKeyActions — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when creating a key fails", async () => {
    mockFetch(() => new Response("internal error: connection to vault timed out", { status: 500 }));

    render(<APIKeyActions keys={[]} />);
    fireEvent.change(screen.getByLabelText(/Key name/i), { target: { value: "Reporting service" } });
    // GAP-TENANT-ADMIN-API-KEYS-04: scopes now default to empty, so a scope
    // must be chosen for the request to be attempted at all.
    await pickScope("config:read");
    fireEvent.click(screen.getByRole("button", { name: "Create API Key" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't save/i));
    expect(screen.getByRole("alert").textContent).not.toMatch(/vault timed out/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/\b500\b/);
  });

  it("shows a clerk-safe message in the confirm dialog, never the raw response body, when revoking a key fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "key already revoked" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    render(
      <APIKeyActions keys={[{ id: "k1", keyName: "Reporting service", status: "active" }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "no longer needed" } });
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Revoke key");
    fireEvent.click(confirmBtn!);

    await waitFor(() => expect(dialog.textContent).toMatch(/This API key was changed by someone else\. Refresh to see the latest version, then try again\./));
    expect(dialog.textContent).not.toMatch(/key already revoked/i);
    expect(dialog.textContent).not.toMatch(/\b409\b/);
  });
});

describe("APIKeyActions — GAP-TENANT-ADMIN-API-KEYS-04 (least-privilege create)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("offers the server catalogue as checkboxes, none pre-selected (no 'read:*'), and refuses to submit with none chosen", async () => {
    const fetchSpy = mockFetch(() => new Response("{}", { status: 200 }));
    render(<APIKeyActions keys={[]} />);
    const boxes = (await screen.findAllByRole("checkbox")) as HTMLInputElement[];
    expect(boxes.map((b) => b.closest("label")!.textContent)).toEqual(CATALOGUE);
    expect(boxes.every((b) => !b.checked)).toBe(true);
    expect(screen.queryByText("read:*")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Key name/i), { target: { value: "Reporting service" } });
    fireEvent.click(screen.getByRole("button", { name: "Create API Key" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/at least one scope/i));
    expect(writeCalls(fetchSpy)).toHaveLength(0);
  });

  it("a hyphenated catalogue scope (api-keys:read) is accepted and sent", async () => {
    const fetchSpy = mockFetch(() => new Response(JSON.stringify({ key: "k" }), { status: 202, headers: { "content-type": "application/json" } }));
    render(<APIKeyActions keys={[]} />);
    fireEvent.change(screen.getByLabelText(/Key name/i), { target: { value: "Svc" } });
    await pickScope("api-keys:read");
    await pickScope("config:read");
    fireEvent.click(screen.getByRole("button", { name: "Create API Key" }));
    await waitFor(() => expect(writeCalls(fetchSpy)).toHaveLength(1));
    expect(JSON.parse(String(writeCalls(fetchSpy)[0]![1]!.body)).scopes).toEqual(["api-keys:read", "config:read"]);
  });

  it("when the catalogue cannot be loaded it says so and sends nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    render(<APIKeyActions keys={[]} />);
    expect(await screen.findByText(/couldn't load the scopes you can grant/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("sends an expiresAt ISO datetime with the create request (default 90 days)", async () => {
    const fetchSpy = mockFetch(() =>
      new Response(JSON.stringify({ key: "sk_test" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    render(<APIKeyActions keys={[]} />);
    fireEvent.change(screen.getByLabelText(/Key name/i), { target: { value: "Reporting service" } });
    await pickScope("config:read");
    fireEvent.click(screen.getByRole("button", { name: "Create API Key" }));
    await waitFor(() => expect(writeCalls(fetchSpy)).toHaveLength(1));
    // GAP-TENANT-ADMIN-API-KEYS-03: writes target the same admin-service store
    // the list is read from, with the admin create field name `keyName`.
    expect(String(writeCalls(fetchSpy)[0]![0])).toBe("/api/proxy/v1/admin/api-keys");
    const body = JSON.parse(String(writeCalls(fetchSpy)[0]![1]!.body));
    expect(body).toMatchObject({ keyName: "Reporting service", scopes: ["config:read"] });
    expect(typeof body.expiresAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.expiresAt))).toBe(false);
  });

  it("omits expiresAt when 'No expiry' is chosen", async () => {
    const fetchSpy = mockFetch(() =>
      new Response(JSON.stringify({ key: "sk_test" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    render(<APIKeyActions keys={[]} />);
    fireEvent.change(screen.getByLabelText(/Key name/i), { target: { value: "Svc" } });
    await pickScope("config:read");
    fireEvent.change(screen.getByLabelText(/Expiry/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Create API Key" }));
    await waitFor(() => expect(writeCalls(fetchSpy)).toHaveLength(1));
    const body = JSON.parse(String(writeCalls(fetchSpy)[0]![1]!.body));
    expect(body.expiresAt).toBeUndefined();
  });
});

describe("APIKeyActions — GAP-TENANT-ADMIN-API-KEYS-01 (rotate safety)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("rotate is a reason-required danger action and states there is no overlap window", async () => {
    render(<APIKeyActions keys={[{ id: "k1", keyName: "Reporting service", status: "active" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/no overlap\/grace window/i);
    // Reason field present (requireReason).
    expect(within(dialog).getByLabelText(/Reason/i)).toBeInTheDocument();
  });

  it("GAP-TENANT-ADMIN-API-KEYS-03: rotate PATCHes the admin-service rotate path (same store as the list)", async () => {
    const fetchSpy = mockFetch(() =>
      new Response(JSON.stringify({ key: "civ_new" }), { status: 202, headers: { "content-type": "application/json" } }),
    );
    render(<APIKeyActions keys={[{ id: "k1", keyName: "Reporting service", status: "active" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "scheduled rotation" } });
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Rotate key");
    fireEvent.click(confirm!);
    await waitFor(() => expect(writeCalls(fetchSpy)).toHaveLength(1));
    expect(String(writeCalls(fetchSpy)[0]![0])).toBe("/api/proxy/v1/admin/api-keys/k1/rotate");
    expect(writeCalls(fetchSpy)[0]![1]!.method).toBe("PATCH");
  });
});
