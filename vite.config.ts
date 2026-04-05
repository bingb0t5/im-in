import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const localLaloPackagePath = path.resolve(__dirname, '../lalo/packages/lalo-verify');
  const useLocalLaloSource = fs.existsSync(localLaloPackagePath);
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY),
    },
    resolve: {
      alias: [
        { find: '@', replacement: path.resolve(__dirname, '.') },
        ...(useLocalLaloSource
          ? [
              {
                find: 'lalo-verify/styles.css',
                replacement: path.resolve(localLaloPackagePath, 'src/styles.css'),
              },
              {
                find: 'lalo-verify/react',
                replacement: path.resolve(localLaloPackagePath, 'src/react/index.ts'),
              },
              {
                find: 'lalo-verify',
                replacement: path.resolve(localLaloPackagePath, 'src/index.ts'),
              },
            ]
          : []),
      ],
    },
    server: {
      // Optional: disable HMR in constrained environments.
      hmr: process.env.DISABLE_HMR !== 'true',
      fs: {
        allow: [
          path.resolve(__dirname, '.'),
          ...(useLocalLaloSource ? [localLaloPackagePath] : []),
        ],
      },
    },
  };
});
