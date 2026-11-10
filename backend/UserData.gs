/**
 * R-ANGUAGE API - 受講生ごとのまとめ（受講生が増えても遅くならないしくみ）
 *
 * 前は、ホームの学習記録や「まだ解いていない問題を先に出す」たびに、Answers・VocabProgress シートを
 * ぜんぶ読んでいた。受講生が増えると行が何十万にもなって遅くなるので、受講生1人ぶんのまとめを
 * UserData シートに持ち、その行だけを読むようにする。
 *
 * - UserData シート：1人につき3行（A列のキーで探す）
 *     A キー（userId|ans・userId|voc・userId|sum） / B 更新日時 / C 使っている列の数 / D列〜 データ（JSON）
 *     ※ 1つのセルには 5万文字までしか入らないので、45,000文字ずつ D・E・F… の列に分けて入れる
 *   ans … 問題ごとの最後の答え         { 問題ID: [最後に答えた時刻（秒）, 正解なら1] }
 *   voc … 単語カードごとの記録         { カードID: [覚えたなら1, 覚えた回数, まだの回数, 時刻（秒）] }
 *   sum … 学習記録                    { days: {日付: 回数}, sec: {科目: [答えた数, 正解数]}, tot: [答えた数, 正解数],
 *                                       lp: 前回の問題, lm: 最後の模試,
 *                                       lv: {レベル: { sec: {...}, tot: [...] }}, lmv: {レベル: そのレベルの最後の模試} }
 * - 回答の記録（1問1行）は、月ごとの別のスプレッドシート「R-ANGUAGE 回答の記録 YYYY-MM」に書く
 *   （本体のスプレッドシートが大きくならないように。ファイルはマイドライブに自動で作られる）
 *
 * 【1回だけ実行】setupUserData … UserData シートを作り、今までの Answers・VocabProgress・MockResults から
 *                                 まとめを作る（何回実行しても、同じ結果に作り直すだけ）
 */

const SHEET_USER_DATA = 'UserData';
const UD_HEADERS = ['キー', '更新日時', '列の数', 'データ'];
const UD_CHUNK = 45000;
const UD_MAX_COLS = 40;
const UD_KEEP_DAYS = 400; // 学習した日の記録を残す日数

function udSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_USER_DATA);
  if (!sh) {
    sh = ss.insertSheet(SHEET_USER_DATA);
    sh.getRange(1, 1, 1, UD_HEADERS.length).setValues([UD_HEADERS]).setFontWeight('bold').setBackground('#E8E0FF');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** キーの行番号（なければ 0）。見つけた行はしばらく覚えておく */
function udFindRow_(sh, key) {
  const cache = CacheService.getScriptCache();
  const last = sh.getLastRow();
  const c = Number(cache.get('udrow:' + key) || 0);
  if (c >= 2 && c <= last && String(sh.getRange(c, 1).getValue()) === key) return c;
  if (last < 2) return 0;
  const hit = sh.getRange(2, 1, last - 1, 1).createTextFinder(key).matchEntireCell(true).findNext();
  if (!hit) return 0;
  cache.put('udrow:' + key, String(hit.getRow()), 21600);
  return hit.getRow();
}

function udRead_(key, fallback) {
  const sh = udSheet_();
  const row = udFindRow_(sh, key);
  if (!row) return fallback;
  const n = Number(sh.getRange(row, 3).getValue()) || 0;
  if (!n) return fallback;
  const text = sh.getRange(row, 4, 1, n).getValues()[0].map(String).join('');
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('UserData を読めませんでした：' + key);
    return fallback;
  }
}

/** 書きこむ（呼ぶ側でロックを取っておく） */
function udWrite_(key, obj) {
  const sh = udSheet_();
  const s = JSON.stringify(obj);
  const parts = [];
  for (let i = 0; i < s.length; i += UD_CHUNK) parts.push(s.slice(i, i + UD_CHUNK));
  if (!parts.length) parts.push('{}');
  if (parts.length > UD_MAX_COLS) throw new Error('UserData が大きすぎます：' + key);
  let row = udFindRow_(sh, key);
  let old = 0;
  if (row) old = Number(sh.getRange(row, 3).getValue()) || 0;
  else {
    row = sh.getLastRow() + 1;
    CacheService.getScriptCache().put('udrow:' + key, String(row), 21600);
  }
  const width = Math.max(parts.length, old);
  const vals = parts.slice();
  while (vals.length < width) vals.push('');
  // 文字のまま入れる（数字や日付に変わらないように）
  sh.getRange(row, 4, 1, width).setNumberFormat('@');
  sh.getRange(row, 1, 1, 3 + width).setValues([[key, new Date(), parts.length].concat(vals)]);
}

function udAns_(uid) { return udRead_(uid + '|ans', {}); }
function udVoc_(uid) { return udRead_(uid + '|voc', {}); }
function udSum_(uid) {
  const s = udRead_(uid + '|sum', null) || {};
  return { days: s.days || {}, sec: s.sec || {}, tot: s.tot || [0, 0], lp: s.lp || null, lm: s.lm || null, lv: s.lv || {}, lmv: s.lmv || {} };
}

/** 学習した日に数を足す（古い日は消す） */
function udMarkDay_(sum, d, n) {
  const k = jstDay_(d);
  sum.days[k] = (sum.days[k] || 0) + (n || 1);
  const keys = Object.keys(sum.days).sort();
  while (keys.length > UD_KEEP_DAYS) delete sum.days[keys.shift()];
}

/**
 * 答えをまとめに入れる（ロックの中で呼ぶ）
 * items: [{ questionId, level, section, form, correct }], mode: set／form／mistakes／favorites／retry／mock
 */
function udAddAnswers_(uid, items, mode, now, ans, sum) {
  const t = Math.floor(now.getTime() / 1000);
  items.forEach(function (it) {
    delete ans[it.questionId]; // 入れ直して、答えた順に並べる
    ans[it.questionId] = [t, it.correct ? 1 : 0];
    const s = sum.sec[it.section] || [0, 0];
    s[0]++;
    if (it.correct) s[1]++;
    sum.sec[it.section] = s;
    sum.tot[0]++;
    if (it.correct) sum.tot[1]++;
    // レベルごと
    if (!sum.lv) sum.lv = {};
    const L = sum.lv[it.level] || (sum.lv[it.level] = { sec: {}, tot: [0, 0] });
    const ls = L.sec[it.section] || [0, 0];
    ls[0]++;
    if (it.correct) ls[1]++;
    L.sec[it.section] = ls;
    L.tot[0]++;
    if (it.correct) L.tot[1]++;
    if (mode === 'set' || mode === 'form') sum.lp = { mode: mode, level: it.level, section: it.section, form: it.form };
  });
  if (items.length) udMarkDay_(sum, now, items.length);
}

/** 問題ごとに最後に答えた時刻 { 問題ID: ミリ秒 } */
function lastAnsweredMap_(userId) {
  const ans = udAns_(userId);
  const map = {};
  Object.keys(ans).forEach(function (id) { map[id] = (Number(ans[id][0]) || 0) * 1000; });
  return map;
}

/** まちがい復習の問題ID（いちばん新しい答えが不正解のもの。まちがえた順） */
function mistakeIdsOf_(ans) {
  return Object.keys(ans)
    .filter(function (id) { return Number(ans[id][1]) !== 1; })
    .sort(function (a, b) { return (Number(ans[a][0]) || 0) - (Number(ans[b][0]) || 0); });
}

/** 回答の記録を、月ごとのスプレッドシートに書く（失敗しても、まとめの保存は止めない） */
function writeAnswerLog_(rows, now) {
  if (!rows.length) return;
  try {
    const ym = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM');
    const props = PropertiesService.getScriptProperties();
    const key = 'ANSWER_LOG_' + ym;
    let ss = null;
    const id = props.getProperty(key);
    if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
    if (!ss) {
      ss = SpreadsheetApp.create('R-ANGUAGE 回答の記録 ' + ym);
      const first = ss.getSheets()[0];
      first.setName(SHEET_ANSWERS);
      first.getRange(1, 1, 1, ANS_HEADERS.length).setValues([ANS_HEADERS]).setFontWeight('bold');
      first.setFrozenRows(1);
      props.setProperty(key, ss.getId());
    }
    const sh = ss.getSheetByName(SHEET_ANSWERS) || ss.getSheets()[0];
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, ANS_HEADERS.length).setValues(rows);
  } catch (e) {
    console.error('回答の記録を書けませんでした：' + e);
  }
}

/* =========================================================
 * 【1回だけ実行】今までの記録からまとめを作る
 * ========================================================= */
function setupUserData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  udSheet_();
  const users = {};
  function u(uid) {
    if (!users[uid]) users[uid] = { ans: {}, voc: {}, sum: { days: {}, sec: {}, tot: [0, 0], lp: null, lm: null, lv: {}, lmv: {} } };
    return users[uid];
  }

  // 問題の答え（古い順）
  const ans = ss.getSheetByName(SHEET_ANSWERS);
  let nAns = 0;
  if (ans && ans.getLastRow() >= 2) {
    const rows = ans.getRange(2, 1, ans.getLastRow() - 1, ANS_HEADERS.length).getValues();
    rows.sort(function (a, b) { return (a[7] instanceof Date ? a[7].getTime() : 0) - (b[7] instanceof Date ? b[7].getTime() : 0); });
    rows.forEach(function (r) {
      const uid = String(r[0]);
      if (!uid) return;
      const at = r[7] instanceof Date ? r[7] : new Date(0);
      const x = u(uid);
      udAddAnswers_(uid, [{
        questionId: String(r[1]), level: String(r[2]), section: String(r[3]), form: String(r[4]),
        correct: r[6] === true || String(r[6]).toUpperCase() === 'TRUE'
      }], String(r[8]), at, x.ans, x.sum);
      nAns++;
    });
  }

  // 単語カード
  const vp = ss.getSheetByName(SHEET_VOCAB_PROGRESS);
  let nVoc = 0;
  if (vp && vp.getLastRow() >= 2) {
    vp.getRange(2, 1, vp.getLastRow() - 1, VP_HEADERS.length).getValues().forEach(function (r) {
      const uid = String(r[0]);
      if (!uid) return;
      const at = r[6] instanceof Date ? r[6] : new Date(0);
      const x = u(uid);
      x.voc[String(r[1])] = [String(r[3]) === '覚えた' ? 1 : 0, Number(r[4]) || 0, Number(r[5]) || 0, Math.floor(at.getTime() / 1000)];
      if (r[6] instanceof Date) udMarkDay_(x.sum, at, 1);
      nVoc++;
    });
  }

  // 模試（最後の模試と、受けた日）
  const mr = ss.getSheetByName(SHEET_MOCK_RESULTS);
  if (mr && mr.getLastRow() >= 2) {
    mr.getRange(2, 1, mr.getLastRow() - 1, 7).getValues().forEach(function (r) {
      const uid = String(r[1]);
      if (!uid || !(r[3] instanceof Date)) return;
      const x = u(uid);
      udMarkDay_(x.sum, r[3], 1);
      const m = { level: String(r[2]), total: Number(r[4]), result: String(r[6]), at: r[3].toISOString() };
      if (!x.sum.lm || new Date(x.sum.lm.at).getTime() < r[3].getTime()) x.sum.lm = m;
      const lvm = x.sum.lmv[m.level];
      if (!lvm || new Date(lvm.at).getTime() < r[3].getTime()) x.sum.lmv[m.level] = m;
    });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    Object.keys(users).forEach(function (uid) {
      const x = users[uid];
      udWrite_(uid + '|ans', x.ans);
      udWrite_(uid + '|voc', x.voc);
      udWrite_(uid + '|sum', x.sum);
    });
  } finally {
    lock.releaseLock();
  }
  Logger.log('UserData を作りました：受講生 ' + Object.keys(users).length + '人・答え ' + nAns + '件・単語カード ' + nVoc + '件');
}

/* =========================================================
 * 【1回だけ実行】レベルごとの正答率・最後の模試を、今までの記録から作る（2026-11 追加）
 *   今までの記録 ＝ 本体の Answers シート（UserData に切りかえる前）＋ 月ごとの「回答の記録」
 *   ほかのまとめ（まちがい復習・単語カード・連続日数）は変えない。何回実行しても同じ結果になる
 * ========================================================= */
function setupLevelStats() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lv = {};   // uid → { レベル: { sec, tot } }
  const lmv = {};  // uid → { レベル: 最後の模試 }
  let n = 0;
  function addRows(rows) {
    rows.forEach(function (r) {
      const uid = String(r[0]);
      if (!uid) return;
      const level = String(r[2]), section = String(r[3]);
      const ok = r[6] === true || String(r[6]).toUpperCase() === 'TRUE';
      const u = lv[uid] || (lv[uid] = {});
      const L = u[level] || (u[level] = { sec: {}, tot: [0, 0] });
      const s = L.sec[section] || [0, 0];
      s[0]++; if (ok) s[1]++;
      L.sec[section] = s;
      L.tot[0]++; if (ok) L.tot[1]++;
      n++;
    });
  }
  const old = ss.getSheetByName(SHEET_ANSWERS);
  if (old && old.getLastRow() >= 2) addRows(old.getRange(2, 1, old.getLastRow() - 1, ANS_HEADERS.length).getValues());
  const props = PropertiesService.getScriptProperties().getProperties();
  let files = 0;
  Object.keys(props).filter(function (k) { return k.indexOf('ANSWER_LOG_') === 0; }).forEach(function (k) {
    try {
      const sh = SpreadsheetApp.openById(props[k]).getSheetByName(SHEET_ANSWERS);
      if (sh && sh.getLastRow() >= 2) addRows(sh.getRange(2, 1, sh.getLastRow() - 1, ANS_HEADERS.length).getValues());
      files++;
    } catch (e) { console.error('回答の記録を開けませんでした：' + k); }
  });
  const mr = ss.getSheetByName(SHEET_MOCK_RESULTS);
  if (mr && mr.getLastRow() >= 2) {
    mr.getRange(2, 1, mr.getLastRow() - 1, 7).getValues().forEach(function (r) {
      const uid = String(r[1]);
      if (!uid || !(r[3] instanceof Date)) return;
      const m = { level: String(r[2]), total: Number(r[4]), result: String(r[6]), at: r[3].toISOString() };
      const u = lmv[uid] || (lmv[uid] = {});
      if (!u[m.level] || new Date(u[m.level].at).getTime() < r[3].getTime()) u[m.level] = m;
    });
  }
  const uids = {};
  Object.keys(lv).concat(Object.keys(lmv)).forEach(function (u) { uids[u] = true; });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    Object.keys(uids).forEach(function (uid) {
      const sum = udSum_(uid);
      sum.lv = lv[uid] || {};
      sum.lmv = lmv[uid] || {};
      udWrite_(uid + '|sum', sum);
    });
  } finally {
    lock.releaseLock();
  }
  Logger.log('レベルごとの記録を作りました：受講生 ' + Object.keys(uids).length + '人・答え ' + n + '件（回答の記録のファイル ' + files + '個）');
}
