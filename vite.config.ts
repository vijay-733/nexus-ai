import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR permanently disabled.
      // The app is always served through a Cloudflare tunnel.  Vite's HMR client
      // tries wss://<host>:3000 which the tunnel does not expose; the WebSocket
      // failure causes Vite to force a full page reload, destroying execution state
      // and wiping the output.  Full page reloads are not needed — Zustand persists
      // completed sessions in localStorage so the output survives any reload.
      hmr: false,
      host: true,
      port: 3000,
      allowedHosts: true,
      proxy: {
        // All backend route prefixes forwarded to Express server.
        // proxyTimeout/timeout extended to 120s for long-running agent tasks.
        '/api':            { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 120000, timeout: 120000 },
        '/agent':          { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 120000, timeout: 120000 },
        '/auth':           { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 30000,  timeout: 30000  },
        '/tasks':          { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 120000, timeout: 120000 },
        '/usage':          { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 30000,  timeout: 30000  },
        '/observability':  { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 30000,  timeout: 30000  },
        '/governance':     { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 30000,  timeout: 30000  },
        '/memory':         { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 30000,  timeout: 30000  },
        '/health':         { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 10000,  timeout: 10000  },
        '/recovery':       { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 60000,  timeout: 60000  },
        '/workflow':       { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 120000, timeout: 120000 },
        '/billing':        { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 30000,  timeout: 30000  },
        '/queue':          { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 30000,  timeout: 30000  },
        '/ping':           { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 5000,   timeout: 5000   },
        '/metrics':        { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 10000,  timeout: 10000  },
        // SSE streaming — must use a long timeout so the proxy doesn't cut the
        // connection during a multi-step agent run (up to 120s server-side).
        '/stream':         { target: 'http://localhost:3002', changeOrigin: true, proxyTimeout: 135000, timeout: 135000 },
      },
    },
  };
});
