import { memo } from 'react'
import type { ErrorBlock } from '@shared/message-block'

interface ErrorBlockViewProps {
  block: ErrorBlock
}

function ErrorBlockViewInner({ block }: ErrorBlockViewProps): React.JSX.Element {
  return <div className="block block-error">{block.message}</div>
}

const ErrorBlockView = memo(ErrorBlockViewInner)

export default ErrorBlockView
