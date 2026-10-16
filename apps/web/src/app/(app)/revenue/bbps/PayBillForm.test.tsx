import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PayBillForm } from "./PayBillForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function fillForm() {
  fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-001" } 
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "150.50" } 
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});
  fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9001" } 
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});
}

function mockFetchRouting(statusBody: Record<string, unknown>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/bbps/requests/")) {
      return Promise.resolve(new Response(JSON.stringify({ data: statusBody }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ data: { messageId: "msg-2" } }), { status: 202 }));
  
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});
}

describe("PayBillForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});

  it("requires all fields before opening the confirm dialog", () => {
    render(<PayBillForm />);
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));
    expect(screen.getByText(/Enter the assessee identifier/)).toBeInTheDocument();
    expect(screen.getByText(/Enter a valid payment amount/)).toBeInTheDocument();
    expect(screen.getByText(/Enter the BBPS transaction ID/)).toBeInTheDocument();
  
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});

  it("shows human channel labels, not raw codes (BBPS-04)", () => {
    render(<PayBillForm />);
    const select = screen.getByLabelText(/Channel/) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain("Net banking");
    expect(labels).toContain("UPI");
    expect(labels).not.toContain("netbanking");
  
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});

  it("records the payment and polls to success, linking to the receipt (BBPS-02/05)", async () => {
    mockFetchRouting({ messageId: "msg-2", status: "success", receiptId: "rc-1" 
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});

    render(<PayBillForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

    await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
    expect(screen.getByText(/₹150.50/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Record payment"));

    await waitFor(() => {
      expect(screen.getByText(/tracking its outcome below/)).toBeInTheDocument();
    
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});
    await waitFor(() => {
      expect(screen.getByText("View the receipt")).toBeInTheDocument();
    }, { timeout: 4000 
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});
  
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});

  it("shows a failure with the reason and an invitation to retry on a failed outcome (BBPS-02)", async () => {
    mockFetchRouting({ messageId: "msg-2", status: "failed", failureReason: "exceeds outstanding" 
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});

    render(<PayBillForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));
    await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record payment"));

    await waitFor(() => {
      expect(screen.getByText(/exceeds outstanding/)).toBeInTheDocument();
    }, { timeout: 4000 
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});
  
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/message (error path, UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "BBPS_OVERPAYMENT", message: "exceeds outstanding" } }), { status: 422 }),
    );

    render(<PayBillForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

    await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record payment"));

    await waitFor(() => {
      expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument();
    
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});
    expect(screen.queryByText(/BBPS_OVERPAYMENT: exceeds outstanding/)).not.toBeInTheDocument();
  
  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});

  describe("with assessees list (GAP-REVENUE-BBPS-03)", () => {
    const ASSESSEES = [
      { id: "a1", ownerName: "Priya Singh", identifierNo: "PROP-101", assesseeType: "residential" },
      { id: "a2", ownerName: "Ravi Kumar", identifierNo: "PROP-202", assesseeType: "commercial" },
    ];

    it("renders a select instead of a free-text input when assessees are provided", () => {
      render(<PayBillForm assessees={ASSESSEES} />);
      const select = screen.getByLabelText(/Assessee Identifier/) as HTMLSelectElement;
      expect(select.tagName).toBe("SELECT");
      const labels = Array.from(select.options).map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("Priya Singh"))).toBe(true);
      expect(labels.some((l) => l.includes("PROP-101"))).toBe(true);
    });

    it("shows ownerName in the confirm dialog description (GAP-REVENUE-BBPS-03)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }),
      );
      render(<PayBillForm assessees={ASSESSEES} />);
      fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-101" } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "200" } });
      fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9999" } });
      fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

      await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
      // Dialog must show the owner name, not just the raw identifier
      expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    });
  });
});
