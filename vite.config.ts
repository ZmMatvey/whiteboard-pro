import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

function copyRootStaticDirs(): Plugin {
  let outDir = 'dist';
  return {
    name: 'copy-root-static-dirs',
    configResolved(config) {
      outDir = config.build.outDir || 'dist';
    },
    closeBundle() {
      const targetRoot = path.resolve(__dirname, outDir);
      for (const dir of ['css', 'js', 'assets']) {
        const src = path.resolve(__dirname, dir);
        if (fs.existsSync(src)) {
          fs.cpSync(src, path.join(targetRoot, dir), { recursive: true });
        }
      }
    },
  };
}

export default defineConfig(() => {
  return {
    publicDir: false as const,
    plugins: [react(), tailwindcss(), copyRootStaticDirs()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
