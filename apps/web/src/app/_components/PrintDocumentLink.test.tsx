import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrintDocumentLink } from "./PrintDocumentLink";

describe("PrintDocumentLink", () => {
  it("renders a link with default label", () => {
    render(<PrintDocumentLink href="/print/voucher/123" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/print/voucher/123");
    expect(link).toHaveTextContent("Print");
  });

  it("renders with custom label", () => {
    render(<PrintDocumentLink href="/print/bill/456" label="Print Bill" />);
    expect(screen.getByRole("link")).toHaveTextContent("Print Bill");
  });

  it("opens in new tab", () => {
    render(<PrintDocumentLink href="/print/test" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
