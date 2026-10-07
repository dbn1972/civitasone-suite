import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { RegisterRTIButton } from "./RegisterRTIButton";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

const CPIO = { id: "11111111-1111-4111-8111-111111111111", name: "A. Sharma", designation: "Deputy Secretary", publicAuthority: "Municipal Corporation", department: "Water Supply" };

function mkFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/rti/cpios")) {
      return Promise.resolve(new Response(JSON.stringify({ data: [CPIO] }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (url.endsWith("/v1/citizen/rti") && init?.method === "POST") {
      return Promise.resolve(new Response(JSON.stringify({ id: "rti-1", status: "accepted" }), { status: 202, headers: { "content-type": "application/json" } }));
    }
    return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  });
}

function renderBtn() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RegisterRTIButton />
    </NextIntlClientProvider>,
  );
}

describe("RegisterRTIButton — GAP-CITIZEN-RTI-03 CPIO picker", () => {
  beforeEach(() => { refresh.mockClear(); vi.stubGlobal("fetch", mkFetch()); });
  afterEach(() => vi.unstubAllGlobals());

  it("no longer shows a '(UUID)' CPIO label or raw-UUID input", async () => {
    renderBtn();
    fireEvent.click(screen.getByRole("button", { name: "Register RTI" }));
    expect(screen.getByText("Central Public Information Officer")).toBeInTheDocument();
    expect(screen.queryByText("CPIO reference (UUID)")).toBeNull();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("searches the directory and sends the chosen CPIO id as cpioRef (no UUID typed)", async () => {
    renderBtn();
    fireEvent.click(screen.getByRole("button", { name: "Register RTI" }));

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Water bills" } });
    fireEvent.change(screen.getByLabelText("Information sought"), { target: { value: "Copies of 2024 bills" } });

    const combo = screen.getByRole("combobox");
    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: "Sharma" } });

    // The directory option appears and is picked by name.
    const option = await screen.findByRole("option", { name: /A\. Sharma/ });
    fireEvent.click(option);
    expect(await screen.findByText(/Selected: A\. Sharma/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/proxy/v1/citizen/rti",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const postCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).endsWith("/v1/citizen/rti") && (c[1] as RequestInit)?.method === "POST",
    );
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.cpioRef).toBe(CPIO.id);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("submit stays disabled until a CPIO is picked from the directory", () => {
    renderBtn();
    fireEvent.click(screen.getByRole("button", { name: "Register RTI" }));
    expect(screen.getByRole("button", { name: "Submit application" })).toBeDisabled();
  });
});
