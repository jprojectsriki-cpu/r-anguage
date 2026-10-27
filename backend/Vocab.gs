/**
 * R-anguage API - 単語カードの管理
 * ※ LEVEL_LIST・Q_STATUS は Questions.gs のものを使う
 */

const SHEET_VOCAB = 'Vocab';
const V_HEADERS = ['カードID', 'レベル', '単語', '読み', '英語の意味', '例文', '例文の英訳', '状態', '作成日時', '更新日時'];
const V_COLS = V_HEADERS.length; // 10列（A〜J）

/**
 * 【1回だけ実行】Vocabシートを作り、見出し・プルダウン・書式を設定する
 * （すでにあるときは、見出しとプルダウンだけを設定し直す。入力済みのカードは消えない）
 */
function setupVocabSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_VOCAB);
  if (!sheet) sheet = ss.insertSheet(SHEET_VOCAB);

  sheet.getRange(1, 1, 1, V_COLS).setValues([V_HEADERS]).setFontWeight('bold').setBackground('#D9F7EE');
  sheet.setFrozenRows(1);

  const rows = sheet.getMaxRows() - 1;
  const list = function (values) {
    return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  };
  sheet.getRange(2, 2, rows, 1).setDataValidation(list(LEVEL_LIST)); // B レベル
  sheet.getRange(2, 8, rows, 1).setDataValidation(list(Q_STATUS));   // H 状態

  // 数字や日付に自動変換されないよう、A〜H列は「書式なしテキスト」にする
  sheet.getRange(2, 1, rows, 8).setNumberFormat('@');
  sheet.getRange(2, 1, rows, V_COLS).setWrap(true).setVerticalAlignment('top');

  [110, 60, 120, 120, 180, 280, 280, 70, 130, 130]
    .forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });

  Logger.log('Vocab シートを準備しました（' + V_COLS + '列）');
}

/** 1行をカードのオブジェクトにする */
function rowToCard_(r, rowNumber) {
  return {
    row: rowNumber,
    cardId: String(r[0] || '').trim(),
    level: String(r[1] || '').trim(),
    word: String(r[2] || '').trim(),
    reading: String(r[3] || '').trim(),
    meaning: String(r[4] || '').trim(),
    example: String(r[5] || ''),
    exampleEn: String(r[6] || ''),
    status: String(r[7] || '').trim(),
    createdAt: r[8] || null,
    updatedAt: r[9] || null
  };
}

/** カードの入力内容をチェックし、問題点の一覧を返す（問題なければ空の配列） */
function validateCard_(c) {
  const errors = [];
  if (LEVEL_LIST.indexOf(c.level) === -1) errors.push('レベルは N4／N3／N2／N1 のどれかにしてください。');
  if (!c.word) errors.push('単語を入力してください。');
  if (!c.reading) errors.push('読みを入力してください。');
  else if (!/^[ぁ-ゟ゠-ヿー・ 　]+$/.test(c.reading)) errors.push('読みは、ひらがな・カタカナで入力してください。');
  if (!c.meaning) errors.push('英語の意味を入力してください。');
  if (String(c.exampleEn || '').trim() && !String(c.example || '').trim()) errors.push('例文の英訳だけが入っています。例文も入力してください。');
  if (Q_STATUS.indexOf(c.status) === -1) errors.push('状態は「公開」か「下書き」にしてください。');
  return errors;
}

/** 新しいカードIDを作る（例：V20261027-K7Q2） */
function makeCardId_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 4; i++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'V' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd') + '-' + rand;
}

/** シートを読み込む。スプレッドシートで直接入力された行に、カードIDと作成日時を付ける */
function readCards_() {
  const sheet = getSheet_(SHEET_VOCAB);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, V_COLS).getValues();
  const now = new Date();
  values.forEach(function (r, i) {
    const hasContent = r.slice(1, 8).some(function (v) { return String(v).trim() !== ''; });
    if (hasContent && !String(r[0]).trim()) {
      r[0] = makeCardId_();
      if (!r[8]) r[8] = now;
      if (!r[9]) r[9] = now;
      sheet.getRange(i + 2, 1).setValue(r[0]);
      sheet.getRange(i + 2, 9, 1, 2).setValues([[r[8], r[9]]]);
    }
  });

  return values
    .map(function (r, i) { return rowToCard_(r, i + 2); })
    .filter(function (c) { return c.cardId; });
}

/** 同じレベルに、同じ単語・同じ読みのカードがあれば、そのカードIDを返す */
function findDuplicate_(cards, c) {
  const hit = cards.filter(function (x) {
    return x.cardId !== c.cardId && x.level === c.level && x.word === c.word && x.reading === c.reading;
  })[0];
  return hit ? hit.cardId : '';
}

/** 【管理者】カードの一覧（入力ミスは errors、重複は duplicateOf に入る） */
function adminListCards_(token) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cards = readCards_();
    const list = cards.map(function (c) {
      c.errors = validateCard_(c);
      c.duplicateOf = findDuplicate_(cards, c);
      delete c.row;
      return c;
    });
    return { ok: true, cards: list };
  } finally {
    lock.releaseLock();
  }
}

/** 【管理者】カードの保存（cardId がなければ新規、あれば更新） */
function adminSaveCard_(token, input) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;
  input = input || {};

  const c = {
    cardId: String(input.cardId || '').trim(),
    level: String(input.level || ''),
    word: String(input.word || '').trim().slice(0, 50),
    reading: String(input.reading || '').trim().slice(0, 100),
    meaning: String(input.meaning || '').trim().slice(0, 200),
    example: String(input.example || '').slice(0, 500),
    exampleEn: String(input.exampleEn || '').slice(0, 500),
    status: String(input.status || '')
  };
  const errors = validateCard_(c);
  if (errors.length) return { ok: false, message: errors.join('\n'), errors: errors };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_(SHEET_VOCAB);
    const cards = readCards_();
    const dup = findDuplicate_(cards, c);
    if (dup && !input.allowDuplicate) {
      return { ok: false, duplicate: dup, message: c.level + ' に同じ単語（' + c.word + '・' + c.reading + '）のカードがすでにあります（' + dup + '）。' };
    }

    const now = new Date();
    const values = [c.level, c.word, c.reading, c.meaning, c.example, c.exampleEn, c.status];

    if (c.cardId) {
      const found = cards.filter(function (x) { return x.cardId === c.cardId; })[0];
      if (!found) return { ok: false, message: 'カードが見つかりません。' };
      sheet.getRange(found.row, 2, 1, 7).setValues([values]);
      sheet.getRange(found.row, 10).setValue(now);
      return { ok: true, cardId: c.cardId, created: false };
    }

    const id = makeCardId_();
    sheet.appendRow([id].concat(values, [now, now]));
    return { ok: true, cardId: id, created: true };
  } finally {
    lock.releaseLock();
  }
}

/** 【管理者】カードの削除 */
function adminDeleteCard_(token, cardId) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const found = readCards_().filter(function (x) { return x.cardId === cardId; })[0];
    if (!found) return { ok: false, message: 'カードが見つかりません。' };
    getSheet_(SHEET_VOCAB).deleteRow(found.row);
    return { ok: true, cardId: cardId };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 【テスト用】単語カードの管理の動作確認（最後にテストのカードは削除される）
 * 事前に、スクリプト プロパティに TEST_PASSWORD（R-anguageの管理者パスワード）を入れておくこと
 */
function testVocab() {
  const props = PropertiesService.getScriptProperties();
  const password = props.getProperty('TEST_PASSWORD');
  if (!password) throw new Error('スクリプト プロパティに TEST_PASSWORD（R-anguageの管理者パスワード）を設定してください。');

  const admin = login_(props.getProperty('ADMIN_EMAIL'), password);
  if (!admin.ok) throw new Error('管理者のログインに失敗しました：' + admin.message + '（TEST_PASSWORD に R-anguageの管理者パスワードが入っているか確認してください）');

  const card = {
    level: 'N4', word: '約束', reading: 'やくそく', meaning: 'promise; appointment',
    example: '{友達|ともだち}との{約束|やくそく}を{守|まも}る。', exampleEn: 'I keep my promise with my friend.', status: '下書き'
  };

  // ① 管理画面から1枚作る
  const saved = adminSaveCard_(admin.token, card);
  Logger.log('① 新しく保存 → ' + JSON.stringify(saved));

  // ② 同じカードを「公開」に変更
  const updated = adminSaveCard_(admin.token, Object.assign({}, card, { cardId: saved.cardId, status: '公開' }));
  Logger.log('② 更新 → ' + JSON.stringify(updated));

  // ③ 同じ単語をもう1枚作ろうとすると止まる
  const dup = adminSaveCard_(admin.token, card);
  Logger.log('③ 重複 → ok:' + dup.ok + ' / ' + dup.message);

  // ④ スプレッドシートに直接1行入れる（カードIDは空欄）
  getSheet_(SHEET_VOCAB).appendRow(['', 'N3', '経験', 'けいけん', 'experience',
    '{海外|かいがい}で{働|はたら}いた{経験|けいけん}がある。', 'I have experience working abroad.', '公開', '', '']);

  // ⑤ 一覧を取得（④の行にカードIDが付く）
  const list = adminListCards_(admin.token);
  const mine = list.cards.filter(function (c) { return c.word === '約束' || c.word === '経験'; });
  Logger.log('⑤ 一覧 → 全' + list.cards.length + '枚 / テストのカード: ' +
    mine.map(function (c) { return c.cardId + '（' + c.level + '・' + c.word + '・' + c.status + '・ミス' + c.errors.length + '件）'; }).join('、'));

  // ⑥ 入力ミスのあるカードは保存できない
  const bad = adminSaveCard_(admin.token, { level: 'N5', word: '', reading: 'yakusoku', meaning: '', exampleEn: 'only english', status: '公開' });
  Logger.log('⑥ 入力ミス → ' + bad.errors.length + '件：' + bad.errors.join(' / '));

  // ⑦ テストのカードを削除
  mine.forEach(function (c) { Logger.log('⑦ 削除 → ' + JSON.stringify(adminDeleteCard_(admin.token, c.cardId))); });

  props.deleteProperty('TEST_PASSWORD');
  Logger.log('TEST_PASSWORD を削除しました');
}
