import { memo, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { TextBlock } from '@shared/message-block'

interface TextBlockViewProps {
  block: TextBlock
}

function TextBlockViewInner({ block }: TextBlockViewProps): React.JSX.Element {
  const handleCopy = useCallback((code: string) => {
    navigator.clipboard.writeText(code)
  }, [])

  return (
    <div className="block block-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const codeString = String(children).replace(/\n$/, '')

            if (match) {
              return (
                <div className="block-text__code-wrapper">
                  <button className="block-text__copy-btn" onClick={() => handleCopy(codeString)}>
                    Copy
                  </button>
                  <SyntaxHighlighter style={vscDarkPlus} language={match[1]} PreTag="div">
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              )
            }

            // Check if this is a block-level code element (no language, but wrapped in pre)
            const isBlock = !className && codeString.includes('\n')
            if (isBlock) {
              return (
                <div className="block-text__code-wrapper">
                  <button className="block-text__copy-btn" onClick={() => handleCopy(codeString)}>
                    Copy
                  </button>
                  <SyntaxHighlighter style={vscDarkPlus} language="text" PreTag="div">
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              )
            }

            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          }
        }}
      >
        {block.content}
      </ReactMarkdown>
      {block.streaming && <span className="block-text__cursor" />}
    </div>
  )
}

const TextBlockView = memo(TextBlockViewInner, (prev, next) => {
  // Re-render only when content changes or streaming state changes
  return prev.block.content === next.block.content && prev.block.streaming === next.block.streaming
})

export default TextBlockView
