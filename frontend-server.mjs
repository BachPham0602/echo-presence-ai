import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createReadStream, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const clientRoot = resolve(process.env.CLIENT_ROOT || join(__dirname, "client"));
const serverEntryPath = process.env.SERVER_ENTRY || join(__dirname, "server", "server.js");
const backendUrl = (process.env.BACKEND_URL || "http://127.0.0.1:8765").replace(/\/$/, "");
const port = Number(process.env.PORT || 80);

const serverEntry = await import(pathToFileURL(serverEntryPath).href).then((module) => module.default ?? module);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

function sendNodeResponse(res, status, headers, body) {
  res.writeHead(status, headers);
  if (body) {
    body.pipe(res);
  } else {
    res.end();
  }
}

function requestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  return Readable.toWeb(req);
}

function requestHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value != null) {
      headers.set(key, value);
    }
  }
  return headers;
}

function pipeReadableToResponse(readable, res, onError) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    readable.on("error", (error) => {
      onError(error);
      finish();
    });
    res.on("finish", finish);
    res.on("close", finish);
    readable.pipe(res);
  });
}

async function writeWebResponse(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  res.writeHead(response.status, headers);
  if (res.req.method === "HEAD" || !response.body) {
    res.end();
    return;
  }

  const body = Readable.fromWeb(response.body);
  await pipeReadableToResponse(body, res, (error) => {
    console.error("Response stream error:", error);
    if (!res.writableEnded) {
      res.end();
    }
  });
}

function proxyHeaders(req, targetUrl) {
  return {
    ...req.headers,
    host: targetUrl.host,
    "x-forwarded-host": req.headers.host || targetUrl.host,
    "x-forwarded-proto": req.headers["x-forwarded-proto"] || "http",
  };
}

async function proxyToBackend(req, res) {
  const targetUrl = new URL(req.url || "/", backendUrl);
  const upstreamRequest = targetUrl.protocol === "https:" ? httpsRequest : httpRequest;

  await new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const upstream = upstreamRequest(
      targetUrl,
      {
        method: req.method,
        headers: proxyHeaders(req, targetUrl),
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);

        upstreamRes.on("error", (error) => {
          console.error("Backend response stream error:", error);
          if (!res.writableEnded) {
            res.end("Bad Gateway");
          }
          finish();
        });

        res.on("close", () => {
          if (!upstreamRes.destroyed) {
            upstreamRes.destroy();
          }
          finish();
        });

        res.on("finish", finish);
        upstreamRes.on("end", finish);
        upstreamRes.pipe(res);
      },
    );

    upstream.setTimeout(0);

    upstream.on("error", (error) => {
      console.error("Backend proxy request error:", error);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      }
      if (!res.writableEnded) {
        res.end("Bad Gateway");
      }
      finish();
    });

    req.on("aborted", () => {
      if (!upstream.destroyed) {
        upstream.destroy();
      }
      finish();
    });

    req.on("error", (error) => {
      console.error("Client request stream error:", error);
      if (!upstream.destroyed) {
        upstream.destroy(error);
      }
      finish();
    });

    if (req.method === "GET" || req.method === "HEAD") {
      upstream.end();
      return;
    }

    req.pipe(upstream);
  });
}

async function serveStatic(req, res, pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const filePath = resolve(clientRoot, decodedPath.replace(/^\/+/, ""));
  if (!filePath.startsWith(clientRoot + "/") && filePath !== clientRoot) return false;

  let fileStat;
  try {
    fileStat = statSync(filePath);
  } catch {
    return false;
  }
  if (!fileStat.isFile()) return false;

  const headers = {
    "content-length": String(fileStat.size),
    "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
  };
  if (filePath.includes("/assets/")) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  }
  sendNodeResponse(res, 200, headers, req.method === "HEAD" ? undefined : createReadStream(filePath));
  return true;
}

async function handleSsr(req, res) {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host || `localhost:${port}`;
  const request = new Request(`${protocol}://${host}${req.url}`, {
    method: req.method,
    headers: requestHeaders(req),
    body: requestBody(req),
    duplex: "half",
  });
  const response = await serverEntry.fetch(request, {}, {});
  await writeWebResponse(res, response);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/outputs/")) {
      await proxyToBackend(req, res);
      return;
    }
    if (await serveStatic(req, res, url.pathname)) return;
    await handleSsr(req, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end("Internal Server Error");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Lumi frontend listening on :${port}`);
  console.log(`Proxying API to ${backendUrl}`);
});
