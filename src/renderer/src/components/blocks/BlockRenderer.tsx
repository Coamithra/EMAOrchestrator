import { memo } from 'react'
import type { MessageBlock } from '@shared/message-block'
import TextBlockView from './TextBlockView'
import BannerBlockView from './BannerBlockView'
import ToolBlockView from './ToolBlockView'
import ResultBlockView from './ResultBlockView'
import StatusBlockView from './StatusBlockView'
import ErrorBlockView from './ErrorBlockView'
import OrchestratorBlockView from './OrchestratorBlockView'

interface BlockRendererProps {
  block: MessageBlock
  showOrchestratorBlocks?: boolean
}

function BlockRendererInner({ block, showOrchestratorBlocks }: BlockRendererProps): React.JSX.Element | null {
  switch (block.type) {
    case 'text':
      return <TextBlockView block={block} />
    case 'banner':
      return <BannerBlockView block={block} />
    case 'tool':
      return <ToolBlockView block={block} />
    case 'result':
      return <ResultBlockView block={block} />
    case 'status':
      return <StatusBlockView block={block} />
    case 'error':
      return <ErrorBlockView block={block} />
    case 'orchestrator':
      return showOrchestratorBlocks ? <OrchestratorBlockView block={block} /> : null
  }
}

const BlockRenderer = memo(BlockRendererInner, (prev, next) => {
  return prev.block === next.block && prev.showOrchestratorBlocks === next.showOrchestratorBlocks
})

export default BlockRenderer
