import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { bootstrap } from '@/lib/bootstrap'
import './styles/globals.css'

const root = createRoot(document.getElementById('root') as HTMLElement)

bootstrap({ persistView: true })
  .then(() =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )
  .catch((err: unknown) => {
    console.error(err)
    root.render(<pre className="p-6 text-sm text-destructive">Failed to start: {String(err)}</pre>)
  })
