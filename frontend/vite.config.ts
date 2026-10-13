import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    host: true, // accessible from the host (Docker container)
    watch: { usePolling: true }, // reliable hot reload on mounted volume
  },
});
