import '@fontsource-variable/google-sans'
import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '@fontsource-variable/space-grotesk'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import './styles/themes.css'
import './styles/components.css'
import './styles/material.css'
import './styles/layout.css'
import './styles/ios.css'
import './styles/profile.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
