import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import DocsPage from "./page";
import ChapterPage, { generateMetadata } from "./[slug]/page";
import ApiDocsPage from "./api/page";
import DocsNotFound from "./not-found";
import { chapters, chapterNumber } from "./_content/chapters";
import { extractToc, slugifyHeading, MarkdownContent } from "./_content/markdown";
import { CopyCodeBlock } from "./_content/CopyCodeBlock";

const SLUGS = chapters.map((c) => c.slug);

describe("GAP-DOCS-HOME-01: new module chapters exist", () => {
  it("includes service-designer, visitor, meeting, court, inspection", () => {
    for (const slug of ["service-designer", "visitor", "meeting", "court", "inspection"]) {
      expect(SLUGS).toContain(slug);
    }
  });

  it("inserts the new chapters before glossary", () => {
    const glossaryIndex = SLUGS.indexOf("glossary");
    for (const slug of ["service-designer", "visitor", "meeting", "court", "inspection"]) {
      expect(SLUGS.indexOf(slug)).toBeLessThan(glossaryIndex);
    }
  });

  it("every new slug renders a chapter heading (generateStaticParams covers all)", () => {
    const params = chapters.map((ch) => ({ slug: ch.slug }));
    expect(params).toHaveLength(chapters.length);
    const { container } = render(<ChapterPage params={{ slug: "court" }} />);
    expect(container.querySelector("h1")?.textContent).toMatch(/Court Management/);
  });
});

describe("GAP-DOCS-HOME-02: searchable chapter grid", () => {
  it("shows all chapters with an empty query", () => {
    render(<DocsPage />);
    const grid = screen.getByTestId("docs-chapter-grid");
    expect(within(grid).getAllByRole("heading").length).toBe(chapters.length);
  });

  it("typing 'leave' surfaces the HR & Payroll chapter and hides unrelated ones", () => {
    render(<DocsPage />);
    const input = screen.getByLabelText(/search documentation/i);
    fireEvent.change(input, { target: { value: "leave" } });
    expect(screen.getByText(/HR & Payroll/)).toBeInTheDocument();
    const grid = screen.getByTestId("docs-chapter-grid");
    expect(within(grid).getAllByRole("heading").length).toBeLessThan(chapters.length);
  });

  it("shows an empty-state message when nothing matches", () => {
    render(<DocsPage />);
    fireEvent.change(screen.getByLabelText(/search documentation/i), {
      target: { value: "zzzznotathing" },
    });
    expect(screen.getByText(/No chapters match/i)).toBeInTheDocument();
  });
});

describe("GAP-DOCS-HOME-03: stable explicit numbering", () => {
  it("every chapter has an explicit number", () => {
    for (const ch of chapters) {
      expect(typeof chapterNumber(ch)).toBe("number");
    }
  });

  it("numbers are unique and do not depend on array order", () => {
    const numbers = chapters.map((c) => c.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    const reversed = [...chapters].reverse();
    const finance = reversed.find((c) => c.slug === "finance")!;
    expect(chapterNumber(finance)).toBe(2);
  });

  it("renders the explicit number on the home grid, not the index", () => {
    render(<DocsPage />);
    expect(screen.getByText(/^17\. Glossary$/)).toBeInTheDocument();
  });
});

describe("GAP-DOCS-HOME-04: no dead PDF download link", () => {
  it("docs home does not render a PDF download link", () => {
    render(<DocsPage />);
    expect(screen.queryByText(/Download as PDF/i)).not.toBeInTheDocument();
    const pdf = screen
      .queryAllByRole("link")
      .find((a) => a.getAttribute("href")?.includes("CivitasOne-User-Manual.pdf"));
    expect(pdf).toBeUndefined();
  });

  it("chapter page does not render a PDF download link", () => {
    render(<ChapterPage params={{ slug: "finance" }} />);
    const pdf = screen
      .queryAllByRole("link")
      .find((a) => a.getAttribute("href")?.includes("CivitasOne-User-Manual.pdf"));
    expect(pdf).toBeUndefined();
  });
});

describe("GAP-DOCS-SLUG-01: mobile chapter navigation", () => {
  it("renders a Chapters dropdown that links to every chapter", () => {
    const { container } = render(<ChapterPage params={{ slug: "finance" }} />);
    const details = Array.from(container.querySelectorAll("details")).find((d) =>
      d.querySelector("summary")?.textContent?.includes("Chapters")
    );
    expect(details).toBeTruthy();
    const nav = within(details as HTMLElement);
    for (const slug of SLUGS) {
      const link = nav
        .getAllByRole("link")
        .find((a) => a.getAttribute("href") === `/docs/${slug}`);
      expect(link).toBeTruthy();
    }
  });
});

describe("GAP-DOCS-SLUG-02: desktop copy and lakh grouping", () => {
  it("uses 'Tap' only within the mobile-app chapter", () => {
    for (const ch of chapters) {
      if (ch.slug === "mobile-app") continue;
      expect(ch.content.includes("Tap ")).toBe(false);
    }
    expect(chapters.find((c) => c.slug === "mobile-app")!.content.includes("Tap ")).toBe(true);
  });

  it("finance includes an Indian lakh-grouping example", () => {
    const finance = chapters.find((c) => c.slug === "finance")!;
    expect(finance.content).toContain("12,50,000");
  });
});

describe("GAP-DOCS-SLUG-03: heading anchors and table of contents", () => {
  it("slugifyHeading strips markup and produces a fragment id", () => {
    expect(slugifyHeading("**Your First Login**")).toBe("your-first-login");
    expect(slugifyHeading("Bills")).toBe("bills");
  });

  it("extractToc lists every h2/h3 heading", () => {
    const content = "## Alpha\n\ntext\n\n### Beta\n\n## Gamma";
    const toc = extractToc(content);
    expect(toc.map((t) => t.text)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(toc[0]!.id).toBe("alpha");
    expect(toc[0]!.level).toBe(2);
  });

  it("renders heading elements with matching ids so #anchor resolves", () => {
    const { container } = render(<MarkdownContent content={"## Budget\n\nbody"} />);
    const h2 = container.querySelector("h2");
    expect(h2?.getAttribute("id")).toBe("budget");
  });

  it("chapter page renders an On this page navigation", () => {
    const { container } = render(<ChapterPage params={{ slug: "finance" }} />);
    const tocLinks = Array.from(container.querySelectorAll('a[href^="#"]'));
    expect(tocLinks.length).toBeGreaterThan(0);
  });
});

describe("GAP-DOCS-SLUG-04: docs-specific not-found", () => {
  it("shows a docs message with a link back and the chapter list", () => {
    render(<DocsNotFound />);
    expect(screen.getByText(/documentation page was not found/i)).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links.find((a) => a.getAttribute("href") === "/docs")).toBeTruthy();
    expect(links.find((a) => a.getAttribute("href") === "/docs/court")).toBeTruthy();
  });
});

describe("GAP-DOCS-SLUG-05: consistent title suffix", () => {
  it("uses the '— CivitasOne' suffix, matching other marketing pages", () => {
    const meta = generateMetadata({ params: { slug: "finance" } });
    expect(meta.title).toBe("Finance — CivitasOne");
    expect(meta.title).not.toMatch(/CivitasOne Docs/);
  });
});

describe("GAP-DOCS-API-01: no fabricated counts", () => {
  it("does not display the unsourced 33 services or 1,185 endpoints claims", () => {
    render(<ApiDocsPage />);
    expect(screen.queryByText(/33 microservices/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1,185/)).not.toBeInTheDocument();
    expect(screen.queryByText(/top 35 most-used/i)).not.toBeInTheDocument();
  });

  it("labels the service grid as a selection and shows the derived sum (279)", () => {
    render(<ApiDocsPage />);
    expect(screen.getByText(/Services \(selected\)/i)).toBeInTheDocument();
    // 45+62+38+12+28+18+22+16+24+14 = 279
    expect(screen.getByText(/279 endpoints/)).toBeInTheDocument();
  });
});

describe("GAP-DOCS-API-02: secret-handling guidance", () => {
  it("tells readers to keep the client_secret server-side", () => {
    render(<ApiDocsPage />);
    expect(screen.getByText(/Keep secrets server-side/i)).toBeInTheDocument();
    expect(screen.getByText(/Authorization Code flow with PKCE/i)).toBeInTheDocument();
  });
});

describe("GAP-DOCS-API-03: base URL scope", () => {
  it("labels the hosted base URL and notes self-hosting", () => {
    render(<ApiDocsPage />);
    expect(screen.getByText(/Hosted \(SaaS\) Base URL/i)).toBeInTheDocument();
    expect(screen.getByText(/Self-hosted and on-premise tenants/i)).toBeInTheDocument();
  });
});

describe("GAP-DOCS-API-04: copy-able code blocks", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("copies the exact text and confirms via aria-live", async () => {
    render(<CopyCodeBlock code={"hello world"} />);
    const button = screen.getByRole("button", { name: /copy code to clipboard/i });
    fireEvent.click(button);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello world");
    await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
  });

  it("the API page renders copy buttons for its code blocks", () => {
    render(<ApiDocsPage />);
    expect(screen.getAllByRole("button", { name: /copy code to clipboard/i }).length).toBeGreaterThanOrEqual(2);
  });
});

describe("GAP-DOCS-API-05: deployment details removed from contract", () => {
  it("does not mention SQS or Keycloak OIDC as a contract", () => {
    render(<ApiDocsPage />);
    expect(screen.queryByText(/via SQS/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Keycloak OIDC/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/OIDC-compliant identity provider/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/platform message queue/i)).toBeInTheDocument();
  });
});
