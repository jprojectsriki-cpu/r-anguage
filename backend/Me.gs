/**
 * R-ANGUAGE API - 受講生の画面（マイページ・ホーム）と、試験日の管理
 * - 受講生：自分の情報・お知らせ・試験日の一覧を読む／パスワード変更／レベルの追加申込／試験日と表示の設定を保存
 * - 管理者：試験日の登録・削除（受講生は、ここで登録した試験日から選ぶ）
 * - Users シートの L列＝試験日ID、M列＝表示の設定（JSON）。setupMyPage で見出しを足す
 */

const SHEET_EXAM_DATES = 'ExamDates';
const E_HEADERS = ['試験日ID', '試験名', '試験日', '作成日時'];
const USER_COL_EXAM = 12;     // L列：試験日ID
const USER_COL_SETTINGS = 13; // M列：表示の設定（JSON）
const SETTINGS_DEFAULT = { furigana: true, fontSize: 'm', speed: 1 };
const FONT_SIZES = ['s', 'm', 'l'];
const SPEEDS = [0.75, 1, 1.25];

/**
 * 【1回だけ実行】マイページで使う列とシートを用意する
 * - Users シートの L列「試験日ID」、M列「表示の設定」の見出し
 * - ExamDates シート（試験日ID・試験名・試験日・作成日時）
 * もう用意してあるときは何もしないので、2回実行しても大丈夫
 */
function setupMyPage() {
  const users = getSheet_(SHEET_USERS);
  users.getRange(1, USER_COL_EXAM, 1, 2).setValues([['examId', 'settings']]).setFontWeight('bold');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_EXAM_DATES);
  if (!sheet) sheet = ss.insertSheet(SHEET_EXAM_DATES);
  sheet.getRange(1, 1, 1, E_HEADERS.length).setValues([E_HEADERS]).setFontWeight('bold').setBackground('#FFE8F1');
  sheet.setFrozenRows(1);
  sheet.getRange(2, 1, sheet.getMaxRows() - 1, 3).setNumberFormat('@'); // 日付が自動で変換されないように
  [100, 220, 110, 150].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  Logger.log('Users シートの L列（examId）・M列（settings）と、ExamDates シートを用意しました');
}

/* =========================================================
 * 共通
 * ========================================================= */

/** ログインしている受講生（または管理者）を確かめ、Users シートの行を読み直す */
function requireMe_(token) {
  const auth = checkSession_(token);
  if (!auth.ok) return auth;
  const row = findUserRowById_(auth.user.userId);
  if (!row) return { ok: false, reason: 'expired', message: 'アカウントが見つかりません。もう一度ログインしてください。' };
  const sheet = getSheet_(SHEET_USERS);
  const r = sheet.getRange(row, 1, 1, USER_COL_SETTINGS).getValues()[0];
  if (String(r[6]) !== 'active') {
    return { ok: false, reason: 'suspended', message: 'このアカウントは現在ご利用いただけません。' };
  }
  let settings = {};
  try { settings = JSON.parse(String(r[USER_COL_SETTINGS - 1] || '{}')) || {}; } catch (e) { settings = {}; }
  return {
    ok: true,
    session: auth.user,
    row: row,
    user: {
      userId: String(r[0]),
      email: String(r[1]),
      passwordHash: String(r[2]),
      salt: String(r[3]),
      name: String(r[4]),
      role: String(r[5]),
      levels: String(r[7] || '').split(',').filter(String),
      examId: String(r[USER_COL_EXAM - 1] || ''),
      settings: cleanSettings_(settings)
    }
  };
}

/** 表示の設定を、決まった値だけにそろえる */
function cleanSettings_(s) {
  s = s || {};
  return {
    furigana: s.furigana === undefined ? SETTINGS_DEFAULT.furigana : s.furigana === true,
    fontSize: FONT_SIZES.indexOf(s.fontSize) >= 0 ? s.fontSize : SETTINGS_DEFAULT.fontSize,
    speed: SPEEDS.indexOf(Number(s.speed)) >= 0 ? Number(s.speed) : SETTINGS_DEFAULT.speed
  };
}

/** 試験日の一覧（日付の近い順） */
function readExamDates_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EXAM_DATES);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues()
    .map(function (r, i) {
      return { row: i + 2, examId: String(r[0]).trim(), name: String(r[1]).trim(), date: normalizeDate_(r[2]) };
    })
    .filter(function (e) { return e.examId && e.date; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

/* =========================================================
 * 受講生
 * ========================================================= */

/**
 * 自分の情報（ホーム・マイページで使う）
 * - お知らせ：公開中で、今日が表示期間の中にあり、対象が「すべて」か自分のレベルのもの（新しい順）
 * - 試験日：今日以降のもの（選んでいる試験日は、過ぎていても入れる）
 * - 申込：入金待ち・入金確認済みのもの（追加申込の状況を出すため）
 */
function meProfile_(token) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  const u = me.user;
  const today = todayJst_();

  const notices = readNotices_()
    .filter(function (n) {
      return validateNotice_(n).length === 0 && noticePhase_(n, today) === 'showing' &&
        (n.target === 'すべて' || u.levels.indexOf(n.target) >= 0);
    })
    .sort(function (a, b) {
      if (a.importance !== b.importance) return a.importance === '重要' ? -1 : 1;
      return a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0;
    })
    .map(function (n) {
      return { noticeId: n.noticeId, title: n.title, body: n.body, important: n.importance === '重要', startDate: n.startDate };
    });

  const exams = readExamDates_()
    .filter(function (e) { return e.date >= today || e.examId === u.examId; })
    .map(function (e) { return { examId: e.examId, name: e.name, date: e.date }; });

  const pending = readApplications_()
    .filter(function (a) { return a.userId === u.userId && (a.status === 'awaiting_payment' || a.status === 'paid'); })
    .map(function (a) {
      return { applicationId: a.applicationId, level: a.level, amount: a.amount, status: a.status, expiresAt: a.expiresAt };
    });

  return {
    ok: true,
    today: today,
    user: { name: u.name, email: u.email, levels: u.levels, examId: u.examId, settings: u.settings },
    prices: PRICES,
    notices: notices,
    exams: exams,
    pending: pending
  };
}

/** パスワードの変更（いまのパスワードを確かめる。この端末はログインしたまま） */
function meChangePassword_(token, current, next) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  current = String(current || '');
  next = String(next || '');
  if (!verifyPassword_(current, me.user.salt, me.user.passwordHash)) {
    return { ok: false, message: 'いまのパスワードが正しくありません。' };
  }
  if (next.length < 8 || next.length > 64) return { ok: false, message: '新しいパスワードは8〜64文字で入力してください。' };
  if (next === current) return { ok: false, message: '新しいパスワードが、いまのパスワードと同じです。' };

  const salt = generateSalt_();
  getSheet_(SHEET_USERS).getRange(me.row, 3, 1, 2).setValues([[hashPassword_(next, salt), salt]]);
  sendMePasswordMail_(me.user);
  return { ok: true, message: 'パスワードを変更しました。' };
}

/** パスワードを変更したことを知らせるメール */
function sendMePasswordMail_(u) {
  MailApp.sendEmail({
    to: u.email,
    subject: '【R-ANGUAGE】パスワードを変更しました',
    name: 'R-ANGUAGE',
    body: [
      u.name + ' 様',
      '',
      'マイページから、R-ANGUAGE のパスワードを変更しました。',
      '次からは、新しいパスワードでログインしてください。',
      '',
      '※ 心当たりがない場合は、すぐにログイン画面の「パスワードを忘れた方」から、パスワードを設定し直してください。',
      RESET_LOGIN_URL,
      '',
      '----------------------------------------',
      'R-ANGUAGE｜JLPT N4〜N1 日本語学習システム'
    ].join('\n')
  });
}

/**
 * レベルの追加申込（新規の申し込みと同じ流れ・料金）
 * 申込番号を作って Applications に「入金待ち」で入れ、振込先とATMの手順をメールで送る
 * 入金を確かめて管理画面で「発行」すると、そのレベルが使えるようになる
 */
function meApplyLevel_(token, level) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  level = String(level || '');
  if (!PRICES[level]) return { ok: false, message: 'レベルを選んでください。' };
  if (me.user.levels.indexOf(level) >= 0) return { ok: false, message: level + ' は、すでに使えるレベルです。' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let application;
  try {
    const now = new Date();
    const open = readApplications_().filter(function (a) {
      return a.userId === me.user.userId && a.level === level &&
        (a.status === 'paid' || (a.status === 'awaiting_payment' && a.expiresAt && new Date(a.expiresAt).getTime() > now.getTime()));
    });
    if (open.length) {
      return { ok: false, message: level + ' は、お支払い待ちのお申し込み（' + open[0].applicationId + '）があります。受付メールに書かれた支払期限までにお支払いください。' };
    }
    application = {
      applicationId: makeApplicationId_(),
      level: level,
      amount: PRICES[level],
      payment: PAYMENT_DEFAULT,
      expiresAt: new Date(now.getTime() + PAYMENT_DAYS * 24 * 60 * 60 * 1000)
    };
    getSheet_(SHEET_APPLICATIONS).appendRow([
      application.applicationId, me.user.userId, me.user.email, me.user.name, level, application.amount,
      application.payment, 'awaiting_payment', now, application.expiresAt, '', '', '', 'マイページから追加申込'
    ]);
  } finally {
    lock.releaseLock();
  }
  sendApplyMails_(me.user.name, me.user.email, application);
  return {
    ok: true,
    applicationId: application.applicationId,
    expiresAt: application.expiresAt.toISOString(),
    message: level + ' の追加のお申し込みを受け付けました（申込番号：' + application.applicationId + '）。振込先をメールでお送りしました。'
  };
}

/** 試験日と表示の設定を保存する */
function meSaveSettings_(token, input) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  input = input || {};
  const examId = String(input.examId || '').trim();
  if (examId && !readExamDates_().some(function (e) { return e.examId === examId; })) {
    return { ok: false, message: '選んだ試験日が見つかりません。画面を読み込み直してください。' };
  }
  const settings = cleanSettings_(input.settings);
  getSheet_(SHEET_USERS).getRange(me.row, USER_COL_EXAM, 1, 2).setValues([[examId, JSON.stringify(settings)]]);
  return { ok: true, examId: examId, settings: settings, message: '設定を保存しました。' };
}

/* =========================================================
 * 管理者：試験日
 * ========================================================= */

function adminListExamDates_(token) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;
  return { ok: true, today: todayJst_(), exams: readExamDates_().map(function (e) { return { examId: e.examId, name: e.name, date: e.date }; }) };
}

/** 試験日の追加・変更（examId があれば変更） */
function adminSaveExamDate_(token, input) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;
  input = input || {};
  const name = String(input.name || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 50);
  const date = normalizeDate_(input.date);
  if (!name) return { ok: false, message: '試験名を入力してください（例：2027年7月 JLPT）。' };
  if (!isValidDate_(date)) return { ok: false, message: '試験日は 2027-07-04 の形で、正しい日付を入力してください。' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_(SHEET_EXAM_DATES);
    const list = readExamDates_();
    if (list.some(function (e) { return e.date === date && e.examId !== input.examId; })) {
      return { ok: false, message: date + ' の試験日は、すでに登録されています。' };
    }
    if (input.examId) {
      const e = list.filter(function (x) { return x.examId === input.examId; })[0];
      if (!e) return { ok: false, message: 'この試験日は見つかりません。画面を読み込み直してください。' };
      sheet.getRange(e.row, 2, 1, 2).setValues([[name, date]]);
      return { ok: true, message: '試験日を変更しました。' };
    }
    const props = PropertiesService.getScriptProperties();
    const seq = Number(props.getProperty('SEQ_EXAM') || 0) + 1;
    props.setProperty('SEQ_EXAM', String(seq));
    sheet.appendRow(['E' + String(seq).padStart(3, '0'), name, date, new Date()]);
    return { ok: true, message: '試験日を追加しました。' };
  } finally {
    lock.releaseLock();
  }
}

/** 試験日の削除（選んでいた受講生は「試験日なし」になる） */
function adminDeleteExamDate_(token, examId) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const e = readExamDates_().filter(function (x) { return x.examId === examId; })[0];
    if (!e) return { ok: false, message: 'この試験日は見つかりません。画面を読み込み直してください。' };
    getSheet_(SHEET_EXAM_DATES).deleteRow(e.row);
    return { ok: true, message: '試験日を削除しました。' };
  } finally {
    lock.releaseLock();
  }
}
