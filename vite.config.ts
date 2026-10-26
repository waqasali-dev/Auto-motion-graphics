import path from "path";
import { fileURLToPath } from "url";
import https from "node:https";
import dns from "node:dns";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Bulletproof HTTPS agent with connection pooling and DNS fallback
// to prevent EAI_AGAIN (DNS timeout) errors during concurrent pipeline requests.
const agentrouterAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 32,
  lookup: (hostname, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    const opts = typeof options === "object" ? options : {};
    if (hostname === "agentrouter.org") {
      if (opts && (opts as { all?: boolean }).all) {
        return (cb as Function)(null, [{ address: "8.214.160.125", family: 4 }]);
      }
      return (cb as Function)(null, "8.214.160.125", 4);
    }
    return (dns.lookup as Function)(hostname, options, callback);
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
      "/agentrouter-proxy": {
        target: "https://agentrouter.org",
        changeOrigin: true,
        agent: agentrouterAgent,
        rewrite: (p) => p.replace(/^\/agentrouter-proxy/, ""),
        headers: {
          "User-Agent": "claude-cli/1.0.108 (external, cli)",
          "x-app": "cli",
        },
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("User-Agent", "claude-cli/1.0.108 (external, cli)");
            proxyReq.setHeader("x-app", "cli");
          });
          proxy.on("error", (err, _req, res) => {
            console.error("[vite proxy error]", err.message);
            const serverRes = res as import("node:http").ServerResponse;
            if (serverRes && !serverRes.headersSent) {
              serverRes.writeHead(502, { "Content-Type": "application/json" });
              serverRes.end(JSON.stringify({ error: { message: `Proxy error: ${err.message}` } }));
            }
          });
        },
      },
    },
  },
});

