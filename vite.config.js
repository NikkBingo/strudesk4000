import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  optimizeDeps: {
    include: ['@strudel/core', '@strudel/web', '@strudel/webaudio', '@strudel/mini'],
    force: true,
    // Exclude from optimization to prevent duplicate bundling
    exclude: []
  },
  resolve: {
    dedupe: ['@strudel/core', '@strudel/mini'],
    // Force alias to ensure single instance
    alias: {
      '@strudel/core': '@strudel/core',
      '@strudel/mini': '@strudel/mini'
    }
  },
  build: {
    commonjsOptions: {
      // Include Strudel packages in commonjs transform to help with deduplication
      include: [/@strudel/]
    },
    rollupOptions: {
      output: {
        // Manually chunk Strudel packages to ensure single instances
        manualChunks(id) {
          // Put all Strudel packages in a single chunk
          if (id.includes('@strudel/core')) {
            return 'strudel-core';
          }
          if (id.includes('@strudel/web')) {
            return 'strudel-web';
          }
          if (id.includes('@strudel/webaudio')) {
            return 'strudel-webaudio';
          }
        }
      }
    }
  }
});

