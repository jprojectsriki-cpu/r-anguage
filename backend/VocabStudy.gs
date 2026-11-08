/**
 * R-ANGUAGE API - 受講生の「単語カード」（R-10c）
 *
 * - VocabProgress シート：受講生ごと・カードごとに「覚えた／まだ」を1行で持つ（同じカードは上書き）
 * - 1回に出すカードは 30枚まで（VOCAB_PER_ROUND）
 * - 出し方
 *     new   … まだ覚えていないカード（「まだ」を押したカードを先に、次に一度も見ていないカード）
 *     all   … すべてのカード（ランダム）
 *     known … 覚えたカードの見直し（覚えたのが古い順）
 *     retry … 指定したカードをもう一度（結果の画面の「まだのカードをもう一度」）
 * - 管理者のアカウントは、すべてのレベルを使える（画面の確認用。記録は残る）
 */

const SHEET_VOCAB_PROGRESS = 'VocabProgress';
const VP_HEADERS = ['userId', 'カードID', 'レベル', '状態', '覚えた回数', 'まだの回数', '更新日時'];
const VOCAB_PER_ROUND = 30;
const VOCAB_MODES = ['new', 'all', 'known', 'retry'];

/** 【1回だけ実行】VocabProgress シートを用意する */
function setupVocabStudy() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_VOCAB_PROGRESS);
  if (!sh) sh = ss.insertSheet(SHEET_VOCAB_PROGRESS);
  sh.getRange(1, 1, 1, VP_HEADERS.length).setValues([VP_HEADERS]).setFontWeight('bold').setBackground('#D9F7EE');
  sh.setFrozenRows(1);
  Logger.log('VocabProgress シートを用意しました');
}

/** 受講生に出せるカード（公開・入力ミスなし）だけ */
function readPublicCards_() {
  return readCards_().filter(function (c) { return c.status === '公開' && validateCard_(c).length === 0; });
}

/** この受講生の記録 { cardId: { row, state, known, still, at } } */
function readMyVocab_(userId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_VOCAB_PROGRESS);
  const map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, VP_HEADERS.length).getValues().forEach(function (r, i) {
    if (String(r[0]) !== userId) return;
    map[String(r[1])] = { row: i + 2, state: String(r[3]), known: Number(r[4]) || 0, still: Number(r[5]) || 0, at: r[6] instanceof Date ? r[6].getTime() : 0 };
  });
  return map;
}

function toClientCard_(c, p) {
  return {
    cardId: c.cardId, level: c.level, word: c.word, reading: c.reading, meaning: c.meaning,
    example: c.example, exampleEn: c.exampleEn, state: p ? p.state : ''
  };
}

/** 単語カードのメニュー：レベルごとの枚数 { level, total, known, still, fresh } */
function meVocabMenu_(token) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  const levels = practiceLevels_(me.user);
  const cards = readPublicCards_();
  const mine = readMyVocab_(me.user.userId);
  return {
    ok: true,
    isAdmin: me.user.role === 'admin',
    perRound: VOCAB_PER_ROUND,
    levels: levels.map(function (lv) {
      const list = cards.filter(function (c) { return c.level === lv; });
      const known = list.filter(function (c) { return mine[c.cardId] && mine[c.cardId].state === '覚えた'; }).length;
      const still = list.filter(function (c) { return mine[c.cardId] && mine[c.cardId].state === 'まだ'; }).length;
      return { level: lv, total: list.length, known: known, still: still, fresh: list.length - known - still };
    })
  };
}

/** カードを始める（30枚まで） */
function meVocabStart_(token, input) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  input = input || {};
  const mode = String(input.mode || '');
  const level = String(input.level || '');
  if (VOCAB_MODES.indexOf(mode) === -1) return { ok: false, message: '出し方が正しくありません。' };
  if (practiceLevels_(me.user).indexOf(level) === -1) return { ok: false, message: 'このレベルは、まだ使えません。マイページから追加できます。' };

  const cards = readPublicCards_().filter(function (c) { return c.level === level; });
  const mine = readMyVocab_(me.user.userId);
  let list;
  if (mode === 'new') {
    const still = cards.filter(function (c) { return mine[c.cardId] && mine[c.cardId].state === 'まだ'; })
      .sort(function (a, b) { return mine[a.cardId].at - mine[b.cardId].at; });
    const fresh = shuffle_(cards.filter(function (c) { return !mine[c.cardId]; }));
    list = still.concat(fresh);
  } else if (mode === 'known') {
    list = cards.filter(function (c) { return mine[c.cardId] && mine[c.cardId].state === '覚えた'; })
      .sort(function (a, b) { return mine[a.cardId].at - mine[b.cardId].at; });
  } else if (mode === 'all') {
    list = shuffle_(cards.slice());
  } else {
    const byId = {};
    cards.forEach(function (c) { byId[c.cardId] = c; });
    list = (Array.isArray(input.ids) ? input.ids : []).map(function (id) { return byId[String(id)]; }).filter(Boolean);
  }
  list = list.slice(0, VOCAB_PER_ROUND);
  if (!list.length) {
    return { ok: false, message: mode === 'new' ? 'まだ覚えていないカードはありません。' : mode === 'known' ? '覚えたカードはまだありません。' : 'このレベルのカードは、まだ登録されていません。' };
  }
  return { ok: true, mode: mode, level: level, cards: list.map(function (c) { return toClientCard_(c, mine[c.cardId]); }) };
}

/**
 * 覚えた／まだ を記録する（まとめて送ってよい）
 * marks: [{ cardId, known: true|false }]（同じカードが何回あっても、最後のものが状態になる）
 */
function meVocabMark_(token, input) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  const marks = (input && Array.isArray(input.marks) ? input.marks : []).slice(0, 100);
  if (!marks.length) return { ok: true, saved: 0 };
  const levels = practiceLevels_(me.user);
  const byId = {};
  readPublicCards_().forEach(function (c) { byId[c.cardId] = c; });
  const now = new Date();

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let saved = 0;
  try {
    const sheet = getSheet_(SHEET_VOCAB_PROGRESS);
    const mine = readMyVocab_(me.user.userId);
    const appends = [];
    const pending = {}; // まだシートにない行（同じ回に2回押したとき用）
    marks.forEach(function (m) {
      const c = byId[String(m.cardId)];
      if (!c || levels.indexOf(c.level) === -1) return;
      const known = m.known === true;
      const state = known ? '覚えた' : 'まだ';
      const p = mine[c.cardId];
      if (p) {
        p.state = state;
        if (known) p.known++; else p.still++;
        sheet.getRange(p.row, 4, 1, 4).setValues([[state, p.known, p.still, now]]);
      } else if (pending[c.cardId]) {
        const row = pending[c.cardId];
        row[3] = state;
        if (known) row[4]++; else row[5]++;
      } else {
        const row = [me.user.userId, c.cardId, c.level, state, known ? 1 : 0, known ? 0 : 1, now];
        pending[c.cardId] = row;
        appends.push(row);
      }
      saved++;
    });
    if (appends.length) sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, VP_HEADERS.length).setValues(appends);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, saved: saved };
}
