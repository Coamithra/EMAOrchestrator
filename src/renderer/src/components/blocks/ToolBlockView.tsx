import { memo, useState } from 'react'
import type { ToolBlock } from '@shared/message-block'

interface ToolBlockViewProps {
  block: ToolBlock
}

/** Max characters to show in the expanded tool result before truncating. */
const MAX_RESULT_LENGTH = 5000

function ToolBlockViewInner({ block }: ToolBlockViewProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const isBash = block.toolName.toLowerCase() === 'bash'

  // Prefer actual result over condensed summary
  const detail = block.result ?? block.summary
  const hasDetail = detail != null && detail.length > 0
  const truncated =
    hasDetail && detail.length > MAX_RESULT_LENGTH
      ? detail.slice(0, MAX_RESULT_LENGTH) + '\n… (truncated)'
      : detail

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

      {expanded && (
        <div className="block-tool__detail">
          {hasDetail ? truncated : <span className="block-tool__no-output">No output</span>}
        </div>
      )}
    </div>
  )
}

const ToolBlockView = memo(ToolBlockViewInner, (prev, next) => {
  return (
    prev.block.summary === next.block.summary &&
    prev.block.result === next.block.result &&
    prev.block.active === next.block.active &&
    prev.block.elapsedSeconds === next.block.elapsedSeconds
  )
})

export default ToolBlockView
