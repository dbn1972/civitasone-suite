/** Simple markdown-to-HTML renderer (bold, italic, code, links, line breaks). */
export function renderMarkdown(text: string): string {
  const links: string[] = [];
  return (
    text
      .replace(/\u0000/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Links run first and are parked behind placeholders, so the bold/italic/code passes
      // can never put markup inside a link target (CLOS2-S3-08).
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, rawHref) => {
        // Strict allow-list: http(s) only, with no whitespace or angle brackets (CLOS2-S3-01).
        // Quotes, backticks and asterisks are entity-escaped, so the value can never close
        // the attribute and stays literal.
        const href = /^https?:\/\/[^\s<>]+$/i.test(rawHref)
          ? rawHref
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#39;")
              .replace(/\*/g, "&#42;")
              .replace(/`/g, "&#96;")
          : "#";
        links.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${linkText}</a>`);
        return `\u0000${links.length - 1}\u0000`;
      })
      .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>")
      .replace(/\u0000(\d+)\u0000/g, (_, i) => links[Number(i)])
  );
}
