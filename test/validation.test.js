import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateApplication,
  validateFiles,
  validateMeetingDate,
  validateBirthDate,
  normalizePhone,
  formatPhone,
  collapseSpaces,
  FILES_LIMIT,
  MEETING_SLOTS,
} from '../shared/validation.mjs';

/** Суббота, 31 октября 2026 года. Все даты в тестах считаются от неё. */
const NOW = new Date('2026-10-31T12:00:00Z');

const appeal = {
  type: 'appeal',
  fullName: 'Иванова Мария Петровна',
  phone: '+7 (915) 941-85-42',
  email: 'ivanova@example.ru',
  corpus: 'sormovo',
  subject: 'Организация питания',
  message: 'Прошу уточнить график работы столовой в корпусе «Сормово» на второй четверти.',
  consent: true,
};

const meeting = {
  type: 'meeting',
  fullName: 'Петров Сергей Владимирович',
  phone: '8 915 941 44 50',
  email: 'petrov@example.ru',
  corpus: 'avtozavod',
  childClass: '7',
  meetingDate: '2026-11-02',
  meetingTime: '10:00',
  topic: 'Обсудить успеваемость по математике',
  consent: true,
};

const admission = {
  type: 'admission',
  fullName: 'Сидорова Анна Игоревна',
  phone: '+79159418542',
  email: 'sidorova@example.ru',
  corpus: 'verhnie-pechery',
  childName: 'Сидоров Артём',
  childBirthDate: '2019-04-12',
  targetClass: '1',
  consent: true,
};

const run = (input, now = NOW) => validateApplication(input, { now });

test('нормализация телефона принимает все привычные форматы', () => {
  const expected = '+79159418542';
  for (const value of [
    '8 (915) 941-85-42',
    '+7 915 941 85 42',
    '89159418542',
    '79159418542',
    '9159418542',
    ' 8-915-941-85-42 ',
  ]) {
    assert.equal(normalizePhone(value), expected, `не разобрал ${value}`);
  }
});

test('нормализация телефона отклоняет неверные номера', () => {
  for (const value of ['', '123', '+7 (115) 941-85-42', 'abcdefghij', '8 915 941 85']) {
    assert.equal(normalizePhone(value), null, `принял неверный номер ${value}`);
  }
});

test('маска телефона форматирует по мере ввода', () => {
  assert.equal(formatPhone('9'), '+7 (9');
  assert.equal(formatPhone('915'), '+7 (915)');
  assert.equal(formatPhone('915941'), '+7 (915) 941');
  assert.equal(formatPhone('89159418542'), '+7 (915) 941-85-42');
  assert.equal(formatPhone(''), '+7');
});

test('collapseSpaces убирает лишние пробелы и края', () => {
  assert.equal(collapseSpaces('  Иванов   Иван \n Петрович '), 'Иванов Иван Петрович');
  assert.equal(collapseSpaces(undefined), '');
});

test('корректное обращение проходит проверку и нормализуется', () => {
  const result = run(appeal);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.data.phone, '+79159418542');
  assert.equal(result.data.email, 'ivanova@example.ru');
  assert.equal(result.data.consent, true);
});

test('ФИО приводится к одному пробелу и требует имя и фамилию', () => {
  const padded = run({ ...appeal, fullName: '  Иванова   Мария  ' });
  assert.equal(padded.valid, true);
  assert.equal(padded.data.fullName, 'Иванова Мария');

  assert.match(run({ ...appeal, fullName: 'Иванова' }).errors.fullName, /фамилию и имя/);
  assert.match(run({ ...appeal, fullName: 'Иван0в Иван' }).errors.fullName, /только буквы/);
  assert.ok(run({ ...appeal, fullName: 'И' }).errors.fullName);
});

test('некорректный e-mail и телефон дают ошибки', () => {
  const result = run({ ...appeal, email: 'ivanova@', phone: '12345' });
  assert.match(result.errors.email, /корректный e-mail/);
  assert.match(result.errors.phone, /формате/);
});

test('корпус обязателен и должен быть из списка', () => {
  assert.ok(run({ ...appeal, corpus: '' }).errors.corpus);
  assert.match(run({ ...appeal, corpus: 'kadaki' }).errors.corpus, /из списка/);
});

test('без согласия на обработку ПД отправка невозможна', () => {
  const result = run({ ...appeal, consent: false });
  assert.equal(result.valid, false);
  assert.match(result.errors.consent, /согласия/);
});

test('неизвестный тип обращения отклоняется', () => {
  const result = run({ ...appeal, type: 'unknown' });
  assert.equal(result.valid, false);
  assert.equal(result.errors.type, 'Выберите тип обращения');
});

test('обращение требует тему и текст нужной длины', () => {
  const short = run({ ...appeal, subject: 'О', message: 'Мало' });
  assert.ok(short.errors.subject);
  assert.match(short.errors.message, /минимум/);

  const long = run({ ...appeal, message: 'а'.repeat(4001) });
  assert.match(long.errors.message, /4000/);
});

test('запись на встречу проходит с корректными данными', () => {
  const result = run(meeting);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.data.childClass, '7');
  assert.equal(result.data.meetingTime, '10:00');
});

test('дата встречи: только будние дни, не раньше завтра и не позже 60 дней', () => {
  assert.equal(validateMeetingDate('2026-11-02', NOW), null, 'понедельник');
  assert.match(validateMeetingDate('2026-11-01', NOW), /будние дни/, 'воскресенье');
  assert.match(validateMeetingDate('2026-10-30', NOW), /не раньше/);
  assert.match(validateMeetingDate('2027-02-01', NOW), /60 дней/);
  assert.match(validateMeetingDate('', NOW), /Выберите дату/);
  assert.match(validateMeetingDate('2026-02-31', NOW), /Выберите дату/);
});

test('время встречи берётся из доступных слотов', () => {
  assert.ok(MEETING_SLOTS.includes('17:00'));
  assert.match(run({ ...meeting, meetingTime: '20:00' }).errors.meetingTime, /из списка/);
  assert.match(run({ ...meeting, meetingTime: '' }).errors.meetingTime, /Выберите/);
});

test('класс ребёнка: 1–11 или дошкольник', () => {
  assert.equal(run({ ...meeting, childClass: 'preschool' }).valid, true);
  assert.match(run({ ...meeting, childClass: '12' }).errors.childClass, /из списка/);
  assert.ok(run({ ...meeting, childClass: '' }).errors.childClass);
});

test('вопрос о поступлении требует данные ребёнка', () => {
  const result = run(admission);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.data.childName, 'Сидоров Артём');

  assert.ok(run({ ...admission, childName: '' }).errors.childName);
  assert.match(run({ ...admission, targetClass: '0' }).errors.targetClass, /из списка/);
});

test('дата рождения ребёнка не в будущем и не старше 18 лет', () => {
  assert.equal(validateBirthDate('2019-04-12', NOW), null);
  assert.match(validateBirthDate('2027-01-01', NOW), /в будущем/);
  assert.match(validateBirthDate('2000-01-01', NOW), /18 лет/);
  assert.match(validateBirthDate('', NOW), /Укажите дату/);
});

test('вложения: расширения, количество и размер', () => {
  assert.equal(validateFiles([]), null);
  assert.equal(validateFiles([{ name: 'справка.pdf', size: 1024 }]), null);
  assert.match(validateFiles([{ name: 'вирус.exe', size: 10 }]), /допустимы только/);
  assert.match(validateFiles([{ name: 'фото.jpg', size: 0 }]), /пустой/);
  assert.match(validateFiles([{ name: 'скан.png', size: FILES_LIMIT.maxFileSize + 1 }]), /больше/);

  const sixFiles = Array.from({ length: 6 }, (_, index) => ({ name: `file${index}.pdf`, size: 10 }));
  assert.match(validateFiles(sixFiles), /не более 5/);

  const tooHeavy = [
    { name: 'a.pdf', size: 3 * 1024 * 1024 },
    { name: 'b.pdf', size: 3 * 1024 * 1024 },
  ];
  assert.match(validateFiles(tooHeavy), /Общий размер/);
});

test('ошибки вложений попадают в общий результат проверки', () => {
  const result = run({ ...appeal, files: [{ name: 'virus.exe', size: 10 }] });
  assert.equal(result.valid, false);
  assert.match(result.errors.files, /допустимы только/);
});

test('согласие принимается в разных представлениях', () => {
  for (const consent of [true, 'on', 'true']) {
    assert.equal(run({ ...appeal, consent }).valid, true, `не принял consent=${consent}`);
  }
  assert.equal(run({ ...appeal, consent: 'false' }).valid, false);
});

test('пустой ввод возвращает ошибки по всем обязательным полям', () => {
  const result = run({});
  assert.equal(result.valid, false);
  for (const field of ['type', 'fullName', 'phone', 'email', 'corpus', 'consent']) {
    assert.ok(result.errors[field], `нет ошибки для ${field}`);
  }
});

test('скрытые поля другого типа не влияют на проверку', () => {
  const result = run({ ...appeal, childClass: '12', meetingTime: '20:00', targetClass: '0' });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});
