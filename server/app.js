/**
 * HTTP-сервер «Интернет-приёмной Школа 800».
 *
 * Без внешних зависимостей: статика из `public/`, общий модуль валидации из
 * `shared/`, приём заявок на `POST /api/applications`.
 *
 * Запуск: `npm start` (порт 3000, переопределяется через PORT).
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { validateApplication, FILES_LIMIT } from '../shared/validation.mjs';
import { createStore } from './store.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
};

const MAX_BODY_BYTES = 9 * 1024 * 1024;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res, status, title, paragraphs = []) {
  const body = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>
<h1>${title}</h1>
${paragraphs.map((text) => `<p>${text}</p>`).join('\n')}
<p><a href="/">Вернуться к форме</a></p>
</body>
</html>`;
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

/** Отдаёт файл из разрешённого каталога, не выпуская за его пределы. */
async function serveFile(res, roots, urlPath, { method = 'GET' } = {}) {
  const candidates = [];
  for (const { prefix, directory } of roots) {
    if (!urlPath.startsWith(prefix)) continue;
    let relative;
    try {
      relative = decodeURIComponent(urlPath.slice(prefix.length)) || 'index.html';
    } catch {
      continue;
    }
    candidates.push({ filePath: path.resolve(directory, `.${path.posix.normalize(`/${relative}`)}`), directory });
  }
  for (const { filePath, directory } of candidates) {
    if (!filePath.startsWith(directory + path.sep) && filePath !== directory) continue;
    try {
      const info = await stat(filePath);
      if (!info.isFile()) continue;
      const ext = path.extname(filePath).toLowerCase();
      const body = await readFile(filePath);
      const headers = {
        ...SECURITY_HEADERS,
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
        'Last-Modified': info.mtime.toUTCString(),
      };
      res.writeHead(200, headers);
      res.end(method === 'HEAD' ? undefined : body);
      return true;
    } catch {
      // пробуем следующий корень
    }
  }
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('payload-too-large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Разворачивает data-URL от клиента в буфер, проверяя размер вложения. */
function decodeFiles(rawFiles) {
  const files = [];
  const errors = [];
  if (!Array.isArray(rawFiles)) return { files, errors };
  for (const item of rawFiles.slice(0, FILES_LIMIT.maxCount + 1)) {
    const dataUrl = typeof item?.dataUrl === 'string' ? item.dataUrl : '';
    const match = /^data:([^;]*);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) {
      errors.push({ name: item?.name, reason: 'invalid-data' });
      continue;
    }
    const buffer = Buffer.from(match[2], 'base64');
    files.push({
      name: String(item?.name || 'file'),
      type: match[1] || 'application/octet-stream',
      size: buffer.length,
      buffer,
    });
  }
  return { files, errors };
}

function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const timestamps = (hits.get(key) || []).filter((time) => now - time < windowMs);
      if (timestamps.length >= max) {
        hits.set(key, timestamps);
        return false;
      }
      timestamps.push(now);
      hits.set(key, timestamps);
      if (hits.size > 5000) hits.clear();
      return true;
    },
    reset() {
      hits.clear();
    },
  };
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function wantsHtml(req) {
  return String(req.headers.accept || '').includes('text/html');
}

/**
 * Создаёт HTTP-сервер (без вызова listen — удобно для тестов).
 */
export async function createApp({
  dataDir = path.join(ROOT, 'data'),
  publicDir = path.join(ROOT, 'public'),
  rateLimit = { windowMs: 10 * 60 * 1000, max: 5 },
  now = () => new Date(),
} = {}) {
  const store = createStore({ directory: dataDir });
  const limiter = createRateLimiter(rateLimit);
  const staticRoots = [
    { prefix: '/', directory: path.resolve(publicDir) },
    { prefix: '/shared/', directory: path.resolve(ROOT, 'shared') },
  ];

  async function handleApplication(req, res) {
    if (!limiter.check(clientIp(req))) {
      sendJson(res, 429, {
        ok: false,
        message: 'Слишком много обращений. Попробуйте отправить заявку позже или позвоните в приёмную корпуса.',
      });
      return;
    }

    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      const status = error.status || 400;
      sendJson(res, status, {
        ok: false,
        message: status === 413
          ? 'Слишком большой объём данных. Проверьте размер вложений (не более 5 МБ).'
          : 'Не удалось прочитать данные формы.',
      });
      return;
    }

    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    let payload = {};
    let isFormPost = false;

    try {
      if (contentType.includes('application/json')) {
        payload = JSON.parse(body.toString('utf8') || '{}');
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        isFormPost = true;
        const params = new URLSearchParams(body.toString('utf8'));
        payload = Object.fromEntries(params.entries());
      } else {
        sendJson(res, 415, { ok: false, message: 'Ожидается JSON или данные HTML-формы.' });
        return;
      }
    } catch {
      sendJson(res, 400, { ok: false, message: 'Некорректный формат данных.' });
      return;
    }

    // Honeypot: скрытое поле заполняют только боты.
    if (typeof payload.website === 'string' && payload.website.trim() !== '') {
      sendJson(res, 201, { ok: true, id: 'SH800-ACCEPTED', createdAt: new Date().toISOString() });
      return;
    }

    const { files } = decodeFiles(payload.files);
    const result = validateApplication(
      { ...payload, files: files.map(({ name, size }) => ({ name, size })) },
      { now: now() },
    );

    if (!result.valid) {
      if (isFormPost && wantsHtml(req)) {
        sendHtml(
          res,
          422,
          'Проверьте заполнение формы',
          Object.values(result.errors).map(escapeHtml),
        );
        return;
      }
      sendJson(res, 422, {
        ok: false,
        message: 'Проверьте заполнение формы',
        errors: result.errors,
      });
      return;
    }

    try {
      const record = await store.create({
        data: result.data,
        files,
        meta: {
          ip: clientIp(req),
          userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
        },
      });

      if (isFormPost && wantsHtml(req)) {
        res.writeHead(303, { ...SECURITY_HEADERS, Location: `/?sent=${encodeURIComponent(record.id)}` });
        res.end();
        return;
      }
      sendJson(res, 201, { ok: true, id: record.id, createdAt: record.createdAt });
    } catch (error) {
      console.error('[applications] не удалось сохранить заявку:', error);
      sendJson(res, 500, {
        ok: false,
        message: 'Не удалось сохранить обращение. Попробуйте ещё раз или позвоните в приёмную.',
      });
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    try {
      if (pathname === '/api/health') {
        sendJson(res, 200, { ok: true, uptime: process.uptime() });
        return;
      }
      if (pathname === '/api/applications') {
        if (req.method === 'POST') {
          await handleApplication(req, res);
          return;
        }
        res.writeHead(405, { ...SECURITY_HEADERS, Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method Not Allowed');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendHtml(res, 405, 'Метод не поддерживается');
        return;
      }
      if (await serveFile(res, staticRoots, pathname, { method: req.method })) return;
      sendHtml(res, 404, 'Страница не найдена');
    } catch (error) {
      console.error('[server] непредвиденная ошибка:', error);
      if (!res.headersSent) sendJson(res, 500, { ok: false, message: 'Внутренняя ошибка сервера' });
      else res.end();
    }
  });

  return { server, store, limiter, staticRoots };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const { server } = await createApp();
  server.listen(port, host, () => {
    console.log(`Школа 800 — интернет-приёмная: http://localhost:${port}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
