import { memo } from 'react'
import type { StatusBlock } from '@shared/message-block'

interface StatusBlockViewProps {
  block: StatusBlock
}

function StatusBlockViewInner({ block }: StatusBlockViewProps): React.JSX.Element {
  return (
    <div className={`block block-status block-status--${block.variant}`}>
      <span className="block-status__label">[{block.variant}]</span> {block.toolName}:{' '}
      {block.inputSummary}
    </div>
  )
}

const StatusBlockView = memo(StatusBlockViewInner)

export default StatusBlockView
