import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/lib/directory/searchUsers", () => ({
  searchDirectoryUsers: vi.fn(async () => [{ id: "aaaaaaaa-1111-4000-8000-000000000001", label: "Asha Verma" }]),
  resolveDirectoryUsers: vi.fn(async () => []),
}));

import { FieldTaskActions } from "./FieldTaskActions";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const ID = "bbbbbbbb-1111-4000-8000-000000000001";
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("FieldTaskActions (GAP-FIELD-TASKS-05)", () => {
  it("offers Start on an assigned task and Complete on an in-progress one, nothing on a closed task", () => {
    const { rerender } = render(<FieldTaskActions id={ID} status="assigned" version={2} canAssign={false} />);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark complete" })).not.toBeInTheDocument();
    rerender(<FieldTaskActions id={ID} status="in_progress" version={3} canAssign={false} />);
    expect(screen.getByRole("button", { name: "Mark complete" })).toBeInTheDocument();
    rerender(<FieldTaskActions id={ID} status="completed" version={4} canAssign />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(<FieldTaskActions id={ID} status="cancelled" version={4} canAssign />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows Assign only to supervisors, on unassigned/assigned tasks", () => {
    const { rerender } = render(<FieldTaskActions id={ID} status="unassigned" version={1} canAssign={false} />);
    expect(screen.queryByRole("button", { name: /assign/i })).not.toBeInTheDocument();
    rerender(<FieldTaskActions id={ID} status="unassigned" version={1} canAssign />);
    expect(screen.getByRole("button", { name: "Assign" })).toBeInTheDocument();
    rerender(<FieldTaskActions id={ID} status="in_progress" version={1} canAssign />);
    expect(screen.queryByRole("button", { name: "Assign" })).not.toBeInTheDocument();
  });

  it("completes through the proxy with the pinned version only after confirmation, then refreshes", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ accepted: true }), { status: 202 }));
    render(<FieldTaskActions id={ID} status="in_progress" version={7} canAssign={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Complete task" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/proxy/v1/field/tasks/${ID}/complete`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ version: 7 });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("surfaces a version conflict as a friendly message, never the raw server text", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "VERSION_CONFLICT", message: "RAW-SERVER-DETAIL" }), { status: 409 }),
    );
    render(<FieldTaskActions id={ID} status="in_progress" version={7} canAssign={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Complete task" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("RAW-SERVER-DETAIL");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("blocks Assign confirmation until an agent is picked, and sends nothing meanwhile", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    render(<FieldTaskActions id={ID} status="unassigned" version={1} canAssign />);
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    const confirm = await screen.findByRole("button", { name: "Assign task" });
    expect(confirm).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fieldTasks messages", () => {
  it("every key exists in en and hi, and hi is really translated", () => {
    const en = (enMessages as unknown as Record<string, Record<string, string>>).fieldTasks!;
    const hi = (hiMessages as unknown as Record<string, Record<string, string>>).fieldTasks!;
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect(hi[k], k).not.toBe(en[k]);
  });
});
