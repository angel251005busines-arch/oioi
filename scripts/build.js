/**
 * Сборка статической версии сайта.
 *
 * Копирует `public/` в `docs/` (эту папку GitHub Pages умеет публиковать
 * в режиме «Deploy from a branch» → /docs) и кладёт рядом общий модуль
 * валидации, чтобы браузер мог импортировать `shared/validation.mjs`
 * и при статической раздаче, и на сервере.
 */
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = path.join(root, 'public');
const docsDir = path.join(root, 'docs');

async function copyDirectory(from, to) {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(source, target);
    } else if (entry.isFile()) {
      await copyFile(source, target);
    }
  }
}

await copyDirectory(publicDir, docsDir);
await mkdir(path.join(docsDir, 'shared'), { recursive: true });
await copyFile(
  path.join(root, 'shared', 'validation.mjs'),
  path.join(docsDir, 'shared', 'validation.mjs'),
);
// Каталог public/shared тоже нужен серверу и статике из корня public/.
await mkdir(path.join(publicDir, 'shared'), { recursive: true });
await copyFile(
  path.join(root, 'shared', 'validation.mjs'),
  path.join(publicDir, 'shared', 'validation.mjs'),
);

const files = await readdir(docsDir);
console.log(`Готово: статическая версия собрана в docs/ (${files.length} элементов верхнего уровня).`);
console.log('GitHub Pages: Settings → Pages → Deploy from a branch → cline/wd0578zj, папка /docs.');
console.log('Либо деплой через Actions: положите deploy/pages.workflow.yml в .github/workflows/pages.yml.');
