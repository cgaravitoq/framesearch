import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target: apiOrigin, changeOrigin: true },
      "/frames": { target: apiOrigin, changeOrigin: true },
    },
  },
});
