import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AcceptedNotice } from "./AcceptedNotice";
import { ACCEPTED_COPY } from "@/lib/acceptedCopy";

const en = ACCEPTED_COPY.en;
const notice = () => document.querySelector("[data-accepted-phase]") as HTMLElement;

describe("AcceptedNotice", () => {
  it("renders nothing while idle", () => {
    const { container } = render(<AcceptedNotice phase="idle" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("submitting: polite busy status, no refresh button", () => {
    render(<AcceptedNotice phase="submitting" onRefresh={() => {}} />);
    const s = notice();
    expect(s).toHaveTextContent(en.submitting);
    expect(s).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: en.refresh })).toBeNull();
  });

  it("pending: says received/updating and offers a refresh", () => {
    const onRefresh = vi.fn();
    render(<AcceptedNotice phase="pending" onRefresh={onRefresh} />);
    expect(notice()).toHaveTextContent(en.pending);
    fireEvent.click(screen.getByRole("button", { name: en.refresh }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("accepted: honest 'will appear shortly', never a success claim; hint only after a refresh", () => {
    const { rerender } = render(<AcceptedNotice phase="accepted" onRefresh={() => {}} />);
    expect(notice()).toHaveTextContent(en.accepted);
    expect(screen.queryByText(en.confirmed)).toBeNull();
    expect(screen.queryByText(en.refreshedHint)).toBeNull();
    rerender(<AcceptedNotice phase="accepted" refreshed onRefresh={() => {}} />);
    expect(screen.getByText(en.refreshedHint)).toBeInTheDocument();
  });

  it("timed_out: still processing with a refresh", () => {
    render(<AcceptedNotice phase="timed_out" onRefresh={() => {}} />);
    expect(notice()).toHaveTextContent(en.timedOut);
    expect(screen.getByRole("button", { name: en.refresh })).toBeInTheDocument();
  });

  it("confirmed: done, no refresh needed", () => {
    render(<AcceptedNotice phase="confirmed" onRefresh={() => {}} />);
    expect(notice()).toHaveTextContent(en.confirmed);
    expect(screen.queryByRole("button", { name: en.refresh })).toBeNull();
  });

  it("error: role=alert with the supplied message, or the generic fallback", () => {
    const { rerender } = render(<AcceptedNotice phase="error" error="Quota exceeded" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Quota exceeded");
    rerender(<AcceptedNotice phase="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent(en.failed);
  });

  it("dismiss calls onDismiss", () => {
    const onDismiss = vi.fn();
    render(<AcceptedNotice phase="accepted" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: en.dismiss }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("message and labels overrides win over the default copy", () => {
    render(<AcceptedNotice phase="accepted" message="Holiday received" labels={{ dismiss: "X" }} onDismiss={() => {}} />);
    expect(notice()).toHaveTextContent("Holiday received");
    expect(screen.getByRole("button", { name: "X" })).toBeInTheDocument();
  });

  it("renders Hindi copy when the locale cookie is hi", () => {
    document.cookie = "locale=hi";
    try {
      render(<AcceptedNotice phase="accepted" />);
      expect(notice()).toHaveTextContent(ACCEPTED_COPY.hi.accepted);
    } finally {
      document.cookie = "locale=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    }
  });
});
