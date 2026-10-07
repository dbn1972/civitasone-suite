import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RunQueryForm } from "./RunQueryForm";

/**
 * HUMAN-REVIEW-BACKLOG #6: RunQueryForm was posting each filter row as
 * `{ field, operator, value }`, but every schema the analytics-service
 * actually validates against (registry/spec.ts filterSchema, lines 9-11;
 * the analytics-query validators use the same `op` key) expects `{ field, op, value }`.
 * The mismatched key meant filters were silently dropped (or the request was
 * rejected) server-side with no visible error to the user. This test pins the
 * real wire contract so a regression fails loudly.
 */

const CATALOG = {
  metrics: [{ key: "amount_total", label: "Total Amount" }],
  dimensions: [{ key: "dept", label: "Department" }],
  filters: [{ key: "status", label: "Status", type: "string" }],
  operators: ["eq", "neq"],
};

describe("RunQueryForm — wire contract", () => {
  const f = vi.fn();
  beforeEach(() => {
    f.mockReset();
    vi.stubGlobal("fetch", f);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts filter rows with `op`, not `operator`, matching the server's filterSchema", async () => {
    f.mockImplementation((url: string) => {
      if (url.includes("/catalog")) {
        return Promise.resolve({ ok: true, json: async () => CATALOG });
      }
      if (url.includes("/queries/run")) {
        return Promise.resolve({ ok: true, status: 202, json: async () => ({ data: { runId: "r1" } }) });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    render(<RunQueryForm />);

    await waitFor(() => expect(screen.getByLabelText(/metric/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/query name/i), { target: { value: "My Test Query" } });

    fireEvent.click(screen.getByRole("button", { name: /add filter/i }));

    const valueInputs = screen.getAllByLabelText(/value/i);
    fireEvent.change(valueInputs[valueInputs.length - 1], { target: { value: "active" } });

    fireEvent.click(screen.getByRole("button", { name: /run query/i }));

    await waitFor(() => {
      const runCall = f.mock.calls.find(([url]) => typeof url === "string" && url.includes("/queries/run"));
      expect(runCall).toBeDefined();
    });

    const [, options] = f.mock.calls.find(([url]) => typeof url === "string" && url.includes("/queries/run"))!;
    const body = JSON.parse((options as RequestInit).body as string);

    expect(body.spec.filters).toHaveLength(1);
    expect(body.spec.filters[0]).toHaveProperty("op");
    expect(body.spec.filters[0]).not.toHaveProperty("operator");
    expect(body.spec.filters[0].field).toBe("status");
    expect(body.spec.filters[0].value).toBe("active");
  });
});
