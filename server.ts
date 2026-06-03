import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import http from "http";
import https from "https";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  // hosts で托管ドメインを 127.0.0.1 に向ける運用のため 0.0.0.0 で待ち受ける。
  const HOST = process.env.HOST || "0.0.0.0";

  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ============================================================
  // ローカル HTTPS（CloudBase の「Web 安全域名」対策）
  //  - CloudBase は localhost を安全域名に登録できないため、ホワイトリスト済みの
  //    托管ドメイン（例: <env>-<uin>.tcloudbaseapp.com）を hosts で 127.0.0.1 に
  //    向け、そのドメイン + HTTPS でローカル起動する。ブラウザの Origin が
  //    ホワイトリストのドメインと一致し、DB へのリクエストが 403 にならない。
  //  - SSL_KEY_FILE / SSL_CERT_FILE が指定され実在すれば HTTPS、無ければ従来通り HTTP。
  // ============================================================
  const keyPath = process.env.SSL_KEY_FILE;
  const certPath = process.env.SSL_CERT_FILE;
  const useHttps =
    !!keyPath && !!certPath && fs.existsSync(keyPath) && fs.existsSync(certPath);

  if (useHttps) {
    const server = https.createServer(
      { key: fs.readFileSync(keyPath!), cert: fs.readFileSync(certPath!) },
      app,
    );
    server.listen(PORT, HOST, () => {
      console.log(`HTTPS server running on https://localhost:${PORT}`);
      console.log(
        '安全域名対策: hosts で托管ドメインを 127.0.0.1 に向け、そのドメインでアクセスしてください。',
      );
    });
  } else {
    http.createServer(app).listen(PORT, HOST, () => {
      console.log(`HTTP server running on http://localhost:${PORT}`);
      console.log(
        '注意: localhost では CloudBase DB が 403 になります。SSL_KEY_FILE / SSL_CERT_FILE を設定し HTTPS で起動してください。',
      );
    });
  }
}

startServer();
