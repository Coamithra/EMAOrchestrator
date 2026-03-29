import { memo } from 'react'
import type { BannerBlock } from '@shared/message-block'

interface BannerBlockViewProps {
  block: BannerBlock
}

function BannerBlockViewInner({ block }: BannerBlockViewProps): React.JSX.Element {
  return (
    <div className="block block-banner">
      <span className="block-banner__label">
        Phase {block.phaseIndex + 1}/{block.totalPhases}: {block.phaseName} —
      </span>
      Step {block.stepIndex + 1}/{block.totalSteps}: {block.stepTitle}
    </div>
  )
}

const BannerBlockView = memo(BannerBlockViewInner)

export default BannerBlockView
