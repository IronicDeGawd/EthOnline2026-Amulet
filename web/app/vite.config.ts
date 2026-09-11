import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* Vercel serves the site at the root; GitHub Pages serves it under the repo name.
   Build for Pages with BASE=/EthOnline2026-Amulet/ ; the default is the root. */
export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [react()],
})
