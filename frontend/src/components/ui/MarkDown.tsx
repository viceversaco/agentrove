import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMemo, useState, useCallback, memo, useEffect, lazy, Suspense } from 'react';
import type { Components } from 'react-markdown';
import type { AnchorHTMLAttributes, HTMLAttributes, ImgHTMLAttributes } from 'react';
import { AttachmentViewer } from './AttachmentViewer';
import { Button } from './primitives/Button';
import type { MessageAttachment } from '@/types/chat.types';
import { isImageUrl } from '@/utils/fileTypes';

const Mermaid = lazy(() => import('./Mermaid').then((m) => ({ default: m.Mermaid })));

type CommonProps = {
  children?: React.ReactNode;
} & HTMLAttributes<HTMLElement>;

interface CodeProps extends CommonProps {
  inline?: boolean;
  className?: string;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement>;

type ImageProps = ImgHTMLAttributes<HTMLImageElement>;

const createImageAttachment = (url: string, alt?: string): MessageAttachment => {
  return {
    id: url,
    file_url: url,
    file_type: 'image',
    filename: url.split('/').pop() || alt || 'image.jpg',
    message_id: '',
    created_at: '',
  };
};

function MarkDownInner({ content, className = '' }: { content: string; className?: string }) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [remarkMathPlugin, setRemarkMathPlugin] = useState<unknown>(null);
  const [rehypeKatexPlugin, setRehypeKatexPlugin] = useState<unknown>(null);

  const needsMath = useMemo(
    () => /(^|[^\\])(\$[^$\n]+\$|\$\$[\s\S]*?\$\$|\\\(|\\\[)/.test(content),
    [content],
  );

  useEffect(() => {
    let cancelled = false;

    if (!needsMath || (remarkMathPlugin && rehypeKatexPlugin)) {
      return () => {
        cancelled = true;
      };
    }

    void Promise.all([
      import('remark-math'),
      import('rehype-katex'),
      import('katex/dist/katex.min.css'),
    ]).then(([remarkMathModule, rehypeKatexModule]) => {
      if (cancelled) return;
      setRemarkMathPlugin(() => remarkMathModule.default);
      setRehypeKatexPlugin(() => rehypeKatexModule.default);
    });

    return () => {
      cancelled = true;
    };
  }, [needsMath, remarkMathPlugin, rehypeKatexPlugin]);

  const handleCopyCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }, []);

  const components = useMemo<Components>(
    () => ({
      table: ({ children, ...props }: CommonProps) => (
        <div className="my-6 overflow-x-auto">
          <table className="min-w-full divide-y divide-border dark:divide-border-dark" {...props}>
            {children}
          </table>
        </div>
      ),
      thead: ({ children, ...props }: CommonProps) => (
        <thead className="bg-surface-secondary dark:bg-surface-dark-secondary" {...props}>
          {children}
        </thead>
      ),
      tbody: ({ children, ...props }: CommonProps) => (
        <tbody
          className="divide-y divide-border bg-surface dark:divide-border-dark dark:bg-surface-dark"
          {...props}
        >
          {children}
        </tbody>
      ),
      tr: ({ children, ...props }: CommonProps) => (
        <tr
          className="transition-colors hover:bg-surface-hover dark:hover:bg-surface-dark-hover"
          {...props}
        >
          {children}
        </tr>
      ),
      th: ({ children, ...props }: CommonProps) => (
        <th
          className="px-3 py-2 text-left text-xs font-semibold text-text-primary dark:text-text-dark-primary"
          {...props}
        >
          {children}
        </th>
      ),
      td: ({ children, ...props }: CommonProps) => (
        <td
          className="px-3 py-2 text-xs text-text-secondary dark:text-text-dark-secondary"
          {...props}
        >
          {children}
        </td>
      ),

      h1: ({ children, ...props }: CommonProps) => (
        <h1
          className="mb-3 mt-4 text-lg font-semibold text-text-primary first:mt-0 dark:text-text-dark-primary"
          {...props}
        >
          {children}
        </h1>
      ),
      h2: ({ children, ...props }: CommonProps) => (
        <h2
          className="mb-2 mt-4 text-base font-semibold text-text-primary dark:text-text-dark-primary"
          {...props}
        >
          {children}
        </h2>
      ),
      h3: ({ children, ...props }: CommonProps) => (
        <h3
          className="mb-1.5 mt-3 text-sm font-semibold text-text-primary dark:text-text-dark-primary"
          {...props}
        >
          {children}
        </h3>
      ),

      p: ({ children, ...props }: CommonProps) => {
        if (typeof children === 'string' && isImageUrl(children.trim())) {
          const url = children.trim();
          return (
            <div className="mb-3 last:mb-0">
              <AttachmentViewer attachments={[createImageAttachment(url)]} />
            </div>
          );
        }

        return (
          <p
            className="mb-3 whitespace-pre-wrap leading-5 text-text-secondary last:mb-0 dark:text-text-dark-secondary"
            {...props}
          >
            {children}
          </p>
        );
      },
      strong: ({ children, ...props }: CommonProps) => (
        <strong className="font-semibold text-text-primary dark:text-text-dark-primary" {...props}>
          {children}
        </strong>
      ),
      em: ({ children, ...props }: CommonProps) => (
        <em className="italic text-text-secondary dark:text-text-dark-secondary" {...props}>
          {children}
        </em>
      ),

      code: ({ inline, className, children, ...props }: CodeProps) => {
        const match = /language-(\w+)/.exec(className || '');
        const codeContent = String(children).replace(/\n$/, '');
        const hasNewlines = codeContent.includes('\n');
        const isInline = inline || (!match && !hasNewlines);

        if (isInline) {
          return (
            <code
              className={`rounded bg-surface-secondary px-1 py-0.5 font-mono text-xs text-text-primary dark:bg-surface-dark-secondary dark:text-text-dark-primary ${className || ''}`}
              {...props}
            >
              {codeContent}
            </code>
          );
        }

        if (!match) {
          return (
            <div className="my-4">
              <pre className="overflow-x-auto rounded-lg border border-border bg-surface-secondary p-2 dark:border-border-dark dark:bg-surface-dark-secondary">
                <code
                  className="font-mono text-xs text-text-primary dark:text-text-dark-primary"
                  {...props}
                >
                  {codeContent}
                </code>
              </pre>
            </div>
          );
        }

        const language = match[1];
        if (language === 'mermaid') {
          return (
            <Suspense
              fallback={
                <pre className="overflow-x-auto rounded-lg border border-border bg-surface-secondary p-2 dark:border-border-dark dark:bg-surface-dark-secondary">
                  <code className="font-mono text-xs text-text-primary dark:text-text-dark-primary">
                    {codeContent}
                  </code>
                </pre>
              }
            >
              <Mermaid content={codeContent} />
            </Suspense>
          );
        }

        const isCopied = copiedCode === codeContent;

        return (
          <div className="group relative my-4">
            <div className="absolute right-0 top-0 z-10 flex overflow-hidden rounded-bl">
              <div className="border-b border-l border-border bg-surface-secondary/50 px-1.5 py-0.5 text-xs font-medium text-text-tertiary dark:border-border-dark dark:bg-surface-dark-secondary dark:text-text-dark-tertiary">
                {language}
              </div>
              <Button
                onClick={() => handleCopyCode(codeContent)}
                variant="unstyled"
                className="border-b border-l border-border bg-surface-secondary/50 px-1.5 py-0.5 text-xs font-medium text-text-tertiary hover:text-text-primary dark:border-border-dark dark:bg-surface-dark-secondary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
                aria-label="Copy code"
              >
                {isCopied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-border bg-surface-secondary p-2 pt-5 dark:border-border-dark dark:bg-surface-dark-secondary">
              <code
                className={`${className || ''} font-mono text-xs text-text-primary dark:text-text-dark-primary`}
                {...props}
              >
                {codeContent}
              </code>
            </pre>
          </div>
        );
      },

      ul: ({ children, ...props }: CommonProps) => (
        <ul
          className="mb-3 list-disc space-y-1 pl-4 text-text-secondary dark:text-text-dark-secondary"
          {...props}
        >
          {children}
        </ul>
      ),
      ol: ({ children, ...props }: CommonProps) => (
        <ol
          className="mb-3 list-decimal space-y-1 pl-4 text-text-secondary dark:text-text-dark-secondary"
          {...props}
        >
          {children}
        </ol>
      ),
      li: ({ children, ...props }: CommonProps) => (
        <li className="pl-1 text-text-secondary dark:text-text-dark-secondary" {...props}>
          {children}
        </li>
      ),
      blockquote: ({ children, ...props }: CommonProps) => (
        <blockquote
          className="my-3 border-l-2 border-border pl-3 italic text-text-secondary dark:border-border-dark dark:text-text-dark-secondary"
          {...props}
        >
          {children}
        </blockquote>
      ),

      a: ({ children, href, ...props }: LinkProps) => {
        if (href && isImageUrl(href)) {
          return <AttachmentViewer attachments={[createImageAttachment(href)]} />;
        }

        return (
          <a
            href={href}
            className="text-text-primary underline transition-colors hover:text-text-secondary dark:text-text-dark-primary dark:hover:text-text-dark-secondary"
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          >
            {children}
          </a>
        );
      },

      img: ({ src, alt, ...props }: ImageProps) => {
        if (src) {
          return <AttachmentViewer attachments={[createImageAttachment(src, alt)]} />;
        }

        return (
          <img
            className="my-4 h-auto max-w-full rounded-lg border border-border dark:border-border-dark"
            alt={alt || ''}
            {...props}
          />
        );
      },

      hr: (props: HTMLAttributes<HTMLHRElement>) => (
        <hr className="my-6 border-border dark:border-border-dark" {...props} />
      ),

      pre: ({ children, ...props }: CommonProps) => (
        <pre className="overflow-x-auto" {...props}>
          {children}
        </pre>
      ),
    }),
    [copiedCode, handleCopyCode],
  );

  const mathPluginsLoading = needsMath && (!remarkMathPlugin || !rehypeKatexPlugin);

  if (mathPluginsLoading) {
    return (
      <div
        className={`whitespace-pre-wrap text-sm text-text-secondary dark:text-text-dark-secondary ${className}`}
      >
        {content}
      </div>
    );
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, ...(remarkMathPlugin ? [remarkMathPlugin as never] : [])]}
      rehypePlugins={rehypeKatexPlugin ? ([rehypeKatexPlugin] as never[]) : []}
      className={`text-sm text-text-secondary dark:text-text-dark-secondary ${className}`}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}

const MarkDown = memo(MarkDownInner);
export default MarkDown;
