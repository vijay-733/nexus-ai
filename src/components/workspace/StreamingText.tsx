import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface StreamingTextProps {
  content: string;
  streaming?: boolean;
  className?: string;
  markdown?: boolean;
}

// ── CSP-safe inline markdown renderer ────────────────────────────────────────
// Handles the most common markdown constructs without any eval / new Function.

function inlineFormat(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <code key={i} className="bg-[var(--color-nexus-elevated)] px-1 rounded text-[11px] font-mono">
          {part.slice(1, -1)}
        </code>
      );
    return part;
  });
}

function SimpleMarkdown({ content }: { content: string }) {
  const lines  = content.split('\n');
  const result: ReactNode[] = [];
  let key      = 0;
  let listBuf: string[] = [];
  let codeBuf: string[] = [];
  let inCode   = false;

  const flushList = () => {
    if (!listBuf.length) return;
    result.push(
      <ul key={key++} className="list-disc pl-5 space-y-0.5 my-1">
        {listBuf.map((item, i) => (
          <li key={i} className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
            {inlineFormat(item)}
          </li>
        ))}
      </ul>
    );
    listBuf = [];
  };

  const flushCode = () => {
    if (!codeBuf.length) return;
    result.push(
      <pre key={key++} className="bg-[var(--color-nexus-elevated)] rounded-lg p-3 text-xs font-mono overflow-x-auto my-2 text-[var(--color-text-secondary)]">
        <code>{codeBuf.join('\n')}</code>
      </pre>
    );
    codeBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trimStart().startsWith('```')) {
      if (inCode) { flushCode(); inCode = false; }
      else        { flushList(); inCode = true; }
      continue;
    }

    if (inCode) { codeBuf.push(line); continue; }

    if (line.startsWith('### ')) {
      flushList();
      result.push(<h3 key={key++} className="text-sm font-bold mt-4 mb-1 text-[var(--color-text-primary)]">{inlineFormat(line.slice(4))}</h3>);
    } else if (line.startsWith('## ')) {
      flushList();
      result.push(<h2 key={key++} className="text-base font-bold mt-4 mb-1.5 text-[var(--color-text-primary)]">{inlineFormat(line.slice(3))}</h2>);
    } else if (line.startsWith('# ')) {
      flushList();
      result.push(<h1 key={key++} className="text-lg font-bold mt-4 mb-2 text-[var(--color-text-primary)]">{inlineFormat(line.slice(2))}</h1>);
    } else if (/^[-*] /.test(line)) {
      listBuf.push(line.slice(2));
    } else if (/^\d+\. /.test(line)) {
      listBuf.push(line.replace(/^\d+\. /, ''));
    } else if (line.trim() === '') {
      flushList();
      if (result.length > 0) result.push(<div key={key++} className="h-2" />);
    } else {
      flushList();
      result.push(
        <p key={key++} className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {inlineFormat(line)}
        </p>
      );
    }
  }

  flushList();
  flushCode();

  return <>{result}</>;
}

// ─────────────────────────────────────────────────────────────────────────────

export function StreamingText({ content, streaming, className, markdown = true }: StreamingTextProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = divRef.current ?? preRef.current;
    if (streaming && el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [content, streaming]);

  if (markdown) {
    return (
      <div
        ref={divRef}
        className={cn('space-y-1', streaming && 'streaming-cursor', className)}
      >
        <SimpleMarkdown content={content} />
      </div>
    );
  }

  return (
    <pre
      ref={preRef}
      className={cn(
        'font-mono text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap break-words',
        streaming && 'streaming-cursor',
        className
      )}
    >
      {content}
    </pre>
  );
}
