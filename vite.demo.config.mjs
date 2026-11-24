// Builds a sign-in-free demo of the student view into dist/demo (served at /demo/).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: '/demo/',
  publicDir: false,
  resolve: { alias: { '@supabase/supabase-js': fileURLToPath(new URL('./demo/mock-supabase.js', import.meta.url)) } },
  define: { 'import.meta.env.VITE_SUPABASE_URL': '"demo"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"demo"' },
  build: { outDir: 'dist/demo', emptyOutDir: true },
});
