/**
 * Логика формы «Интернет-приёмная Школа 800».
 *
 * Вся валидация выполняется тем же модулем, что и на сервере
 * (shared/validation.mjs), поэтому клиент и сервер не расходятся в правилах.
 * Пути относительные: страница работает и в корне домена, и в подкаталоге
 * (например, на GitHub Pages по адресу /oioi/).
 */
import {
  validateApplication,
  validateFiles,
  formatPhone,
  toIsoDate,
  FILES_LIMIT,
  LIMITS,
} from '../shared/validation.mjs';

const STORAGE = {
  draft: 'sh800:draft',
  theme: 'sh800:theme',
  font: 'sh800:font',
};

const form = document.getElementById('appeal-form');
const successPanel = document.getElementById('success-panel');
const sentBanner = document.getElementById('sent-banner');
const demoBanner = document.getElementById('demo-banner');
const formError = document.getElementById('form-error');
const errorSummary = document.getElementById('error-summary');
const errorSummaryList = document.getElementById('error-summary-list');
const submitBtn = document.getElementById('submit-btn');
const submitLabel = submitBtn.querySelector('.btn__label');
const spinner = submitBtn.querySelector('.btn__spinner');
const filesInput = document.getElementById('files');
const filesList = document.getElementById('files-list');
const uploadZone = document.getElementById('upload-zone');
const messageInput = document.getElementById('message');
const messageCounter = document.getElementById('message-counter');
const draftNote = document.getElementById('draft-note');

const TYPE_SUBMIT_LABEL = {
  appeal: 'Отправить обращение',
  meeting: 'Записаться на встречу',
  admission: 'Задать вопрос о поступлении',
};

/** Выбранные файлы: input[type=file] нельзя редактировать, поэтому держим свой массив. */
let selectedFiles = [];
let isSubmitting = false;
/** Доступен ли сервер приёма обращений (на статическом хостинге — нет). */
let apiAvailable = true;

const DEMO_MESSAGE = 'Это демонстрационная версия формы: сервер приёма обращений не подключён, '
  + 'поэтому заявка не сохранится. Отправьте обращение через полную версию на сайте школы '
  + 'или позвоните в приёмную корпуса.';

/** Проверяет, отвечает ли API; на GitHub Pages его нет, и форма переходит в демо-режим. */
async function checkApi() {
  try {
    const response = await fetch('api/health', { headers: { Accept: 'application/json' } });
    apiAvailable = response.ok;
  } catch {
    apiAvailable = false;
  }
  if (!apiAvailable) demoBanner.hidden = false;
}

/* ------------------------------------------------------------------ */
/* Оформление: тема и размер шрифта                                    */
/* ------------------------------------------------------------------ */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toggle = document.querySelector('[data-theme-toggle]');
  if (!toggle) return;
  const isDark = theme === 'dark';
  toggle.setAttribute('aria-pressed', String(isDark));
  const label = toggle.querySelector('[data-theme-label]');
  if (label) label.textContent = isDark ? 'Светлая тема' : 'Тёмная тема';
}

function applyFontSize(size) {
  if (size === 'default') delete document.documentElement.dataset.fontSize;
  else document.documentElement.dataset.fontSize = size;
}

function initAppearance() {
  const storedTheme = localStorage.getItem(STORAGE.theme);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(storedTheme || (prefersDark ? 'dark' : 'light'));
  applyFontSize(localStorage.getItem(STORAGE.font) || 'default');

  const themeToggle = document.querySelector('[data-theme-toggle]');
  themeToggle?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE.theme, next);
    applyTheme(next);
  });

  const sizes = ['small', 'default', 'large', 'x-large'];
  document.querySelectorAll('[data-font]').forEach((button) => {
    button.addEventListener('click', () => {
      const current = localStorage.getItem(STORAGE.font) || 'default';
      const index = sizes.indexOf(current);
      const mode = button.dataset.font;
      const step = mode === 'increase' ? 1 : mode === 'decrease' ? -1 : 0;
      const next = mode === 'reset'
        ? 'default'
        : sizes[Math.min(sizes.length - 1, Math.max(0, index + step))];
      localStorage.setItem(STORAGE.font, next);
      applyFontSize(next);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Переключение типа обращения                                         */
/* ------------------------------------------------------------------ */

function currentType() {
  return form.querySelector('input[name="type"]:checked')?.value || 'appeal';
}

function updateSections() {
  const type = currentType();
  document.querySelectorAll('[data-section]').forEach((section) => {
    const active = section.dataset.section === type;
    section.hidden = !active;
    section.querySelectorAll('input, select, textarea').forEach((control) => {
      control.disabled = !active;
      if (!active) clearFieldError(control.name);
    });
  });
  submitLabel.textContent = TYPE_SUBMIT_LABEL[type] || TYPE_SUBMIT_LABEL.appeal;
}

/* ------------------------------------------------------------------ */
/* Ошибки полей                                                        */
/* ------------------------------------------------------------------ */

function setFieldError(field, message) {
  const control = form.elements[field];
  const box = document.getElementById(`${field}-error`);
  if (control && typeof control.setAttribute === 'function') control.setAttribute('aria-invalid', 'true');
  if (box) {
    box.textContent = message;
    box.hidden = false;
  }
}

function clearFieldError(field) {
  const control = form.elements[field];
  const box = document.getElementById(`${field}-error`);
  if (control && typeof control.removeAttribute === 'function') control.removeAttribute('aria-invalid');
  if (box) {
    box.hidden = true;
    box.textContent = '';
  }
}

function clearAllErrors() {
  form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('.field__error').forEach((el) => {
    el.hidden = true;
    el.textContent = '';
  });
  errorSummary.hidden = true;
  errorSummaryList.textContent = '';
  formError.hidden = true;
}

function focusField(field) {
  const control = form.elements[field];
  if (!control) {
    errorSummary.focus();
    return;
  }
  const target = control instanceof RadioNodeList ? control[0] : control;
  if (!target) {
    errorSummary.focus();
    return;
  }
  target.focus();
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function showErrors(errors) {
  const fields = Object.keys(errors);
  fields.forEach((field) => setFieldError(field, errors[field]));

  errorSummaryList.textContent = '';
  fields.forEach((field) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `#${field}`;
    link.textContent = errors[field];
    link.addEventListener('click', (event) => {
      event.preventDefault();
      focusField(field);
    });
    item.append(link);
    errorSummaryList.append(item);
  });
  errorSummary.hidden = fields.length === 0;

  const first = fields.find((field) => form.elements[field]);
  if (first) focusField(first);
  else errorSummary.focus();
}

/* ------------------------------------------------------------------ */
/* Маска телефона, счётчик символов, границы дат                       */
/* ------------------------------------------------------------------ */

function initPhoneMask() {
  const phone = form.elements.phone;
  if (!phone) return;

  const format = () => {
    const digits = phone.value.replace(/\D/g, '');
    if (!digits) {
      phone.value = '';
      return;
    }
    phone.value = formatPhone(digits);
  };

  phone.addEventListener('input', format);
  phone.addEventListener('blur', () => {
    const digits = phone.value.replace(/\D/g, '');
    // Неполный номер оставляем как есть — ошибку покажет валидация.
    if (digits.length >= 11) format();
  });
  phone.addEventListener('focus', () => {
    if (!phone.value) phone.value = '+7 (';
  });
}

function initMessageCounter() {
  if (!messageInput) return;
  const update = () => {
    const length = messageInput.value.length;
    messageCounter.textContent = `${length} / ${LIMITS.messageMax}`;
    messageCounter.dataset.over = String(length > LIMITS.messageMax);
  };
  messageInput.addEventListener('input', update);
  update();
}

function initDateBounds() {
  const today = new Date();
  const meetingDate = form.elements.meetingDate;
  if (meetingDate) {
    const min = new Date(today.getTime());
    min.setUTCDate(min.getUTCDate() + 1);
    const max = new Date(today.getTime());
    max.setUTCDate(max.getUTCDate() + LIMITS.meetingDaysAhead);
    meetingDate.min = toIsoDate(min);
    meetingDate.max = toIsoDate(max);
  }
  const birthDate = form.elements.childBirthDate;
  if (birthDate) birthDate.max = toIsoDate(today);
}

/* ------------------------------------------------------------------ */
/* Вложения                                                            */
/* ------------------------------------------------------------------ */

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function renderFiles() {
  filesList.textContent = '';
  selectedFiles.forEach((file, index) => {
    const item = document.createElement('li');
    item.className = 'file-item';

    const name = document.createElement('span');
    name.className = 'file-item__name';
    name.textContent = file.name;

    const size = document.createElement('span');
    size.className = 'file-item__size';
    size.textContent = formatSize(file.size);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'file-item__remove';
    remove.textContent = 'Удалить';
    remove.setAttribute('aria-label', `Удалить файл ${file.name}`);
    remove.addEventListener('click', () => {
      selectedFiles.splice(index, 1);
      renderFiles();
      validateFilesField();
    });

    item.append(name, size, remove);
    filesList.append(item);
  });
}

function validateFilesField() {
  const message = validateFiles(selectedFiles);
  if (message) {
    setFieldError('files', message);
    return false;
  }
  clearFieldError('files');
  return true;
}

function addFiles(fileList) {
  const remaining = FILES_LIMIT.maxCount - selectedFiles.length;
  const incoming = Array.from(fileList || []);
  if (remaining <= 0) {
    setFieldError('files', `Можно прикрепить не более ${FILES_LIMIT.maxCount} файлов`);
    return;
  }
  for (const file of incoming.slice(0, remaining)) {
    const duplicate = selectedFiles.some(
      (existing) => existing.name === file.name && existing.size === file.size,
    );
    if (!duplicate) selectedFiles.push(file);
  }
  renderFiles();
  validateFilesField();
}

function initUploads() {
  filesInput.addEventListener('change', () => {
    addFiles(filesInput.files);
    filesInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((type) => {
    uploadZone.addEventListener(type, (event) => {
      event.preventDefault();
      uploadZone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    uploadZone.addEventListener(type, (event) => {
      event.preventDefault();
      uploadZone.classList.remove('is-dragover');
    });
  });
  uploadZone.addEventListener('drop', (event) => {
    if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
  });

  renderFiles();
}

/* ------------------------------------------------------------------ */
/* Сбор данных формы                                                   */
/* ------------------------------------------------------------------ */

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      size: file.size,
      type: file.type,
      dataUrl: String(reader.result),
    });
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

function collectValues() {
  const values = {};
  const controls = form.querySelectorAll('input, select, textarea');
  controls.forEach((control) => {
    if (!control.name || control.type === 'file' || control.type === 'radio') return;
    if (control.disabled) return;
    values[control.name] = control.type === 'checkbox' ? control.checked : control.value;
  });
  values.type = currentType();
  return values;
}

async function buildPayload() {
  const values = collectValues();
  const files = await Promise.all(selectedFiles.map(readFileAsDataUrl));
  return { ...values, files };
}

/* ------------------------------------------------------------------ */
/* Отправка                                                            */
/* ------------------------------------------------------------------ */

function setLoading(loading) {
  isSubmitting = loading;
  submitBtn.disabled = loading;
  spinner.hidden = !loading;
  submitBtn.setAttribute('aria-busy', String(loading));
}

function showSuccess(id) {
  form.hidden = true;
  successPanel.hidden = false;
  document.getElementById('success-id').textContent = id;
  localStorage.removeItem(STORAGE.draft);
  draftNote.hidden = true;
  successPanel.scrollIntoView({ block: 'center', behavior: 'smooth' });
  successPanel.querySelector('#new-appeal')?.focus({ preventScroll: true });
}

async function handleSubmit(event) {
  event.preventDefault();
  if (isSubmitting) return;

  clearAllErrors();
  let payload;
  try {
    payload = await buildPayload();
  } catch {
    formError.textContent = 'Не удалось прочитать вложенные файлы. Попробуйте удалить их и прикрепить заново.';
    formError.hidden = false;
    return;
  }

  const result = validateApplication(payload);
  if (!result.valid) {
    showErrors(result.errors);
    return;
  }

  if (!apiAvailable) {
    formError.textContent = DEMO_MESSAGE;
    formError.hidden = false;
    formError.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }

  setLoading(true);
  try {
    const response = await fetch('api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));

    if (response.status === 201 && data.ok) {
      showSuccess(data.id);
      return;
    }
    if (response.status === 422 && data.errors) {
      showErrors(data.errors);
      return;
    }
    if (response.status === 404 || response.status === 405) {
      // Статический хостинг без API: сообщаем честно, а не «ошибка соединения».
      apiAvailable = false;
      demoBanner.hidden = false;
      formError.textContent = DEMO_MESSAGE;
      formError.hidden = false;
      formError.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    formError.textContent = data.message
      || 'Не удалось отправить обращение. Проверьте соединение и попробуйте ещё раз.';
    formError.hidden = false;
    formError.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch {
    formError.textContent = 'Нет соединения с сервером. Проверьте интернет или позвоните в приёмную корпуса.';
    formError.hidden = false;
    formError.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } finally {
    setLoading(false);
  }
}

/* ------------------------------------------------------------------ */
/* Черновик                                                            */
/* ------------------------------------------------------------------ */

const DRAFT_FIELDS = [
  'fullName', 'phone', 'email', 'corpus', 'subject', 'message',
  'childClass', 'meetingDate', 'meetingTime', 'topic',
  'childName', 'childBirthDate', 'targetClass',
];

function saveDraft() {
  const draft = { type: currentType() };
  DRAFT_FIELDS.forEach((field) => {
    const control = form.elements[field];
    if (control && control.value) draft[field] = control.value;
  });
  try {
    localStorage.setItem(STORAGE.draft, JSON.stringify(draft));
    draftNote.hidden = false;
  } catch {
    // localStorage может быть недоступен (приватный режим) — молча пропускаем.
  }
}

function restoreDraft() {
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem(STORAGE.draft) || 'null');
  } catch {
    return;
  }
  if (!draft || typeof draft !== 'object') return;

  const radio = form.querySelector(`input[name="type"][value="${draft.type}"]`);
  if (radio) radio.checked = true;

  DRAFT_FIELDS.forEach((field) => {
    const control = form.elements[field];
    if (control && draft[field]) control.value = draft[field];
  });
  draftNote.hidden = false;
  initMessageCounter();
}

function initDraft() {
  let timer = null;
  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(saveDraft, 500);
  });
  form.addEventListener('change', saveDraft);
}

/* ------------------------------------------------------------------ */
/* Инициализация                                                       */
/* ------------------------------------------------------------------ */

function initTypeSwitcher() {
  form.querySelectorAll('input[name="type"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      updateSections();
      clearAllErrors();
      saveDraft();
    });
  });
}

function initLiveValidation() {
  // Повторно проверяем поле, если по нему уже была показана ошибка.
  const revalidate = (control) => {
    if (!control?.name) return;
    const box = document.getElementById(`${control.name}-error`);
    const hasError = control.getAttribute('aria-invalid') === 'true' || box?.hidden === false;
    if (!hasError) return;
    const result = validateApplication(collectValues());
    if (result.errors[control.name]) setFieldError(control.name, result.errors[control.name]);
    else clearFieldError(control.name);
  };

  form.addEventListener('blur', (event) => revalidate(event.target), true);
  form.addEventListener('input', (event) => {
    if (event.target?.name === 'message' || event.target?.type === 'checkbox') revalidate(event.target);
  }, true);
}

function resetUi({ keepSuccess = false } = {}) {
  selectedFiles = [];
  renderFiles();
  clearAllErrors();
  localStorage.removeItem(STORAGE.draft);
  draftNote.hidden = true;
  if (!keepSuccess) successPanel.hidden = true;
  form.hidden = false;
  updateSections();
  initMessageCounter();
}

function initReset() {
  document.getElementById('reset-btn')?.addEventListener('click', () => {
    setTimeout(() => {
      resetUi();
      form.elements.fullName?.focus();
    }, 0);
  });

  document.getElementById('new-appeal')?.addEventListener('click', () => {
    form.reset();
    resetUi();
    form.elements.fullName?.focus();
  });
}

function initSentBanner() {
  const params = new URLSearchParams(window.location.search);
  const sentId = params.get('sent');
  if (!sentId) return;
  sentBanner.textContent = `Спасибо! Обращение №${sentId} зарегистрировано. Ответ придёт на указанный e-mail.`;
  sentBanner.hidden = false;
  sentBanner.scrollIntoView({ block: 'center', behavior: 'smooth' });
  window.history.replaceState({}, '', window.location.pathname);
}

function init() {
  initAppearance();
  checkApi();
  initTypeSwitcher();
  initPhoneMask();
  initMessageCounter();
  initDateBounds();
  initUploads();
  initLiveValidation();
  initDraft();
  initReset();
  initSentBanner();
  restoreDraft();
  updateSections();

  form.addEventListener('submit', handleSubmit);
}

init();
