import path from "path";
import { fileURLToPath } from "url";
import fs from "node:fs";
import https from "node:https";
import dns from "node:dns";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function projectsApiPlugin(): import("vite").Plugin {
  const projectsDir = path.resolve(__dirname, "projects");
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }

  return {
    name: "frame60-projects-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlStr = req.url || "/";
        const url = new URL(urlStr, `http://${req.headers.host || "localhost"}`);
        const pathname = url.pathname;

        if (!pathname.startsWith("/api/")) {
          return next();
        }

        // 1. GET /api/active-project
        if (pathname === "/api/active-project" && req.method === "GET") {
          const activeFile = path.join(projectsDir, "active.json");
          try {
            if (fs.existsSync(activeFile)) {
              const data = fs.readFileSync(activeFile, "utf-8");
              res.setHeader("Content-Type", "application/json");
              res.end(data);
              return;
            }
          } catch {}
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ activeId: null }));
          return;
        }

        // 2. POST /api/active-project
        if (pathname === "/api/active-project" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              const activeFile = path.join(projectsDir, "active.json");
              fs.writeFileSync(activeFile, body || JSON.stringify({ activeId: null }), "utf-8");
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        // 3. Audio upload: POST /api/projects/:id/audio
        const audioMatch = pathname.match(/^\/api\/projects\/([^/]+)\/audio$/);
        if (audioMatch && req.method === "POST") {
          const id = decodeURIComponent(audioMatch[1]);
          const contentType = req.headers["content-type"] || "audio/mpeg";
          let ext = ".mp3";
          if (contentType.includes("wav")) ext = ".wav";
          else if (contentType.includes("m4a")) ext = ".m4a";
          else if (contentType.includes("ogg")) ext = ".ogg";

          const audioFile = path.join(projectsDir, `${id}_audio${ext}`);
          const fileStream = fs.createWriteStream(audioFile);
          req.pipe(fileStream);
          fileStream.on("finish", () => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, filename: path.basename(audioFile) }));
          });
          fileStream.on("error", (err) => {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          });
          return;
        }

        // 4. Audio serve: GET /api/projects/:id/audio
        if (audioMatch && req.method === "GET") {
          const id = decodeURIComponent(audioMatch[1]);
          const files = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : [];
          const found = files.find((f) => f.startsWith(`${id}_audio.`));
          if (!found) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "Audio not found" }));
            return;
          }
          const audioPath = path.join(projectsDir, found);
          const stat = fs.statSync(audioPath);
          const ext = path.extname(found).toLowerCase();
          const mime = ext === ".wav" ? "audio/wav" : ext === ".m4a" ? "audio/mp4" : ext === ".ogg" ? "audio/ogg" : "audio/mpeg";

          res.setHeader("Content-Type", mime);
          res.setHeader("Content-Length", stat.size);
          res.setHeader("Accept-Ranges", "bytes");
          fs.createReadStream(audioPath).pipe(res);
          return;
        }

        // 5. GET /api/projects
        if (pathname === "/api/projects" && req.method === "GET") {
          try {
            const files = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : [];
            const list: any[] = [];
            for (const f of files) {
              if (f.endsWith(".json") && f !== "active.json") {
                try {
                  const content = fs.readFileSync(path.join(projectsDir, f), "utf-8");
                  const json = JSON.parse(content);
                  list.push(json);
                } catch {}
              }
            }
            list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(list));
            return;
          } catch (err: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
            return;
          }
        }

        // 6. POST /api/projects
        if (pathname === "/api/projects" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              const project = JSON.parse(body);
              if (!project || !project.id) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Project ID is required" }));
                return;
              }
              const filePath = path.join(projectsDir, `${project.id}.json`);
              fs.writeFileSync(filePath, JSON.stringify(project, null, 2), "utf-8");
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, id: project.id }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        // 7. GET /api/projects/:id
        const itemMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
        if (itemMatch && req.method === "GET") {
          const id = decodeURIComponent(itemMatch[1]);
          const filePath = path.join(projectsDir, `${id}.json`);
          if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, "utf-8");
            res.setHeader("Content-Type", "application/json");
            res.end(data);
            return;
          }
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Project not found" }));
          return;
        }

        // 8. DELETE /api/projects/:id
        if (itemMatch && req.method === "DELETE") {
          const id = decodeURIComponent(itemMatch[1]);
          const filePath = path.join(projectsDir, `${id}.json`);
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch {}
          }
          const files = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : [];
          for (const f of files) {
            if (f.startsWith(`${id}_audio`)) {
              try { fs.unlinkSync(path.join(projectsDir, f)); } catch {}
            }
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        next();
      });
    },
  };
}

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
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["VITE_", "NEW_"]);

  return {
    envPrefix: ["VITE_", "NEW_"],
    define: {
      "process.env.NEW_API_KEY": JSON.stringify(env.NEW_API_KEY || env.VITE_NEW_API_KEY || ""),
      "process.env.NEW_API_MODEL": JSON.stringify(env.NEW_API_MODEL || env.VITE_NEW_API_MODEL || ""),
      "process.env.NEW_API_BASE_URL": JSON.stringify(env.NEW_API_BASE_URL || env.VITE_NEW_API_BASE_URL || "https://api.hcnsec.cn/v1"),
    },
    plugins: [react(), tailwindcss(), viteSingleFile(), projectsApiPlugin()],
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
        "/hcnsec-proxy": {
          target: "https://api.hcnsec.cn",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/hcnsec-proxy/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq, req) => {
              console.log(`[Vite Proxy -> HCNSEC] ${req.method} ${req.url} -> https://api.hcnsec.cn${proxyReq.path}`);
            });
            proxy.on("proxyRes", (proxyRes, req) => {
              console.log(`[Vite Proxy <- HCNSEC] ${proxyRes.statusCode} for ${req.url}`);
            });
            proxy.on("error", (err, _req, res) => {
              console.error("[Vite Proxy HCNSEC error]", err.message);
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
  };
});
