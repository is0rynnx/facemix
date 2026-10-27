import {build as buildWorker} from 'esbuild';
import { defineConfig } from 'vite';
import {writeFile} from 'node:fs/promises';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [{name:'shared-fitting-worker',async buildStart(){const result=await buildWorker({entryPoints:['src/engine/fitting.ts'],bundle:true,format:'iife',globalName:'FaceMixFitting',target:'es2022',write:false});await writeFile('public/workers/fitting.js',result.outputFiles[0].text);}},react()], base: './', worker: { format: 'es' }, server: { port: 5173, strictPort: true }, build: { chunkSizeWarningLimit: 1000 } });
