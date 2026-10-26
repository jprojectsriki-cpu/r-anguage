/**
 * R-anguage API - 問題の管理
 */

const SHEET_QUESTIONS = 'Questions';
const Q_HEADERS = ['問題ID', 'レベル', '科目', '問題形式', '本文', '音声ファイル', '問題文',
  '選択肢1', '選択肢2', '選択肢3', '選択肢4', '正解', '解説', '状態', '作成日時', '更新日時'];
const Q_COLS = Q_HEADERS.length; // 16列（A〜P）
const LEVEL_LIST = ['N4', 'N3', 'N2', 'N1'];
const SECTIONS = ['文字・語彙', '文法', '読解', '聴解'];
const Q_STATUS = ['公開', '下書き'];

/**
 * 【1回だけ実行】Questionsシートを作り、見出し・プルダウン・書式を設定する
 * （すでにあるときは、見出しとプルダウンだけを設定し直す。入力済みの問題は消えない）
 */
function setupQuestionsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_QUESTIONS);
  if (!sheet) sheet = ss.insertSheet(SHEET_QUESTIONS);

  sheet.getRange(1, 1, 1, Q_COLS).setValues([Q_HEADERS]).setFontWeight('bold').setBackground('#FFF3CF');
  sheet.setFrozenRows(1);

  const rows = sheet.getMaxRows() - 1;
  const list = function (values) {
    return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  };
  sheet.getRange(2, 2, rows, 1).setDataValidation(list(LEVEL_LIST));         // B レベル
  sheet.getRange(2, 3, rows, 1).setDataValidation(list(SECTIONS));           // C 科目
  sheet.getRange(2, 12, rows, 1).setDataValidation(list(['1', '2', '3', '4'])); // L 正解
  sheet.getRange(2, 14, rows, 1).setDataValidation(list(Q_STATUS));          // N 状態

  // 数字や日付に自動変換されないよう、A〜N列は「書式なしテキスト」にする
  sheet.getRange(2, 1, rows, 14).setNumberFormat('@');
  sheet.getRange(2, 1, rows, Q_COLS).setWrap(true).setVerticalAlignment('top');

  [110, 60, 90, 100, 260, 120, 260, 120, 120, 120, 120, 50, 260, 70, 130, 130]
    .forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });

  Logger.log('Questions シートを準備しました（' + Q_COLS + '列）');
}

/** 1行を問題のオブジェクトにする */
function rowToQuestion_(r, rowNumber) {
  return {
    row: rowNumber,
    questionId: String(r[0] || '').trim(),
    level: String(r[1] || '').trim(),
    section: String(r[2] || '').trim(),
    form: String(r[3] || ''),
    passage: String(r[4] || ''),
    audio: String(r[5] || '').trim(),
    question: String(r[6] || ''),
    choices: [String(r[7] || ''), String(r[8] || ''), String(r[9] || ''), String(r[10] || '')],
    answer: String(r[11] || '').trim(),
    explanation: String(r[12] || ''),
    status: String(r[13] || '').trim(),
    createdAt: r[14] || null,
    updatedAt: r[15] || null
  };
}

/** 問題の入力内容をチェックし、問題点の一覧を返す（問題なければ空の配列） */
function validateQuestion_(q) {
  const errors = [];
  if (LEVEL_LIST.indexOf(q.level) === -1) errors.push('レベルは N4／N3／N2／N1 のどれかにしてください。');
  if (SECTIONS.indexOf(q.section) === -1) errors.push('科目は 文字・語彙／文法／読解／聴解 のどれかにしてください。');
  if (!String(q.question || '').trim()) errors.push('問題文を入力してください。');
  (q.choices || []).forEach(function (c, i) {
    if (!String(c || '').trim()) errors.push('選択肢' + (i + 1) + 'を入力してください。');
  });
  if (['1', '2', '3', '4'].indexOf(String(q.answer)) === -1) errors.push('正解は 1〜4 のどれかにしてください。');
  if (Q_STATUS.indexOf(q.status) === -1) errors.push('状態は「公開」か「下書き」にしてください。');
  if (q.section === '読解' && !String(q.passage || '').trim()) errors.push('読解の問題には本文を入力してください。');
  if (q.section === '聴解' && !String(q.audio || '').trim()) errors.push('聴解の問題には音声ファイル名を入力してください。');
  return errors;
}

/** 新しい問題IDを作る（例：Q20261026-K7Q2） */
function makeQuestionId_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 4; i++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'Q' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd') + '-' + rand;
}

/** シートを読み込む。スプレッドシートで直接入力された行に、問題IDと作成日時を付ける */
function readQuestions_() {
  const sheet = getSheet_(SHEET_QUESTIONS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, Q_COLS).getValues();
  const now = new Date();
  values.forEach(function (r, i) {
    const hasContent = r.slice(1, 14).some(function (v) { return String(v).trim() !== ''; });
    if (hasContent && !String(r[0]).trim()) {
      r[0] = makeQuestionId_();
      if (!r[14]) r[14] = now;
      if (!r[15]) r[15] = now;
      sheet.getRange(i + 2, 1).setValue(r[0]);
      sheet.getRange(i + 2, 15, 1, 2).setValues([[r[14], r[15]]]);
    }
  });

  return values
    .map(function (r, i) { return rowToQuestion_(r, i + 2); })
    .filter(function (q) { return q.questionId; });
}

/** 【管理者】問題の一覧（入力ミスがあれば errors に入る） */
function adminListQuestions_(token) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const list = readQuestions_().map(function (q) {
      q.errors = validateQuestion_(q);
      delete q.row;
      return q;
    });
    return { ok: true, questions: list };
  } finally {
    lock.releaseLock();
  }
}

/** 【管理者】問題の保存（questionId がなければ新規、あれば更新） */
function adminSaveQuestion_(token, input) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;

  const q = {
    questionId: String((input && input.questionId) || '').trim(),
    level: String(input.level || ''),
    section: String(input.section || ''),
    form: String(input.form || '').slice(0, 50),
    passage: String(input.passage || '').slice(0, 5000),
    audio: String(input.audio || '').trim().slice(0, 100),
    question: String(input.question || '').slice(0, 2000),
    choices: [0, 1, 2, 3].map(function (i) { return String((input.choices || [])[i] || '').slice(0, 300); }),
    answer: String(input.answer || ''),
    explanation: String(input.explanation || '').slice(0, 3000),
    status: String(input.status || '')
  };
  const errors = validateQuestion_(q);
  if (errors.length) return { ok: false, message: errors.join('\n'), errors: errors };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_(SHEET_QUESTIONS);
    const now = new Date();
    const values = [q.level, q.section, q.form, q.passage, q.audio, q.question,
      q.choices[0], q.choices[1], q.choices[2], q.choices[3], q.answer, q.explanation, q.status];

    if (q.questionId) {
      const found = readQuestions_().filter(function (x) { return x.questionId === q.questionId; })[0];
      if (!found) return { ok: false, message: '問題が見つかりません。' };
      sheet.getRange(found.row, 2, 1, 13).setValues([values]);
      sheet.getRange(found.row, 16).setValue(now);
      return { ok: true, questionId: q.questionId, created: false };
    }

    const id = makeQuestionId_();
    sheet.appendRow([id].concat(values, [now, now]));
    return { ok: true, questionId: id, created: true };
  } finally {
    lock.releaseLock();
  }
}

/** 【管理者】問題の削除 */
function adminDeleteQuestion_(token, questionId) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const found = readQuestions_().filter(function (x) { return x.questionId === questionId; })[0];
    if (!found) return { ok: false, message: '問題が見つかりません。' };
    getSheet_(SHEET_QUESTIONS).deleteRow(found.row);
    return { ok: true, questionId: questionId };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 【テスト用】問題の管理の動作確認（最後にテストの問題は削除される）
 * 事前に、スクリプト プロパティに TEST_PASSWORD（R-anguageの管理者パスワード）を入れておくこと
 */
function testQuestions() {
  const props = PropertiesService.getScriptProperties();
  const password = props.getProperty('TEST_PASSWORD');
  if (!password) throw new Error('スクリプト プロパティに TEST_PASSWORD（R-anguageの管理者パスワード）を設定してください。');

  const admin = login_(props.getProperty('ADMIN_EMAIL'), password);
  if (!admin.ok) throw new Error('管理者のログインに失敗しました：' + admin.message + '（TEST_PASSWORD に R-anguageの管理者パスワードが入っているか確認してください）');

  // ① 管理画面から1問作る（文法）
  const saved = adminSaveQuestion_(admin.token, {
    level: 'N3', section: '文法', form: '文法形式の判断',
    question: '{日本|にほん}に{来|き}た（　　）、{日本語|にほんご}が{話|はな}せるようになりたい。',
    choices: ['ばかりに', 'からには', 'とたんに', 'ものの'], answer: '2',
    explanation: '「〜からには」は「〜のだから、{当然|とうぜん}」という{意味|いみ}です。', status: '下書き'
  });
  Logger.log('① 新しく保存 → ' + JSON.stringify(saved));

  // ② 同じ問題を「公開」に変更
  const updated = adminSaveQuestion_(admin.token, {
    questionId: saved.questionId, level: 'N3', section: '文法', form: '文法形式の判断',
    question: '{日本|にほん}に{来|き}た（　　）、{日本語|にほんご}が{話|はな}せるようになりたい。',
    choices: ['ばかりに', 'からには', 'とたんに', 'ものの'], answer: '2',
    explanation: '「〜からには」は「〜のだから、{当然|とうぜん}」という{意味|いみ}です。', status: '公開'
  });
  Logger.log('② 更新 → ' + JSON.stringify(updated));

  // ③ スプレッドシートに直接1行入れる（問題IDは空欄）
  getSheet_(SHEET_QUESTIONS).appendRow(['', 'N4', '文字・語彙', '漢字読み', '', '',
    '{友達|ともだち}との 約束 を{守|まも}る。', 'やくそく', 'やくぞく', 'よくそく', 'よくぞく', '1',
    '「約束」は「やくそく」と{読|よ}みます。', '公開', '', '']);

  // ④ 一覧を取得（③の行に問題IDが付く）
  const list = adminListQuestions_(admin.token);
  const mine = list.questions.filter(function (q) { return q.form === '文法形式の判断' || q.form === '漢字読み'; });
  Logger.log('④ 一覧 → 全' + list.questions.length + '問 / テストの問題: ' +
    mine.map(function (q) { return q.questionId + '（' + q.level + '・' + q.section + '・' + q.status + '・ミス' + q.errors.length + '件）'; }).join('、'));

  // ⑤ 入力ミスのある問題は保存できない
  const bad = adminSaveQuestion_(admin.token, { level: 'N5', section: '聴解', question: '', choices: ['a', '', 'c', 'd'], answer: '5', status: '公開' });
  Logger.log('⑤ 入力ミス → ' + bad.errors.length + '件：' + bad.errors.join(' / '));

  // ⑥ テストの問題を削除
  mine.forEach(function (q) { Logger.log('⑥ 削除 → ' + JSON.stringify(adminDeleteQuestion_(admin.token, q.questionId))); });

  props.deleteProperty('TEST_PASSWORD');
  Logger.log('TEST_PASSWORD を削除しました');
}