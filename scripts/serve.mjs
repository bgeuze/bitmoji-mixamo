// A tiny static server for the checks: maps URL prefixes to folders, never outside them.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary", ".fbx": "application/octet-stream", ".json": "application/json", ".css": "text/css" };

export function serve(routes, port = 0) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = decodeURIComponent(req.url.split("?")[0]);
      for (const [prefix, target] of Object.entries(routes)) {
        if (!url.startsWith(prefix)) continue;
        if (typeof target === "function") { const body = target(url); res.writeHead(200, { "content-type": TYPES[extname(url)] ?? "text/html" }); res.end(body); return; }
        const rest = normalize(url.slice(prefix.length)).replace(/^(\.\.[/\\])+/, "");
        const file = statSync(target).isDirectory() ? join(target, rest) : target;
        if (existsSync(file) && statSync(file).isFile()) { res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }); res.end(readFileSync(file)); return; }
      }
      res.writeHead(404); res.end("not found");
    });
    server.listen(port, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

export async function chromium() {
  const { createRequire } = await import("node:module");
  const req = createRequire(new URL("../../factory/package.json", import.meta.url));
  const pw = await import(req.resolve("playwright"));
  return (pw.chromium ?? pw.default.chromium).launch({ args: ["--mute-audio", "--use-gl=angle", "--use-angle=swiftshader"] });
}
