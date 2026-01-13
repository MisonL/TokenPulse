import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:9009", // Proxy API calls to backend
        changeOrigin: true,
        // rewrite removed to preserve /api prefix
      },
    },
  },
});
