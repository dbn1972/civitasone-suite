"use client";

/**
 * Lightweight regex-based markdown-to-JSX renderer.
 * Handles: headings, bold, blockquotes, numbered lists, tables, code blocks, paragraphs, and horizontal rules.
 */
export function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={key++} className="my-8 border-gray-200" />);
      i++;
      continue;
    }

    // Code block (```)
    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={key++} className="my-4 overflow-x-auto rounded-lg bg-gray-900 p-4 text-sm text-gray-100">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Table
    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim().startsWith("|")) {
        tableLines.push(lines[i]!);
        i++;
      }
      elements.push(renderTable(tableLines, key++));
      continue;
    }

    // Headings
    if (line.startsWith("# ")) {
      elements.push(<h1 key={key++} className="mb-4 mt-8 text-3xl font-bold text-gray-900">{inline(line.slice(2))}</h1>);
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(<h2 key={key++} className="mb-3 mt-10 text-2xl font-bold text-gray-900">{inline(line.slice(3))}</h2>);
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      elements.push(<h3 key={key++} className="mb-2 mt-6 text-xl font-semibold text-gray-900">{inline(line.slice(4))}</h3>);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("> ")) {
        quoteLines.push(lines[i]!.slice(2));
        i++;
      }
      elements.push(
        <blockquote key={key++} className="my-4 border-l-4 border-blue-200 bg-blue-50 py-3 pl-4 pr-3 text-sm text-blue-900 rounded-r-lg">
          {quoteLines.map((ql, qi) => <p key={qi}>{inline(ql)}</p>)}
        </blockquote>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) {
        listItems.push(lines[i]!.replace(/^\d+\.\s/, ""));
        i++;
      }
      elements.push(
        <ol key={key++} className="my-4 list-decimal space-y-1 pl-6 text-gray-700">
          {listItems.map((item, li) => <li key={li}>{inline(item)}</li>)}
        </ol>
      );
      continue;
    }

    // Unordered list
    if (line.startsWith("- ")) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("- ")) {
        listItems.push(lines[i]!.slice(2));
        i++;
      }
      elements.push(
        <ul key={key++} className="my-4 list-disc space-y-1 pl-6 text-gray-700">
          {listItems.map((item, li) => <li key={li}>{inline(item)}</li>)}
        </ul>
      );
      continue;
    }

    // Paragraph
    elements.push(<p key={key++} className="my-3 text-gray-700 leading-relaxed">{inline(line)}</p>);
    i++;
  }

  return <div className="prose-custom">{elements}</div>;
}

/** Inline formatting: bold, inline code, links */
function inline(text: string): React.ReactNode {
  // Split by patterns and build nodes
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let partKey = 0;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Inline code
    const codeMatch = remaining.match(/`([^`]+)`/);

    // Find earliest match
    const matches = [
      boldMatch ? { type: "bold", index: boldMatch.index!, match: boldMatch } : null,
      codeMatch ? { type: "code", index: codeMatch.index!, match: codeMatch } : null,
    ].filter(Boolean).sort((a, b) => a!.index - b!.index);

    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    const first = matches[0]!;
    // Text before the match
    if (first.index > 0) {
      parts.push(remaining.slice(0, first.index));
    }

    if (first.type === "bold") {
      parts.push(<strong key={partKey++} className="font-semibold text-gray-900">{first.match[1]}</strong>);
      remaining = remaining.slice(first.index + first.match[0].length);
    } else if (first.type === "code") {
      parts.push(<code key={partKey++} className="rounded bg-gray-100 px-1.5 py-0.5 text-sm font-mono text-gray-800">{first.match[1]}</code>);
      remaining = remaining.slice(first.index + first.match[0].length);
    }
  }

  return <>{parts}</>;
}

/** Render a markdown table */
function renderTable(tableLines: string[], key: number): React.ReactNode {
  const rows = tableLines
    .filter((line) => !line.match(/^\|[\s\-:|]+\|$/)) // skip separator row
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
    );

  if (rows.length === 0) return null;
  const header = rows[0]!;
  const body = rows.slice(1);

  return (
    <div key={key} className="my-4 overflow-x-auto">
      <table className="w-full text-left text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200">
            {header.map((cell, ci) => (
              <th key={ci} className="py-2 pr-4 font-semibold text-gray-900">{inline(cell)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="border-b border-gray-100">
              {row.map((cell, ci) => (
                <td key={ci} className="py-2 pr-4 text-gray-700">{inline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
