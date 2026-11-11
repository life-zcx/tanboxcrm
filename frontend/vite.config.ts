import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins:[react()],
  server:{port:3050,strictPort:true,host:'127.0.0.1',proxy:{
    '/api':{target:'http://127.0.0.1:5055',changeOrigin:true},
    '/uploads':{target:'http://127.0.0.1:5055',changeOrigin:true},
  }},
  preview:{host:'127.0.0.1',strictPort:true,port:3050},
});
