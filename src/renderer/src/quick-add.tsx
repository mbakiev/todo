import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QuickAddWindow } from '@/features/quick-add/QuickAddWindow'
import { bootstrap } from '@/lib/bootstrap'
import './styles/globals.css'

const root = createRoot(document.getElementById('root') as HTMLElement)

bootstrap()
  .then(() =>
    root.render(
      <StrictMode>
        <QuickAddWindow />
      </StrictMode>,
    ),
  )
  .catch((err: unknown) => {
    console.error(err)
    root.render(<pre className="p-3 text-sm text-destructive">Failed to start: {String(err)}</pre>)
  })
