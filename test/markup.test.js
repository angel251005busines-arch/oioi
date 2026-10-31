import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REQUEST_TYPES, REQUIRED_FIELDS } from '../shared/validation.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const html = await readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');
const appJs = await readFile(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
const css = await readFile(path.join(ROOT, 'public', 'css', 'styles.css'), 'utf8');

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);

test('в разметке нет дублирующихся id', () => {
  const seen = new Set();
  const duplicates = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  assert.deepEqual(duplicates, []);
});

test('каждый label[for] указывает на существующее поле', () => {
  const targets = [...html.matchAll(/<label[^>]+for="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(targets.length > 5);
  for (const target of targets) {
    assert.ok(ids.includes(target), `label указывает на отсутствующий id="${target}"`);
  }
});

test('все aria-describedby и aria-labelledby ссылаются на существующие id', () => {
  for (const attribute of ['aria-describedby', 'aria-labelledby']) {
    const pattern = new RegExp(`${attribute}="([^"]+)"`, 'g');
    for (const match of html.matchAll(pattern)) {
      for (const token of match[1].split(/\s+/).filter(Boolean)) {
        assert.ok(ids.includes(token), `${attribute} ссылается на отсутствующий id="${token}"`);
      }
    }
  }
});

test('локальные ресурсы страницы существуют', async () => {
  const localLinks = [...html.matchAll(/(?:src|href)="([^"/][^"]*|\.\/[^"]*)"/g)]
    .map((match) => match[1])
    .filter((href) => !href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('#'));

  assert.ok(localLinks.length >= 3);
  for (const link of localLinks) {
    const clean = link.split('#')[0].split('?')[0];
    const filePath = path.join(ROOT, 'public', clean);
    const info = await stat(filePath).catch(() => null);
    assert.ok(info?.isFile(), `не найден файл ${link}`);
  }
});

test('все пути относительные — страница работает в подкаталоге (GitHub Pages)', async () => {
  const absolute = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(absolute, [], 'найдены абсолютные пути, ломающиеся в подкаталоге');
  assert.match(appJs, /from '\.\.\/shared\/validation\.mjs'/);
  assert.match(appJs, /fetch\('api\/applications'/);
});

test('форма отправляется на API и не использует встроенный JS/CSS (CSP)', () => {
  assert.match(html, /<form[^>]+id="appeal-form"[^>]+action="\/api\/applications"[^>]+method="post"/);
  assert.match(html, /novalidate/);
  assert.equal(/<script(?![^>]+src=)[^>]*>/i.test(html), false, 'найден inline <script>');
  assert.equal(/\sstyle="/i.test(html), false, 'найден inline style');
});

test('у каждого поля формы есть name и связанная подсказка или ошибка', () => {
  const fields = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)];
  assert.ok(fields.length > 10);
  for (const [, tag, attributes] of fields) {
    const name = /name="([^"]+)"/.exec(attributes)?.[1];
    assert.ok(name, `поле <${tag}> без name`);
    if (tag === 'input' && /type="(file|checkbox|radio)"/.test(attributes)) continue;
    if (name === 'website') continue;
    assert.ok(ids.includes(`${name}-error`), `нет элемента ошибки #${name}-error`);
  }
});

test('секции формы соответствуют типам обращений', () => {
  const sections = [...html.matchAll(/data-section="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(sections.sort(), [...REQUEST_TYPES].sort());
});

test('для каждого типа обращения в разметке есть обязательные поля', () => {
  const common = ['fullName', 'phone', 'email', 'corpus', 'consent'];
  for (const [type, fields] of Object.entries(REQUIRED_FIELDS)) {
    for (const field of fields) {
      if (common.includes(field)) continue;
      assert.ok(html.includes(`name="${field}"`), `тип ${type}: нет поля ${field}`);
    }
  }
});

test('app.js не ссылается на отсутствующие в разметке элементы', () => {
  const referenced = [...appJs.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]);
  assert.ok(referenced.length > 5);
  for (const id of new Set(referenced)) {
    assert.ok(ids.includes(id), `app.js ищет отсутствующий id="${id}"`);
  }
});

test('в app.js обработка статического хостинга и демо-режим подключены', () => {
  assert.match(html, /id="demo-banner"/);
  assert.match(appJs, /fetch\('api\/health'/);
  assert.match(appJs, /Демонстрационная версия|демонстрационная версия/);
});

test('CSS синтаксически сбалансирован и не содержит незакрытых блоков', () => {
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  assert.equal(open, close);
  assert.ok(open > 50);
});

test('в CSS заданы цвета бренда сайта и тёмная тема', () => {
  assert.match(css, /--brand:\s*#008587/);
  assert.match(css, /--accent:\s*#f47b32/);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
