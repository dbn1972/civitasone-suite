import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import NewTemplatePage from "./page";

describe("NewTemplatePage (GAP-NOTIFICATIONS-TEMPLATES-01)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    push.mockReset();
  });

  it("POSTs a new template to the service and returns to the list on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<NewTemplatePage />);

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Rent reminder" } });
    fireEvent.change(screen.getByLabelText(/^body$/i), { target: { value: "Dear {{name}}, your rent is due." } });
    fireEvent.click(screen.getByRole("button", { name: /review & create/i }));

    expect(await screen.findByText("Create this template?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^create template$/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/notifications/templates"));
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("/api/proxy/notification/templates");
    expect((init as RequestInit).method).toBe("POST");
    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent).toMatchObject({ name: "Rent reminder", channel: "email" });
    expect(sent.body).toContain("{{name}}");
  });

  it("blocks save on an unbalanced placeholder", () => {
    render(<NewTemplatePage />);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Broken" } });
    fireEvent.change(screen.getByLabelText(/^body$/i), { target: { value: "Hi {{name" } });
    expect(screen.getByRole("button", { name: /review & create/i })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/placeholder looks unclosed/i);
  });
});
