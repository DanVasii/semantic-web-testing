import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const developmentCspPlugin: Plugin = {
  name: "development-csp",
  apply: "serve",
  transformIndexHtml(html) {
    return html
      .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
      .replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5173");
  },
};

export default defineConfig({
  plugins: [developmentCspPlugin, tailwindcss()],
});
