import { memo } from 'react'
import type { ResultBlock } from '@shared/message-block'

interface ResultBlockViewProps {
  block: ResultBlock
}

function ResultBlockViewInner({ block }: ResultBlockViewProps): React.JSX.Element {
  const isError = block.subtype !== 'success'
  const secs = Math.round(block.durationMs / 1000)
  const mins = Math.floor(secs / 60)
  const time = mins > 0 ? `${mins}m${secs % 60}s` : `${secs}s`
  const cost = block.costUsd < 0.01 ? '<$0.01' : `$${block.costUsd.toFixed(2)}`

  return (
    <div className={`block block-result ${isError ? 'block-result--error' : ''}`}>
      <span className="block-result__item">{cost}</span>
      <span className="block-result__separator">·</span>
      <span className="block-result__item">{block.numTurns} turns</span>
      <span className="block-result__separator">·</span>
      <span className="block-result__item">{time}</span>
      {isError && (
        <>
          <span className="block-result__separator">·</span>
          <span className="block-result__item">{block.subtype.replace('error_', '')}</span>
        </>
      )}
    </div>
  )
}

const ResultBlockView = memo(ResultBlockViewInner)

export default ResultBlockView
