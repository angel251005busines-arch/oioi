/**
 * Сборка для статического хостинга (GitHub Pages, nginx без Node).
 *
 * Копирует общий модуль валидации в `public/shared/`, чтобы браузер мог
 * импортировать его по адресу `/shared/validation.mjs` и при статической
 * раздаче каталога `public/`.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const target = path.join(root, 'public', 'shared');

await mkdir(target, { recursive: true });
await copyFile(
  path.join(root, 'shared', 'validation.mjs'),
  path.join(target, 'validation.mjs'),
);

console.log('Готово: shared/validation.mjs → public/shared/validation.mjs');
console.log('Статическая раздача: каталог public/ (API-запросы на /api/applications требует сервер).');
