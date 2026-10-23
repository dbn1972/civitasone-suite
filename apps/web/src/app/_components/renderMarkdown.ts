/** Simple markdown-to-HTML renderer (bold, italic, code, links, line breaks). */
export function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, rawHref) => {
      // Strict allow-list: http(s) only, and no quote, backtick, angle bracket or
      // whitespace, so the value can never close the attribute (CLOS2-S3-01).
      // `&`, `<`, `>` were already entity-escaped above; any markup the earlier
      // bold/italic/code passes injected contains `<`/`>` and is rejected here.
      const href = /^https?:\/\/[^\s"'`<>]+$/i.test(rawHref) ? rawHref : "#";
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    })
    .replace(/\n/g, "<br>");
}
