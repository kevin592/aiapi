import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base 使用相对路径，兼容 GitHub Pages 子路径（/<repo>/）和自定义域名根路径
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  server: { port: 5173 },
})
