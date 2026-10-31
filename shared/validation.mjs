/**
 * Общие правила валидации формы «Интернет-приёмная Школа 800».
 *
 * Модуль используется и в браузере (public/js/app.js), и на сервере
 * (server/app.js), поэтому здесь нет обращений к DOM, `window`, `document`
 * и Node-специфичных API. Только чистые функции — их удобно покрывать тестами.
 */

/** Корпуса АНОО «Школа 800». */
export const CORPUSES = Object.freeze([
  { value: 'verhnie-pechery', label: 'Корпус «Верхние Печеры»', address: 'ул. Нижне-Печерская, 4А' },
  { value: 'avtozavod', label: 'Корпус «Автозавод»', address: 'Южный бульвар, 23' },
  { value: 'sormovo', label: 'Корпус «Сормово»', address: 'пр-т Кораблестроителей, 52к1' },
]);

export const CORPUS_VALUES = CORPUSES.map((corpus) => corpus.value);

/** Типы обращений, доступные в форме. */
export const REQUEST_TYPES = Object.freeze(['appeal', 'meeting', 'admission']);

/** Классы обучения (1–11). */
export const CLASS_VALUES = Object.freeze(
  Array.from({ length: 11 }, (_, index) => String(index + 1)),
);

/** Слоты для записи на очную встречу (будни, 09:00–17:00). */
export const MEETING_SLOTS = Object.freeze([
  '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
]);

/** Ограничения на вложения — как на действующем сайте школы. */
export const FILES_LIMIT = Object.freeze({
  maxCount: 5,
  maxFileSize: 5 * 1024 * 1024,
  maxTotalSize: 5 * 1024 * 1024,
  allowedExtensions: Object.freeze(['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'txt']),
  allowedMimeTypes: Object.freeze([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ]),
});

export const LIMITS = Object.freeze({
  fullNameMin: 3,
  fullNameMax: 120,
  subjectMin: 3,
  subjectMax: 120,
  messageMin: 10,
  messageMax: 4000,
  topicMin: 5,
  topicMax: 500,
  emailMax: 254,
  meetingDaysAhead: 60,
});

const CYRILLIC_NAME = /^[А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z\s'’-]*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-zА-Яа-яЁё]{2,}$/;

export const TYPE_LABELS = Object.freeze({
  appeal: 'Обращение',
  meeting: 'Запись на очную встречу',
  admission: 'Вопрос о поступлении',
});

function str(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : String(value);
}

export function collapseSpaces(value) {
  return str(value).replace(/\s+/g, ' ').trim();
}

/**
 * Приводит телефон к формату +7XXXXXXXXXX.
 * Принимает 8 (999) 123-45-67, +7 999 1234567, 79991234567 и т. п.
 * Возвращает null, если номер не является корректным российским номером.
 */
export function normalizePhone(value) {
  const digits = str(value).replace(/\D/g, '');
  let national;
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    national = digits.slice(1);
  } else if (digits.length === 10) {
    national = digits;
  } else {
    return null;
  }
  if (!/^[3-9]\d{9}$/.test(national)) return null;
  return `+7${national}`;
}

/** Форматирует телефон для показа в поле ввода: +7 (999) 123-45-67. */
export function formatPhone(value) {
  const digits = str(value).replace(/\D/g, '');
  const national = digits.length && (digits[0] === '7' || digits[0] === '8')
    ? digits.slice(1, 11)
    : digits.slice(0, 10);
  const first = national.slice(0, 3);
  const second = national.slice(3, 6);
  const third = national.slice(6, 8);
  const fourth = national.slice(8, 10);
  let out = '+7';
  if (first) out += ` (${first}`;
  if (first.length === 3) out += ')';
  if (second) out += ` ${second}`;
  if (third) out += `-${third}`;
  if (fourth) out += `-${fourth}`;
  return out;
}

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (Number.isNaN(date.getTime())) return null;
  // Отсекаем несуществующие даты вроде 31 февраля.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== dayOfMonth) return null;
  return date;
}

/** Возвращает YYYY-MM-DD для даты в UTC. */
export function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Дата встречи: будний день, не раньше завтрашнего и не позже
 * LIMITS.meetingDaysAhead дней от `now`.
 */
export function validateMeetingDate(value, now = new Date()) {
  const date = parseIsoDate(value);
  if (!date) return 'Выберите дату встречи';
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return 'Встречи проводятся только в будние дни';
  const diffDays = Math.round((startOfUtcDay(date) - startOfUtcDay(now)) / 86400000);
  if (diffDays < 1) return 'Дата встречи должна быть не раньше завтрашнего дня';
  if (diffDays > LIMITS.meetingDaysAhead) {
    return `Записаться можно не более чем на ${LIMITS.meetingDaysAhead} дней вперёд`;
  }
  return null;
}

/** Дата рождения ребёнка: не в будущем, возраст не больше 18 лет. */
export function validateBirthDate(value, now = new Date()) {
  const date = parseIsoDate(value);
  if (!date) return 'Укажите дату рождения ребёнка';
  if (startOfUtcDay(date) > startOfUtcDay(now)) return 'Дата рождения не может быть в будущем';
  const earliest = Date.UTC(now.getUTCFullYear() - 19, now.getUTCMonth(), now.getUTCDate());
  if (startOfUtcDay(date) < earliest) return 'Проверьте дату: возраст не должен превышать 18 лет';
  return null;
}

/**
 * Валидирует вложения по метаданным (name, size).
 * @returns {string|null} текст ошибки или null, если всё в порядке.
 */
export function validateFiles(files) {
  if (!files || files.length === 0) return null;
  const list = Array.from(files);
  if (list.length > FILES_LIMIT.maxCount) {
    return `Можно прикрепить не более ${FILES_LIMIT.maxCount} файлов`;
  }
  let total = 0;
  for (const file of list) {
    const name = str(file && file.name);
    const size = Number(file && file.size) || 0;
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (!FILES_LIMIT.allowedExtensions.includes(extension)) {
      return `Файл «${name}»: допустимы только ${FILES_LIMIT.allowedExtensions.join(', ')}`;
    }
    if (size === 0) return `Файл «${name}» пустой`;
    if (size > FILES_LIMIT.maxFileSize) {
      return `Файл «${name}» больше ${FILES_LIMIT.maxFileSize / 1024 / 1024} МБ`;
    }
    total += size;
  }
  if (total > FILES_LIMIT.maxTotalSize) {
    return `Общий размер файлов больше ${FILES_LIMIT.maxTotalSize / 1024 / 1024} МБ`;
  }
  return null;
}

/** Список обязательных полей для каждого типа обращения. */
export const REQUIRED_FIELDS = Object.freeze({
  appeal: ['fullName', 'phone', 'email', 'corpus', 'subject', 'message', 'consent'],
  meeting: ['fullName', 'phone', 'email', 'corpus', 'childClass', 'meetingDate', 'meetingTime', 'topic', 'consent'],
  admission: ['fullName', 'phone', 'email', 'corpus', 'childName', 'childBirthDate', 'targetClass', 'consent'],
});

function setError(errors, field, message) {
  if (!errors[field]) errors[field] = message;
}

/**
 * Полная проверка данных обращения.
 *
 * @param {object} input — «сырые» данные из формы или API.
 * @param {{ now?: Date }} [options]
 * @returns {{ valid: boolean, errors: Record<string,string>, data: object }}
 *   `data` — нормализованные значения, пригодные для сохранения.
 */
export function validateApplication(input, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const source = input && typeof input === 'object' ? input : {};
  const errors = {};
  const data = {};

  const type = str(source.type).trim();
  data.type = type;
  const knownType = REQUEST_TYPES.includes(type);
  if (!knownType) setError(errors, 'type', 'Выберите тип обращения');

  // ФИО заявителя
  const fullName = collapseSpaces(source.fullName);
  data.fullName = fullName;
  if (!fullName) {
    setError(errors, 'fullName', 'Укажите фамилию, имя и отчество');
  } else if (fullName.length < LIMITS.fullNameMin || fullName.length > LIMITS.fullNameMax) {
    setError(errors, 'fullName', `ФИО должно быть от ${LIMITS.fullNameMin} до ${LIMITS.fullNameMax} символов`);
  } else if (!CYRILLIC_NAME.test(fullName)) {
    setError(errors, 'fullName', 'ФИО может содержать только буквы, пробелы и дефис');
  } else if (fullName.split(' ').length < 2) {
    setError(errors, 'fullName', 'Укажите фамилию и имя полностью');
  }

  // Телефон
  const rawPhone = str(source.phone).trim();
  const phone = normalizePhone(rawPhone);
  data.phone = phone ?? rawPhone;
  if (!rawPhone) {
    setError(errors, 'phone', 'Укажите телефон для связи');
  } else if (!phone) {
    setError(errors, 'phone', 'Телефон должен быть в формате +7 (999) 123-45-67');
  }

  // E-mail
  const email = str(source.email).trim();
  data.email = email.toLowerCase();
  if (!email) {
    setError(errors, 'email', 'Укажите e-mail для ответа');
  } else if (email.length > LIMITS.emailMax || !EMAIL_RE.test(email)) {
    setError(errors, 'email', 'Укажите корректный e-mail, например name@example.ru');
  }

  // Корпус
  const corpus = str(source.corpus).trim();
  data.corpus = corpus;
  if (!corpus) {
    setError(errors, 'corpus', 'Выберите корпус школы');
  } else if (!CORPUS_VALUES.includes(corpus)) {
    setError(errors, 'corpus', 'Выберите корпус из списка');
  }

  if (knownType) {
    if (type === 'appeal') validateAppeal(source, errors, data);
    else if (type === 'meeting') validateMeeting(source, errors, data, now);
    else validateAdmission(source, errors, data, now);
  }

  // Согласие на обработку персональных данных
  const consent = source.consent === true || source.consent === 'on' || source.consent === 'true';
  data.consent = consent;
  if (!consent) {
    setError(errors, 'consent', 'Без согласия на обработку персональных данных отправить обращение нельзя');
  }

  const files = Array.isArray(source.files) ? source.files : [];
  const filesError = validateFiles(files);
  if (filesError) setError(errors, 'files', filesError);

  return { valid: Object.keys(errors).length === 0, errors, data };
}

function validateAppeal(source, errors, data) {
  const subject = collapseSpaces(source.subject);
  data.subject = subject;
  if (!subject) {
    setError(errors, 'subject', 'Укажите тему обращения');
  } else if (subject.length < LIMITS.subjectMin || subject.length > LIMITS.subjectMax) {
    setError(errors, 'subject', `Тема должна быть от ${LIMITS.subjectMin} до ${LIMITS.subjectMax} символов`);
  }

  const message = str(source.message).trim();
  data.message = message;
  if (!message) {
    setError(errors, 'message', 'Опишите ваш вопрос');
  } else if (message.length < LIMITS.messageMin) {
    setError(errors, 'message', `Опишите вопрос подробнее — минимум ${LIMITS.messageMin} символов`);
  } else if (message.length > LIMITS.messageMax) {
    setError(errors, 'message', `Текст обращения не должен превышать ${LIMITS.messageMax} символов`);
  }
}

function validateMeeting(source, errors, data, now) {
  const childClass = str(source.childClass).trim();
  data.childClass = childClass;
  if (!childClass) {
    setError(errors, 'childClass', 'Укажите класс, в котором учится ребёнок');
  } else if (childClass !== 'preschool' && !CLASS_VALUES.includes(childClass)) {
    setError(errors, 'childClass', 'Выберите класс из списка');
  }

  const meetingDate = str(source.meetingDate).trim();
  data.meetingDate = meetingDate;
  const dateError = validateMeetingDate(meetingDate, now);
  if (dateError) setError(errors, 'meetingDate', dateError);

  const meetingTime = str(source.meetingTime).trim();
  data.meetingTime = meetingTime;
  if (!meetingTime) {
    setError(errors, 'meetingTime', 'Выберите удобное время встречи');
  } else if (!MEETING_SLOTS.includes(meetingTime)) {
    setError(errors, 'meetingTime', 'Выберите время из списка доступных слотов');
  }

  const topic = collapseSpaces(source.topic);
  data.topic = topic;
  if (!topic) {
    setError(errors, 'topic', 'Сформулируйте вопрос для встречи');
  } else if (topic.length < LIMITS.topicMin || topic.length > LIMITS.topicMax) {
    setError(errors, 'topic', `Вопрос должен быть от ${LIMITS.topicMin} до ${LIMITS.topicMax} символов`);
  }
}

function validateAdmission(source, errors, data, now) {
  const childName = collapseSpaces(source.childName);
  data.childName = childName;
  if (!childName) {
    setError(errors, 'childName', 'Укажите фамилию и имя ребёнка');
  } else if (childName.length < 2 || childName.length > LIMITS.fullNameMax) {
    setError(errors, 'childName', `Имя ребёнка должно быть от 2 до ${LIMITS.fullNameMax} символов`);
  } else if (!CYRILLIC_NAME.test(childName)) {
    setError(errors, 'childName', 'Имя ребёнка может содержать только буквы, пробелы и дефис');
  }

  const childBirthDate = str(source.childBirthDate).trim();
  data.childBirthDate = childBirthDate;
  const birthError = validateBirthDate(childBirthDate, now);
  if (birthError) setError(errors, 'childBirthDate', birthError);

  const targetClass = str(source.targetClass).trim();
  data.targetClass = targetClass;
  if (!targetClass) {
    setError(errors, 'targetClass', 'Выберите класс поступления');
  } else if (!CLASS_VALUES.includes(targetClass)) {
    setError(errors, 'targetClass', 'Выберите класс из списка');
  }
}
