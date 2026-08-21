import type { ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  return text.split(/(`[^`]+`|@[A-Za-z0-9_-]+)/gu).filter(Boolean).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={`${key}-${index}`}>{part.slice(1, -1)}</code>;
    if (part.startsWith("@")) return <span key={`${key}-${index}`} className="font-semibold text-brand">{part}</span>;
    return <span key={`${key}-${index}`}>{part}</span>;
  });
}

export function MarkdownText({ children }: { children: string }) {
  const lines = children.split("\n");
  const nodes: ReactNode[] = [];
  let codeLines: string[] | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("```")) {
      if (codeLines) { nodes.push(<pre key={`code-${index}`}><code>{codeLines.join("\n")}</code></pre>); codeLines = undefined; }
      else codeLines = [];
      continue;
    }
    if (codeLines) { codeLines.push(line); continue; }
    if (/^#{1,3}\s/u.test(line)) {
      const text = line.replace(/^#{1,3}\s/u, "");
      nodes.push(<p key={index} className="mt-3 font-bold text-ink">{inline(text, `h-${index}`)}</p>);
    } else if (/^[-*]\s/u.test(line)) {
      nodes.push(<p key={index} className="pl-3 before:mr-2 before:content-['•']">{inline(line.slice(2), `li-${index}`)}</p>);
    } else nodes.push(<p key={index}>{inline(line, `p-${index}`)}</p>);
  }
  if (codeLines) nodes.push(<pre key="code-end"><code>{codeLines.join("\n")}</code></pre>);
  return <div className="markdown-text text-sm leading-6 text-ink">{nodes}</div>;
}
