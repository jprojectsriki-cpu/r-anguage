/**
 * R-ANGUAGE API - 受講生の「問題」（R-10b）
 *
 * - QuestionCounts シート：レベル・科目・問題形式（大問）ごとの問題数。JLPT の「問題数の目安」に合わせてある
 *   （行の順番が、出題する順番。公式の数が変わったら、このシートの数字を直すだけでよい）
 * - Answers シート：受講生が答えた記録（1問ごとに1行）
 * - Favorites シート：お気に入り（☆）の問題
 * - まちがい復習：いちばん新しい答えが不正解の問題（次に正解すると、復習から外れる）
 * - 管理者のアカウントは、すべてのレベルを解ける（画面の確認用。記録は残る）
 */

const SHEET_Q_COUNTS = 'QuestionCounts';
const SHEET_ANSWERS = 'Answers';
const SHEET_FAVORITES = 'Favorites';
const QC_HEADERS = ['レベル', '科目', '問題形式', '問題数'];
const ANS_HEADERS = ['userId', '問題ID', 'レベル', '科目', '問題形式', '選んだ番号', '正解', '回答日時', '解き方'];
const FAV_HEADERS = ['userId', '問題ID', '登録日時'];
const PRACTICE_MODES = ['set', 'form', 'mistakes', 'favorites', 'retry'];
const REVIEW_MAX = 30; // まちがい復習・お気に入りで1回に出す数の上限

/**
 * JLPT の問題数の目安（日本語能力試験 公式の「問題の構成」より）
 * - N1 の聴解は 2022年12月からの数
 * - N4 は 2020年12月からの数（公式サイトでは画像のみ。公式問題集などで確かめて、ちがえばシートを直す）
 */
const QC_DEFAULTS = [
  ['N1', '文字・語彙', '漢字読み', 6], ['N1', '文字・語彙', '文脈規定', 7], ['N1', '文字・語彙', '言い換え類義', 6], ['N1', '文字・語彙', '用法', 6],
  ['N1', '文法', '文法形式の判断', 10], ['N1', '文法', '文の組み立て', 5], ['N1', '文法', '文章の文法', 5],
  ['N1', '読解', '内容理解（短文）', 4], ['N1', '読解', '内容理解（中文）', 9], ['N1', '読解', '内容理解（長文）', 4],
  ['N1', '読解', '統合理解', 3], ['N1', '読解', '主張理解（長文）', 4], ['N1', '読解', '情報検索', 2],
  ['N1', '聴解', '課題理解', 5], ['N1', '聴解', 'ポイント理解', 6], ['N1', '聴解', '概要理解', 5], ['N1', '聴解', '即時応答', 11], ['N1', '聴解', '統合理解', 3],

  ['N2', '文字・語彙', '漢字読み', 5], ['N2', '文字・語彙', '表記', 5], ['N2', '文字・語彙', '語形成', 5],
  ['N2', '文字・語彙', '文脈規定', 7], ['N2', '文字・語彙', '言い換え類義', 5], ['N2', '文字・語彙', '用法', 5],
  ['N2', '文法', '文法形式の判断', 12], ['N2', '文法', '文の組み立て', 5], ['N2', '文法', '文章の文法', 5],
  ['N2', '読解', '内容理解（短文）', 5], ['N2', '読解', '内容理解（中文）', 9], ['N2', '読解', '統合理解', 2],
  ['N2', '読解', '主張理解（長文）', 3], ['N2', '読解', '情報検索', 2],
  ['N2', '聴解', '課題理解', 5], ['N2', '聴解', 'ポイント理解', 6], ['N2', '聴解', '概要理解', 5], ['N2', '聴解', '即時応答', 12], ['N2', '聴解', '統合理解', 4],

  ['N3', '文字・語彙', '漢字読み', 8], ['N3', '文字・語彙', '表記', 6], ['N3', '文字・語彙', '文脈規定', 11],
  ['N3', '文字・語彙', '言い換え類義', 5], ['N3', '文字・語彙', '用法', 5],
  ['N3', '文法', '文法形式の判断', 13], ['N3', '文法', '文の組み立て', 5], ['N3', '文法', '文章の文法', 5],
  ['N3', '読解', '内容理解（短文）', 4], ['N3', '読解', '内容理解（中文）', 6], ['N3', '読解', '内容理解（長文）', 4], ['N3', '読解', '情報検索', 2],
  ['N3', '聴解', '課題理解', 6], ['N3', '聴解', 'ポイント理解', 6], ['N3', '聴解', '概要理解', 3], ['N3', '聴解', '発話表現', 4], ['N3', '聴解', '即時応答', 9],

  ['N4', '文字・語彙', '漢字読み', 7], ['N4', '文字・語彙', '表記', 5], ['N4', '文字・語彙', '文脈規定', 8],
  ['N4', '文字・語彙', '言い換え類義', 4], ['N4', '文字・語彙', '用法', 4],
  ['N4', '文法', '文法形式の判断', 13], ['N4', '文法', '文の組み立て', 4], ['N4', '文法', '文章の文法', 4],
  ['N4', '読解', '内容理解（短文）', 3], ['N4', '読解', '内容理解（中文）', 3], ['N4', '読解', '情報検索', 2],
  ['N4', '聴解', '課題理解', 8], ['N4', '聴解', 'ポイント理解', 7], ['N4', '聴解', '発話表現', 5], ['N4', '聴解', '即時応答', 8]
];

/**
 * 【1回だけ実行】QuestionCounts・Answers・Favorites シートを用意する
 * （QuestionCounts がすでにあって数字が入っているときは、上書きしない）
 */
function setupPractice() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let qc = ss.getSheetByName(SHEET_Q_COUNTS);
  if (!qc) qc = ss.insertSheet(SHEET_Q_COUNTS);
  qc.getRange(1, 1, 1, QC_HEADERS.length).setValues([QC_HEADERS]).setFontWeight('bold').setBackground('#FFF3CF');
  qc.setFrozenRows(1);
  if (qc.getLastRow() < 2) {
    qc.getRange(2, 1, QC_DEFAULTS.length, 4).setValues(QC_DEFAULTS);
  }
  [60, 90, 150, 70].forEach(function (w, i) { qc.setColumnWidth(i + 1, w); });

  [[SHEET_ANSWERS, ANS_HEADERS], [SHEET_FAVORITES, FAV_HEADERS]].forEach(function (p) {
    let sh = ss.getSheetByName(p[0]);
    if (!sh) sh = ss.insertSheet(p[0]);
    sh.getRange(1, 1, 1, p[1].length).setValues([p[1]]).setFontWeight('bold').setBackground('#FFF3CF');
    sh.setFrozenRows(1);
  });

  Logger.log('QuestionCounts（' + (qc.getLastRow() - 1) + '行）・Answers・Favorites シートを用意しました');
}

/* =========================================================
 * 読み込み
 * ========================================================= */

/** 問題数の表。[{level, section, form, count}]（シートの行の順番＝出題の順番） */
function readQuestionCounts_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_Q_COUNTS);
  const rows = sheet && sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues() : QC_DEFAULTS;
  return rows
    .map(function (r) {
      return { level: String(r[0]).trim(), section: String(r[1]).trim(), form: String(r[2]).trim(), count: Math.floor(Number(r[3])) };
    })
    .filter(function (c) { return LEVEL_LIST.indexOf(c.level) >= 0 && SECTIONS.indexOf(c.section) >= 0 && c.form && c.count > 0; });
}

/** 受講生に出せる問題（公開・入力ミスなし）だけ */
function readPublicQuestions_() {
  return readQuestions_().filter(function (q) {
    q.form = String(q.form || '').trim();
    return q.status === '公開' && validateQuestion_(q).length === 0;
  });
}

/** この受講生が解けるレベル（管理者はすべて） */
function practiceLevels_(user) {
  if (user.role === 'admin') return LEVEL_LIST.slice();
  return LEVEL_LIST.filter(function (lv) { return user.levels.indexOf(lv) >= 0; });
}

/** この受講生の答えの記録（古い順） */
function readMyAnswers_(userId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ANSWERS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, ANS_HEADERS.length).getValues()
    .filter(function (r) { return String(r[0]) === userId; })
    .map(function (r) {
      return { questionId: String(r[1]), level: String(r[2]), section: String(r[3]), form: String(r[4]), chosen: String(r[5]), correct: r[6] === true || String(r[6]).toUpperCase() === 'TRUE', at: r[7] };
    });
}

/** まちがい復習の問題ID（いちばん新しい答えが不正解のもの。まちがえた順） */
function mistakeIds_(answers) {
  const last = {};
  answers.forEach(function (a, i) { last[a.questionId] = { correct: a.correct, i: i }; });
  return Object.keys(last)
    .filter(function (id) { return !last[id].correct; })
    .sort(function (a, b) { return last[a].i - last[b].i; });
}

/** この受講生のお気に入りの問題ID（登録した順） */
function readMyFavorites_(userId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_FAVORITES);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues()
    .filter(function (r) { return String(r[0]) === userId; })
    .map(function (r) { return String(r[1]); });
}

/* =========================================================
 * 受講生
 * ========================================================= */

/**
 * 問題のメニュー
 * levels: [{ level, sections: [{ section, want, have, forms: [{ form, want, have }] }], mistakes, favorites }]
 * extra: 表にない問題形式の公開問題の数（管理者向けの注意）
 */
function mePracticeMenu_(token) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  const levels = practiceLevels_(me.user);
  const counts = readQuestionCounts_();
  const questions = readPublicQuestions_();
  const byId = {};
  questions.forEach(function (q) { byId[q.questionId] = q; });
  const mistakes = mistakeIds_(readMyAnswers_(me.user.userId)).map(function (id) { return byId[id]; }).filter(Boolean);
  const favorites = readMyFavorites_(me.user.userId).map(function (id) { return byId[id]; }).filter(Boolean);

  const have = {};
  questions.forEach(function (q) {
    const k = q.level + '|' + q.section + '|' + q.form;
    have[k] = (have[k] || 0) + 1;
  });
  let extra = 0;
  questions.forEach(function (q) {
    if (levels.indexOf(q.level) === -1) return;
    const known = counts.some(function (c) { return c.level === q.level && c.section === q.section && c.form === q.form; });
    if (!known) extra++;
  });

  return {
    ok: true,
    isAdmin: me.user.role === 'admin',
    extra: me.user.role === 'admin' ? extra : 0,
    levels: levels.map(function (lv) {
      return {
        level: lv,
        sections: SECTIONS.map(function (sec) {
          const forms = counts
            .filter(function (c) { return c.level === lv && c.section === sec; })
            .map(function (c) { return { form: c.form, want: c.count, have: Math.min(have[lv + '|' + sec + '|' + c.form] || 0, 999) }; });
          return {
            section: sec,
            want: forms.reduce(function (s, f) { return s + f.want; }, 0),
            have: forms.reduce(function (s, f) { return s + Math.min(f.have, f.want); }, 0),
            forms: forms
          };
        }).filter(function (s) { return s.forms.length; }),
        mistakes: mistakes.filter(function (q) { return q.level === lv; }).length,
        favorites: favorites.filter(function (q) { return q.level === lv; }).length
      };
    })
  };
}

/** 本文・音声が同じ問題を1つのまとまりにする（読解の文章・聴解の音声を分けないため） */
function groupUnits_(list) {
  const units = [];
  const index = {};
  list.forEach(function (q) {
    const shared = String(q.passage || '').trim() || q.audio;
    if (!shared) { units.push([q]); return; }
    const k = q.form + '\u0000' + String(q.passage || '').trim() + '\u0000' + q.audio;
    if (index[k] === undefined) { index[k] = units.length; units.push([]); }
    units[index[k]].push(q);
  });
  return units;
}

function shuffle_(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/** まとまりを、want 問をこえないようにランダムに選ぶ（まとまりの中の順番はそのまま） */
function pickUnits_(list, want) {
  const picked = [];
  shuffle_(groupUnits_(list)).forEach(function (u) {
    if (picked.length + u.length <= want) Array.prototype.push.apply(picked, u);
  });
  return picked;
}

/** 受講生の画面に送る形 */
function toClientQuestion_(q, favs) {
  return {
    questionId: q.questionId, level: q.level, section: q.section, form: q.form,
    passage: q.passage, audio: q.audio, question: q.question, choices: q.choices,
    answer: Number(q.answer), explanation: q.explanation, favorite: favs.indexOf(q.questionId) >= 0
  };
}

/**
 * 問題を始める
 * mode: set（科目ごと＝本番と同じ数）／form（大問ごと）／mistakes（まちがい復習）／favorites（お気に入り）／retry（ids の問題をもう一度）
 * 返す short：数が足りなかった大問 [{ form, want, got }]
 */
function mePracticeStart_(token, input) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  input = input || {};
  const mode = String(input.mode || '');
  const level = String(input.level || '');
  const section = String(input.section || '');
  const form = String(input.form || '').trim();
  if (PRACTICE_MODES.indexOf(mode) === -1) return { ok: false, message: '解き方が正しくありません。' };
  if (practiceLevels_(me.user).indexOf(level) === -1) return { ok: false, message: 'このレベルは、まだ使えません。マイページから追加できます。' };

  const all = readPublicQuestions_().filter(function (q) { return q.level === level; });
  const favs = readMyFavorites_(me.user.userId);
  const byId = {};
  all.forEach(function (q) { byId[q.questionId] = q; });
  let picked = [];
  const short = [];

  if (mode === 'set' || mode === 'form') {
    if (SECTIONS.indexOf(section) === -1) return { ok: false, message: '科目が正しくありません。' };
    const counts = readQuestionCounts_().filter(function (c) {
      return c.level === level && c.section === section && (mode === 'set' || c.form === form);
    });
    if (!counts.length) return { ok: false, message: 'この問題形式は、問題数の表にありません。' };
    counts.forEach(function (c) {
      const got = pickUnits_(all.filter(function (q) { return q.section === section && q.form === c.form; }), c.count);
      if (got.length < c.count) short.push({ form: c.form, want: c.count, got: got.length });
      Array.prototype.push.apply(picked, got);
    });
  } else {
    let ids;
    if (mode === 'mistakes') ids = mistakeIds_(readMyAnswers_(me.user.userId));
    else if (mode === 'favorites') ids = favs.slice();
    else ids = (Array.isArray(input.ids) ? input.ids : []).map(String);
    picked = ids.map(function (id) { return byId[id]; }).filter(Boolean);
    // 同じまとまり（本文・音声）の問題は続けて出す。科目・大問の順にそろえる
    const order = {};
    readQuestionCounts_().forEach(function (c, i) { if (c.level === level) order[c.section + '|' + c.form] = i; });
    const units = groupUnits_(picked);
    units.sort(function (a, b) {
      const x = order[a[0].section + '|' + a[0].form], y = order[b[0].section + '|' + b[0].form];
      return (x === undefined ? 999 : x) - (y === undefined ? 999 : y);
    });
    picked = [];
    units.forEach(function (u) { if (picked.length + u.length <= REVIEW_MAX || !picked.length) Array.prototype.push.apply(picked, u); });
  }

  if (!picked.length) {
    return { ok: false, message: mode === 'mistakes' ? 'まちがえた問題はありません。' : mode === 'favorites' ? 'お気に入りの問題はありません。' : 'この問題は、まだ登録されていません。' };
  }
  return { ok: true, mode: mode, level: level, section: section, form: form, short: short,
    questions: picked.map(function (q) { return toClientQuestion_(q, favs); }) };
}

/**
 * 答えの記録（まとめて送ってよい）
 * answers: [{ questionId, chosen }]（正解かどうかはサーバーで問題と照らし合わせて決める）
 */
function meSaveAnswers_(token, input) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  input = input || {};
  const list = Array.isArray(input.answers) ? input.answers.slice(0, 100) : [];
  const mode = PRACTICE_MODES.indexOf(String(input.mode)) >= 0 ? String(input.mode) : 'set';
  if (!list.length) return { ok: true, saved: 0 };
  const levels = practiceLevels_(me.user);
  const byId = {};
  readPublicQuestions_().forEach(function (q) { byId[q.questionId] = q; });
  const now = new Date();
  const rows = [];
  list.forEach(function (a) {
    const q = byId[String(a.questionId)];
    const chosen = String(a.chosen);
    if (!q || levels.indexOf(q.level) === -1 || ['1', '2', '3', '4'].indexOf(chosen) === -1) return;
    rows.push([me.user.userId, q.questionId, q.level, q.section, q.form, Number(chosen), chosen === String(q.answer), now, mode]);
  });
  if (!rows.length) return { ok: true, saved: 0 };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_(SHEET_ANSWERS);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, ANS_HEADERS.length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, saved: rows.length };
}

/** お気に入り（☆）を付ける・外す */
function meFavorite_(token, questionId, on) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  questionId = String(questionId || '');
  if (!readPublicQuestions_().some(function (q) { return q.questionId === questionId; })) {
    return { ok: false, message: 'この問題は見つかりません。' };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_(SHEET_FAVORITES);
    const last = sheet.getLastRow();
    const rows = last >= 2 ? sheet.getRange(2, 1, last - 1, 2).getValues() : [];
    const hit = [];
    rows.forEach(function (r, i) { if (String(r[0]) === me.user.userId && String(r[1]) === questionId) hit.push(i + 2); });
    if (on && !hit.length) sheet.appendRow([me.user.userId, questionId, new Date()]);
    if (!on) hit.reverse().forEach(function (row) { sheet.deleteRow(row); });
  } finally {
    lock.releaseLock();
  }
  return { ok: true, favorite: !!on };
}
