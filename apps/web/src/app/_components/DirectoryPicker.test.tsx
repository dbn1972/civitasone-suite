import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";
import { DirectoryPicker, type DirectorySource } from "./DirectoryPicker";

// SF-06: replaces raw "paste a UUID" boxes. The picker must (a) search a real
// directory by name, (b) hand back the id, and (c) show an error -- not
// "No matches" -- when the directory fetch fails.
const CASES: Array<[DirectorySource, string, unknown, string]> = [
  ["user", "/api/proxy/v1/identity/users?limit=200", { data: [{ id: "u1", name: "Pia Officer", designation: "PIO" }] }, "Pia Officer"],
  ["department", "/api/proxy/v1/hrms/departments", { data: [{ id: "d1", name: "Finance Dept", code: "FIN" }] }, "Finance Dept"],
  ["location", "/api/proxy/v1/locations?limit=500", { data: [{ id: "l1", name: "Main Gate Block", city: "Pune" }] }, "Main Gate Block"],
  ["warehouse", "/api/proxy/v1/inventory/warehouses?limit=200", { data: [{ id: "w1", name: "Central Store", code: "CS" }] }, "Central Store"],
];

describe("DirectoryPicker", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(CASES)("%s: searches by name and reports the chosen id", async (source, url, payload, label) => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const onChange = vi.fn();
    render(<DirectoryPicker source={source} value={null} onChange={onChange} aria-label="Pick" />);

    fireEvent.change(screen.getByLabelText("Pick"), { target: { value: label.slice(0, 4) } });
    const option = await screen.findByText(label, {}, { timeout: 2000 });
    expect(String(spy.mock.calls[0]![0])).toBe(url);

    fireEvent.mouseDown(option);
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^[uldw]1$/));
  });

  it.each(CASES)("%s: a failed fetch shows an error, not No matches", async (source) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 500 }));
    render(<DirectoryPicker source={source} value={null} onChange={() => {}} aria-label="Pick" />);

    fireEvent.change(screen.getByLabelText("Pick"), { target: { value: "abc" } });
    const alert = await screen.findByRole("alert", {}, { timeout: 2000 });
    expect(alert).toHaveTextContent(/could not load/i);
    await waitFor(() => expect(screen.queryByText(/no matching/i)).not.toBeInTheDocument());
  });

  it("genuinely empty results still say no matching", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(<DirectoryPicker source="warehouse" value={null} onChange={() => {}} aria-label="Pick" />);
    fireEvent.change(screen.getByLabelText("Pick"), { target: { value: "zzz" } });
    expect(await screen.findByText("No matching warehouses", {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
