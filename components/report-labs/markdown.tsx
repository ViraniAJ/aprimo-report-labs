"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

// Plain markdown renderer for prose the app shows outside the assistant
// (admin insights, notes). The assistant panel has its own with chart blocks.
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`text-sm leading-relaxed ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h3 className="mt-5 mb-1.5 text-base font-semibold first:mt-0">{children}</h3>,
          h2: ({ children }) => <h3 className="mt-5 mb-1.5 text-base font-semibold first:mt-0">{children}</h3>,
          h3: ({ children }) => <h4 className="mt-3 mb-1 font-medium">{children}</h4>,
          p: ({ children }) => <p className="my-1.5">{children}</p>,
          ul: ({ children }) => <ul className="my-1.5 list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5 space-y-1">{children}</ol>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono">{children}</code>,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/50 text-muted-foreground">{children}</thead>,
          th: ({ children }) => <th className="px-2 py-1.5 text-left font-medium">{children}</th>,
          td: ({ children }) => <td className="px-2 py-1.5 border-t border-border align-top">{children}</td>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{children}</a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
