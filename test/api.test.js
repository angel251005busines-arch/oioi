import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createApp } from '../server/app.js';

const appeal = {
  type: 'appeal',
  fullName: 'Иванова Мария Петровна',
  phone: '8 (915) 941-85-42',
  email: 'IVANOVA@example.ru',
  corpus: 'sormovo',
  subject: 'Организация питания',
  message: 'Прошу уточнить график работы столовой в корпусе «Сормово» на второй четверти.',
  consent: true,
};

async function startServer(options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'sh800-'));
  const { server } = await createApp({ dataDir, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    baseUrl,
    dataDir,
    journalPath: path.join(dataDir, 'applications.jsonl'),
    uploadsDir: path.join(dataDir, 'uploads'),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

const app = await startServer({ rateLimit: { windowMs: 60_000, max: 100 } });
test.after(async () => app.close());

const postJson = (url, body, headers = {}) => fetch(`${url}/api/applications`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
  body: JSON.stringify(body),
});

const readJournal = async (journalPath) => {
  const raw = await readFile(journalPath, 'utf8').catch(() => '');
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
};

test('health-check отвечает 200', async () => {
  const response = await fetch(`${app.baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
});

test('главная страница и статические ресурсы отдаются', async () => {
  const page = await fetch(`${app.baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text();
  assert.match(html, /Интернет-приёмная/);
  assert.match(html, /id="appeal-form"/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);

  const css = await fetch(`${app.baseUrl}/css/styles.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);

  const shared = await fetch(`${app.baseUrl}/shared/validation.mjs`);
  assert.equal(shared.status, 200);
  assert.match(shared.headers.get('content-type'), /javascript/);
});

test('корректное обращение сохраняется и получает номер', async () => {
  const response = await postJson(app.baseUrl, appeal);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.match(body.id, /^SH800-\d{4}-\d{5}$/);

  const records = await readJournal(app.journalPath);
  const saved = records.find((record) => record.id === body.id);
  assert.ok(saved, 'запись не найдена в журнале');
  assert.equal(saved.status, 'new');
  assert.equal(saved.applicant.phone, '+79159418542');
  assert.equal(saved.applicant.email, 'ivanova@example.ru');
  assert.equal(saved.type, 'appeal');
  assert.equal(saved.files.length, 0);
});

test('некорректные данные возвращают 422 и ошибки по полям', async () => {
  const response = await postJson(app.baseUrl, { ...appeal, phone: '123', consent: false });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.ok(body.errors.phone);
  assert.ok(body.errors.consent);
});

test('вложение сохраняется в uploads и попадает в запись', async () => {
  const content = Buffer.from('справка об обучении');
  const payload = {
    ...appeal,
    subject: 'Справка',
    files: [{
      name: 'справка.pdf',
      type: 'application/pdf',
      dataUrl: `data:application/pdf;base64,${content.toString('base64')}`,
    }],
  };
  const response = await postJson(app.baseUrl, payload);
  assert.equal(response.status, 201);
  const { id } = await response.json();

  const records = await readJournal(app.journalPath);
  const saved = records.find((record) => record.id === id);
  assert.equal(saved.files.length, 1);
  assert.equal(saved.files[0].size, content.length);
  assert.match(saved.files[0].storedAs, /^SH800-\d{4}-\d{5}-[0-9a-f]{8}-/);

  const stored = await readFile(path.join(app.uploadsDir, saved.files[0].storedAs));
  assert.equal(stored.toString(), 'справка об обучении');

  const listed = await readdir(app.uploadsDir);
  assert.ok(listed.includes(saved.files[0].storedAs));
});

test('запрещённый тип файла отклоняется', async () => {
  const payload = {
    ...appeal,
    files: [{ name: 'script.exe', type: 'application/octet-stream', dataUrl: 'data:application/octet-stream;base64,QQ==' }],
  };
  const response = await postJson(app.baseUrl, payload);
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.match(body.errors.files, /допустимы только/);
});

test('honeypot блокирует бота без записи заявки', async () => {
  const before = (await readJournal(app.journalPath)).length;
  const response = await postJson(app.baseUrl, { ...appeal, website: 'http://spam.example' });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.id, 'SH800-ACCEPTED');
  const after = (await readJournal(app.journalPath)).length;
  assert.equal(after, before, 'бот попал в журнал');
});

test('отправка обычной HTML-формы (без JS) даёт редирект на страницу успеха', async () => {
  const form = new URLSearchParams({
    type: 'appeal',
    fullName: 'Сидоров Иван Петрович',
    phone: '89159414450',
    email: 'sidorov@example.ru',
    corpus: 'verhnie-pechery',
    subject: 'Вопрос по расписанию',
    message: 'Подскажите, пожалуйста, время начала занятий второй смены в корпусе.',
    consent: 'on',
  });

  const response = await fetch(`${app.baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
    body: form.toString(),
    redirect: 'manual',
  });
  assert.equal(response.status, 303);
  assert.match(response.headers.get('location'), /^\/\?sent=SH800-\d{4}-\d{5}$/);
});

test('ошибки в обычной HTML-форме отдаются страницей с пояснением', async () => {
  const response = await fetch(`${app.baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
    body: new URLSearchParams({ type: 'appeal' }).toString(),
  });
  assert.equal(response.status, 422);
  const html = await response.text();
  assert.match(html, /Проверьте заполнение формы/);
  assert.match(html, /Вернуться к форме/);
});

test('неизвестный адрес отдаёт 404, обход каталогов заблокирован', async () => {
  const missing = await fetch(`${app.baseUrl}/net-takoy-stranicy`);
  assert.equal(missing.status, 404);

  const traversal = await fetch(`${app.baseUrl}/../package.json`);
  assert.notEqual(traversal.status, 200);

  const encoded = await fetch(`${app.baseUrl}/%2e%2e/%2e%2e/package.json`);
  assert.notEqual(encoded.status, 200);
});

test('неподдерживаемый Content-Type отклоняется', async () => {
  const response = await fetch(`${app.baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'hello',
  });
  assert.equal(response.status, 415);
});

test('GET на /api/applications возвращает 405', async () => {
  const response = await fetch(`${app.baseUrl}/api/applications`);
  assert.equal(response.status, 405);
});

test('rate limit ограничивает число отправок с одного IP', async () => {
  const limited = await startServer({ rateLimit: { windowMs: 60_000, max: 2 } });
  try {
    const first = await postJson(limited.baseUrl, appeal);
    assert.equal(first.status, 201);
    const second = await postJson(limited.baseUrl, appeal);
    assert.equal(second.status, 201);
    const third = await postJson(limited.baseUrl, appeal);
    assert.equal(third.status, 429);
    const body = await third.json();
    assert.match(body.message, /Слишком много обращений/);
  } finally {
    await limited.close();
  }
});
