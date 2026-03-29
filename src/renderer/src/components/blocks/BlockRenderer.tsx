import { memo } from 'react'
import type { MessageBlock } from '@shared/message-block'
import TextBlockView from './TextBlockView'
import BannerBlockView from './BannerBlockView'
import ToolBlockView from './ToolBlockView'
import ResultBlockView from './ResultBlockView'
import StatusBlockView from './StatusBlockView'
import ErrorBlockView from './ErrorBlockView'

interface BlockRendererProps {
  block: MessageBlock
}

function BlockRendererInner({ block }: BlockRendererProps): React.JSX.Element {
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
  }
}

const BlockRenderer = memo(BlockRendererInner, (prev, next) => {
  return prev.block === next.block
})

export default BlockRenderer
