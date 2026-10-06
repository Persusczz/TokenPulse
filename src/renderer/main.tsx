import '@fontsource-variable/source-serif-4'
import './styles.css'
import './styles-sky.css'
import './styles-cosmos.css'
import './styles-packs2.css'
import './styles-packs3.css'
import './styles-tasks.css'
import './styles-overview.css'
import './styles-quota.css'
import './styles-day.css'
import './styles-tarot.css'
import './styles-overview2.css'
import './styles-update.css'
import './styles-perf.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
