/**
 * R-ANGUAGE API - 問題・単語カードの「まとめて登録」（管理者）
 *
 * - 管理画面に、テンプレート（Excel・Googleスプレッドシート）の行を貼り付けて、まとめて登録する
 * - dryRun: true のときは、チェックだけして結果を返す（登録しない）
 * - 入力ミス（エラー）が1つでもあるときは、1行も登録しない（直して貼り付け直す）
 * - 注意（警告）だけのときは登録できる
 *     問題：「問題形式」が QuestionCounts の表にない（出題されない）
 * - 同じ問題・同じ単語（すでにある、または貼り付けた中で重なる）はエラー（2回登録するのをふせぐ）
 * - 「状態」が空のときは「下書き」にする
 */

const IMPORT_MAX = 500;

/** 全角の数字・空白をそろえる */
function importText_(v) {
  return String(v == null ? '' : v).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).trim();
}

function questionKey_(q) {
  return [q.level, q.section, q.form, String(q.passage || '').trim(), q.audio, String(q.question || '').trim()].join('\u0001');
}

/**
 * 問題のまとめて登録
 * rows: [[レベル, 科目, 問題形式, 本文, 音声ファイル, 問題文, 選択肢1, 選択肢2, 選択肢3, 選択肢4, 正解, 解説, 状態, STAGE], ...]
 *   （STAGE の列はなくてもよい。空なら EASY）
 */
function adminImportQuestions_(token, rows, dryRun) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;
  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) return { ok: false, message: '貼り付けた行がありません。' };
  if (rows.length > IMPORT_MAX) return { ok: false, message: '1回に登録できるのは ' + IMPORT_MAX + '行までです。分けて貼り付けてください。' };

  const counts = readQuestionCounts_();
  const existing = {};
  readQuestions_().forEach(function (q) { existing[questionKey_(q)] = q.questionId; });
  const seen = {};

  const items = rows.map(function (r, i) {
    r = Array.isArray(r) ? r : [];
    const q = {
      level: importText_(r[0]).toUpperCase(),
      section: importText_(r[1]),
      form: importText_(r[2]).slice(0, 50),
      passage: String(r[3] == null ? '' : r[3]).replace(/\r\n?/g, '\n').trim().slice(0, 5000),
      audio: importText_(r[4]).slice(0, 100),
      question: String(r[5] == null ? '' : r[5]).replace(/\r\n?/g, '\n').trim().slice(0, 2000),
      choices: [6, 7, 8, 9].map(function (k) { return String(r[k] == null ? '' : r[k]).trim().slice(0, 300); }),
      answer: importText_(r[10]),
      explanation: String(r[11] == null ? '' : r[11]).replace(/\r\n?/g, '\n').trim().slice(0, 3000),
      status: importText_(r[12]) || '下書き',
      stage: cleanStage_(importText_(r[13]))
    };
    const errors = validateQuestion_(q);
    const warnings = [];
    if (!q.form) errors.push('問題形式を入力してください。');
    else if (LEVEL_LIST.indexOf(q.level) >= 0 && SECTIONS.indexOf(q.section) >= 0 &&
      !counts.some(function (c) { return c.level === q.level && c.section === q.section && c.form === q.form; })) {
      warnings.push('「' + q.form + '」は ' + q.level + ' の' + q.section + 'の問題数の表（QuestionCounts）にありません。登録はできますが、出題されません。');
    }
    if (q.audio && !/\.(mp3|m4a|wav|ogg)$/i.test(q.audio)) warnings.push('音声ファイル名は「.mp3」などで終わる名前にしてください。');
    const key = questionKey_(q);
    if (existing[key]) errors.push('同じ問題がすでに登録されています（' + existing[key] + '）。');
    else if (seen[key]) errors.push('貼り付けた中の ' + seen[key] + '行目と同じ問題です。');
    seen[key] = seen[key] || (i + 1);
    return { row: i + 1, q: q, errors: errors, warnings: warnings };
  });

  return finishImport_(items, dryRun, function (list) {
    const sheet = getSheet_(SHEET_QUESTIONS);
    ensureStageHeader_(sheet);
    const now = new Date();
    const used = {};
    readQuestions_().forEach(function (q) { used[q.questionId] = true; });
    const values = list.map(function (it) {
      let id;
      do { id = makeQuestionId_(); } while (used[id]);
      used[id] = true;
      const q = it.q;
      return [id, q.level, q.section, q.form, q.passage, q.audio, q.question,
        q.choices[0], q.choices[1], q.choices[2], q.choices[3], q.answer, q.explanation, q.status, now, now, q.stage];
    });
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, values.length, 14).setNumberFormat('@');
    sheet.getRange(start, Q_COL_STAGE, values.length, 1).setNumberFormat('@');
    sheet.getRange(start, 1, values.length, Q_COLS).setValues(values);
  }, function (it) {
    return { level: it.q.level, section: it.q.section, form: it.q.form, text: it.q.question, audio: it.q.audio, status: it.q.status, stage: it.q.stage };
  });
}

/**
 * 単語カードのまとめて登録
 * rows: [[レベル, 単語, 読み, 英語の意味, 例文, 例文の英訳, 状態], ...]
 */
function adminImportCards_(token, rows, dryRun) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;
  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) return { ok: false, message: '貼り付けた行がありません。' };
  if (rows.length > IMPORT_MAX) return { ok: false, message: '1回に登録できるのは ' + IMPORT_MAX + '行までです。分けて貼り付けてください。' };

  const cards = readCards_();
  const seen = {};
  const items = rows.map(function (r, i) {
    r = Array.isArray(r) ? r : [];
    const c = {
      cardId: '',
      level: importText_(r[0]).toUpperCase(),
      word: importText_(r[1]).slice(0, 100),
      reading: importText_(r[2]).slice(0, 100),
      meaning: String(r[3] == null ? '' : r[3]).trim().slice(0, 300),
      example: String(r[4] == null ? '' : r[4]).trim().slice(0, 500),
      exampleEn: String(r[5] == null ? '' : r[5]).trim().slice(0, 500),
      status: importText_(r[6]) || '下書き'
    };
    const errors = validateCard_(c);
    const dup = findDuplicate_(cards, c);
    const key = c.level + '\u0001' + c.word + '\u0001' + c.reading;
    if (dup) errors.push('同じレベル・同じ単語・同じ読みのカードがすでにあります（' + dup + '）。別の意味は、そのカードの英語の意味に「;」で足してください。');
    else if (seen[key]) errors.push('貼り付けた中の ' + seen[key] + '行目と同じ単語です。');
    seen[key] = seen[key] || (i + 1);
    return { row: i + 1, c: c, errors: errors, warnings: [] };
  });

  return finishImport_(items, dryRun, function (list) {
    const sheet = getSheet_(SHEET_VOCAB);
    const now = new Date();
    const used = {};
    cards.forEach(function (c) { used[c.cardId] = true; });
    const values = list.map(function (it) {
      let id;
      do { id = makeCardId_(); } while (used[id]);
      used[id] = true;
      const c = it.c;
      return [id, c.level, c.word, c.reading, c.meaning, c.example, c.exampleEn, c.status, now, now];
    });
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, values.length, 8).setNumberFormat('@');
    sheet.getRange(start, 1, values.length, V_COLS).setValues(values);
  }, function (it) {
    return { level: it.c.level, word: it.c.word, reading: it.c.reading, text: it.c.meaning, status: it.c.status };
  });
}

/** チェックの結果をまとめ、エラーがなければ（dryRun でなければ）登録する */
function finishImport_(items, dryRun, write, summary) {
  const errorRows = items.filter(function (it) { return it.errors.length; }).length;
  const warnRows = items.filter(function (it) { return it.warnings.length; }).length;
  const result = {
    ok: true,
    total: items.length,
    errorRows: errorRows,
    warnRows: warnRows,
    rows: items.map(function (it) { return Object.assign({ row: it.row, errors: it.errors, warnings: it.warnings }, summary(it)); }),
    saved: 0
  };
  if (dryRun || errorRows) return result;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    write(items);
  } finally {
    lock.releaseLock();
  }
  result.saved = items.length;
  return result;
}

/* =========================================================
 * まとめて公開・まとめて下書きに（管理画面の「問題」「単語カード」）
 * ids: 変える問題ID／カードIDの一覧、status: '公開' か '下書き'
 * 公開にするのは、入力ミスのないものだけ（ミスがあるものは skipped に入る）
 * ========================================================= */
function adminSetQuestionsStatus_(token, ids, status) {
  return setStatusBulk_(token, ids, status, {
    sheet: SHEET_QUESTIONS, statusCol: 14, updatedCol: 16,
    read: readQuestions_, id: function (x) { return x.questionId; }, check: validateQuestion_
  });
}
function adminSetCardsStatus_(token, ids, status) {
  return setStatusBulk_(token, ids, status, {
    sheet: SHEET_VOCAB, statusCol: 8, updatedCol: 10,
    read: readCards_, id: function (x) { return x.cardId; }, check: validateCard_
  });
}

function setStatusBulk_(token, ids, status, o) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;
  status = String(status || '');
  if (Q_STATUS.indexOf(status) === -1) return { ok: false, message: '状態は「公開」か「下書き」にしてください。' };
  const want = {};
  (Array.isArray(ids) ? ids : []).slice(0, 2000).forEach(function (id) { want[String(id)] = true; });
  if (!Object.keys(want).length) return { ok: false, message: '変えるものが選ばれていません。' };

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const list = o.read();
    const sheet = getSheet_(o.sheet);
    const last = sheet.getLastRow();
    if (last < 2) return { ok: true, changed: 0, skipped: [] };
    const statusRange = sheet.getRange(2, o.statusCol, last - 1, 1);
    const updatedRange = sheet.getRange(2, o.updatedCol, last - 1, 1);
    const statusVals = statusRange.getValues();
    const updatedVals = updatedRange.getValues();
    const now = new Date();
    let changed = 0;
    const skipped = [];
    list.forEach(function (x) {
      const id = o.id(x);
      if (!want[id] || x.status === status) return;
      if (status === '公開') {
        const errs = o.check(Object.assign({}, x, { status: '公開' }));
        if (errs.length) { skipped.push(id); return; }
      }
      statusVals[x.row - 2][0] = status;
      updatedVals[x.row - 2][0] = now;
      changed++;
    });
    if (changed) {
      statusRange.setValues(statusVals);
      updatedRange.setValues(updatedVals);
    }
    return { ok: true, changed: changed, skipped: skipped };
  } finally {
    lock.releaseLock();
  }
}
