import { memo, useState } from 'react'
import type { ToolBlock } from '@shared/message-block'

interface ToolBlockViewProps {
  block: ToolBlock
}

function ToolBlockViewInner({ block }: ToolBlockViewProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const isBash = block.toolName.toLowerCase() === 'bash'
  const hasSummary = block.summary && block.summary.length > 0
  const hasInput = block.toolInput && Object.keys(block.toolInput).length > 0

  return (
    <div className="block-tool">
      <div className="block-tool__header" onClick={() => setExpanded(!expanded)}>
        <span className={`block-tool__chevron ${expanded ? 'block-tool__chevron--open' : ''}`}>
          ▶
        </span>

        {isBash ? (
          <>
            <span className="block-tool__prefix">$</span>
            <span className="block-tool__summary-inline">{block.inputSummary}</span>
          </>
        ) : (
          <>
            <span className="block-tool__name">{block.toolName}</span>
            <span className="block-tool__summary-inline">{block.inputSummary}</span>
          </>
        )}

        {block.active && <span className="block-tool__pulse" />}
        {block.active && block.elapsedSeconds > 0 && (
          <span className="block-tool__elapsed">{block.elapsedSeconds}s</span>
        )}
      </div>

      {expanded && (hasSummary || hasInput) && (
        <div className="block-tool__detail">
          {hasSummary && <div>{block.summary}</div>}
          {hasInput && (
            <pre className="block-tool__input-json">{JSON.stringify(block.toolInput, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  )
}

const ToolBlockView = memo(ToolBlockViewInner, (prev, next) => {
  return (
    prev.block.summary === next.block.summary &&
    prev.block.active === next.block.active &&
    prev.block.elapsedSeconds === next.block.elapsedSeconds
  )
})

export default ToolBlockView
