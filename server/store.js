/**
 * Хранилище заявок «Интернет-приёмной Школа 800».
 *
 * Заявки складываются в append-only JSONL-файл, вложения — в каталог
 * `uploads/`. Запись сериализуется через очередь промисов, поэтому
 * параллельные запросы не перемешивают строки и не ломают нумерацию.
 */
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const SEQUENCE_WIDTH = 5;
const SAFE_NAME_RE = /[^a-zA-Z0-9._-]+/g;

function sanitizeFileName(name, fallbackExtension = 'bin') {
  const base = path.basename(String(name || 'file')).replace(SAFE_NAME_RE, '_').slice(-80);
  if (!base || base === '.' || base === '..') return `file.${fallbackExtension}`;
  return base;
}

export function createStore({ directory = 'data' } = {}) {
  const root = path.resolve(directory);
  const journalPath = path.join(root, 'applications.jsonl');
  const uploadsDir = path.join(root, 'uploads');
  const counterPath = path.join(root, 'sequence.json');

  let counter = 0;
  let ready = false;
  let queue = Promise.resolve();

  async function ensureReady() {
    if (ready) return;
    await mkdir(uploadsDir, { recursive: true });
    try {
      const raw = await readFile(journalPath, 'utf8');
      counter = raw.split('\n').filter((line) => line.trim()).length;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeFile(journalPath, '', { flag: 'a' });
    }
    ready = true;
  }

  /** Публичный номер заявки: SH800-2026-00001. */
  function formatId(sequence, year) {
    return `SH800-${year}-${String(sequence).padStart(SEQUENCE_WIDTH, '0')}`;
  }

  async function persistFiles(files, id) {
    const saved = [];
    for (const file of files) {
      const storedAs = `${id}-${randomUUID().slice(0, 8)}-${sanitizeFileName(file.name)}`;
      await writeFile(path.join(uploadsDir, storedAs), file.buffer);
      saved.push({
        name: sanitizeFileName(file.name),
        size: file.buffer.length,
        type: file.type || 'application/octet-stream',
        storedAs,
      });
    }
    return saved;
  }

  /**
   * Сохраняет заявку.
   * @param {{ data: object, files?: Array<{name:string,type:string,buffer:Buffer}>, meta?: object }} input
   */
  function create({ data, files = [], meta = {} }) {
    const task = queue.then(async () => {
      await ensureReady();
      counter += 1;
      const year = new Date().getFullYear();
      const id = formatId(counter, year);
      const createdAt = new Date().toISOString();
      const savedFiles = await persistFiles(files, id);
      const record = {
        id,
        createdAt,
        status: 'new',
        type: data.type,
        applicant: {
          fullName: data.fullName,
          phone: data.phone,
          email: data.email,
          corpus: data.corpus,
        },
        payload: data,
        files: savedFiles,
        meta,
      };
      await appendFile(journalPath, `${JSON.stringify(record)}\n`, 'utf8');
      await writeFile(counterPath, JSON.stringify({ counter, updatedAt: createdAt }), 'utf8');
      return record;
    });
    // Очередь не должна «залипать» на ошибке одного запроса.
    queue = task.catch(() => {});
    return task;
  }

  async function count() {
    await ensureReady();
    return counter;
  }

  async function exists() {
    try {
      await access(journalPath);
      return true;
    } catch {
      return false;
    }
  }

  return { create, count, exists, paths: { root, journalPath, uploadsDir } };
}
