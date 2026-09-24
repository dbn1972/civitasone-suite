import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

type Kind = "success" | "error" | "info" | "warning";

function Trigger({ type, message }: { type: Kind; message: string }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast[type](message)}>
      fire {type}
    </button>
  );
}

function renderToast(type: Kind, message = `${type} message`): HTMLElement {
  render(
    <ToastProvider>
      <Trigger type={type} message={message} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByText(`fire ${type}`));
  return screen.getByRole("alert");
}

describe("Toast", () => {
  it("renders a toast as role=alert with the given message", () => {
    const el = renderToast("success", "Saved successfully");
    expect(el).toHaveTextContent("Saved successfully");
  });

  // Colors used to be hardcoded hex (e.g. #f0fdf4/#22c55e for success),
  // fixed at whatever contrast they happened to have, and identical in light
  // and dark mode. Using the civitas-ds.css tokens instead means the toast
  // now follows the same light/dark palette as every other themed component
  // (--good etc. are redefined under `.dark`, toggled on <html>).
  describe("uses theme tokens instead of hardcoded colors", () => {
    it("success toast references --good / --goodbg", () => {
      const style = renderToast("success").getAttribute("style") ?? "";
      expect(style).toContain("var(--goodbg");
      expect(style).toContain("var(--good,");
    });

    it("error toast references --bad / --badbg", () => {
      const style = renderToast("error").getAttribute("style") ?? "";
      expect(style).toContain("var(--badbg");
      expect(style).toContain("var(--bad,");
    });

    it("info toast references --info / --infobg", () => {
      const style = renderToast("info").getAttribute("style") ?? "";
      expect(style).toContain("var(--infobg");
      expect(style).toContain("var(--info,");
    });

    it("warning toast references --warn / --warnbg", () => {
      const style = renderToast("warning").getAttribute("style") ?? "";
      expect(style).toContain("var(--warnbg");
      expect(style).toContain("var(--warn,");
    });

    it("message text color references --ink rather than a hardcoded hex", () => {
      const style = renderToast("success").getAttribute("style") ?? "";
      expect(style).toContain("var(--ink,");
    });
  });
});
