import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ContactForm } from "./ContactForm";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fillValid() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Priya Das" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "priya@example.gov.in" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /agree to be contacted/i }));
}

const accepted = () =>
  new Response(JSON.stringify({ status: "accepted", reference: "11111111-2222-3333-4444-555555666677" }), {
    status: 202,
  });

describe("ContactForm", () => {
  it("blocks submit and shows inline errors when required fields are empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ContactForm />);

    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(screen.getByText("Please enter your name.")).toBeInTheDocument());
    expect(screen.getByText("Please enter your email address.")).toBeInTheDocument();
    expect(screen.getByText(/confirm you agree/i)).toBeInTheDocument();
    // No network call for a client-invalid form.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid email client-side", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ContactForm />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /agree to be contacted/i }));
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(screen.getByText("Please enter a valid email address.")).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits and shows the server reference number", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => accepted()));
    render(<ContactForm />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(screen.getByTestId("contact-success")).toBeInTheDocument());
    expect(screen.getByTestId("contact-reference").textContent).toBe(
      "11111111-2222-3333-4444-555555666677",
    );
  });

  it("tells the user to email us when the backend is not configured (503)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    render(<ContactForm />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/not available right now/i);
    expect(screen.queryByTestId("contact-success")).toBeNull();
  });

  it("surfaces rate-limit backpressure (429)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    render(<ContactForm />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/too many submissions/i));
  });

  it("posts the collected fields to /api/contact", async () => {
    const fetchMock = vi.fn(async () => accepted());
    vi.stubGlobal("fetch", fetchMock);
    render(<ContactForm />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/contact");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.name).toBe("Priya Das");
    expect(body.email).toBe("priya@example.gov.in");
    expect(body.consent).toBe(true);
    expect(body.topic).toBe("sales");
  });
});
