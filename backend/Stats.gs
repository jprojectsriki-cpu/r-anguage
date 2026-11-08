/**
 * R-ANGUAGE API - ホームの学習記録（R-10e）
 *
 * - 連続日数：問題（Answers）・単語カード（VocabProgress の更新日時）・模試（MockResults）のどれかをした日が、
 *   今日（今日まだなら昨日）から何日続いているか。日付は日本時間
 *   ※ VocabProgress は1枚のカードにつき最後の日時だけを持つので、単語カードだけの日は少なめに数えることがある
 * - この7日間：学習した日
 * - 正答率：全体と科目ごと（Answers のすべて。模試の答えもふくむ）
 * - 続きから：前回の問題（科目ごと・大問ごと）、まちがい復習の数、覚えていない単語の数、最後の模試
 */

function jstDay_(d) {
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

function meStats_(token) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  const uid = me.user.userId;
  const levels = practiceLevels_(me.user);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const days = {};
  function mark(v) {
    if (v instanceof Date && !isNaN(v)) { const k = jstDay_(v); days[k] = (days[k] || 0) + 1; }
  }

  // 問題の答え
  const answers = readMyAnswers_(uid);
  answers.forEach(function (a) { mark(a.at); });
  const sections = SECTIONS.map(function (sec) {
    const list = answers.filter(function (a) { return a.section === sec; });
    const ok = list.filter(function (a) { return a.correct; }).length;
    return { section: sec, answered: list.length, correct: ok, rate: list.length ? Math.round(ok / list.length * 100) : null };
  });
  const okAll = answers.filter(function (a) { return a.correct; }).length;

  // 単語カード
  const vp = ss.getSheetByName(SHEET_VOCAB_PROGRESS);
  if (vp && vp.getLastRow() >= 2) {
    vp.getRange(2, 1, vp.getLastRow() - 1, VP_HEADERS.length).getValues().forEach(function (r) {
      if (String(r[0]) === uid) mark(r[6]);
    });
  }
  const cards = readPublicCards_().filter(function (c) { return levels.indexOf(c.level) >= 0; });
  const mine = readMyVocab_(uid);
  const known = cards.filter(function (c) { return mine[c.cardId] && mine[c.cardId].state === '覚えた'; }).length;

  // 模試
  const mocks = readMyMockResults_(uid);
  mocks.forEach(function (m) { mark(new Date(m.at)); });

  // 連続日数（今日まだなら昨日から数える）
  const today = new Date();
  const todayKey = jstDay_(today);
  let streak = 0;
  let cursor = new Date(today.getTime());
  if (!days[todayKey]) cursor = new Date(today.getTime() - 86400000);
  while (days[jstDay_(cursor)]) { streak++; cursor = new Date(cursor.getTime() - 86400000); }

  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const k = jstDay_(d);
    week.push({ date: k, count: days[k] || 0 });
  }

  // 前回の問題（科目ごと・大問ごと）
  let lastPractice = null;
  const sheet = ss.getSheetByName(SHEET_ANSWERS);
  if (sheet && sheet.getLastRow() >= 2) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, ANS_HEADERS.length).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (String(r[0]) !== uid) continue;
      const mode = String(r[8]);
      if (mode !== 'set' && mode !== 'form') continue;
      if (levels.indexOf(String(r[2])) === -1) continue;
      lastPractice = { mode: mode, level: String(r[2]), section: String(r[3]), form: String(r[4]) };
      break;
    }
  }

  // まちがい復習の数（いま出せる問題だけ）
  const pub = {};
  readPublicQuestions_().forEach(function (q) { if (levels.indexOf(q.level) >= 0) pub[q.questionId] = q; });
  const mistakes = mistakeIds_(answers).filter(function (id) { return pub[id]; });
  const mistakeLevels = {};
  mistakes.forEach(function (id) { mistakeLevels[pub[id].level] = (mistakeLevels[pub[id].level] || 0) + 1; });
  let mistakeLevel = '';
  Object.keys(mistakeLevels).forEach(function (lv) { if (!mistakeLevel || mistakeLevels[lv] > mistakeLevels[mistakeLevel]) mistakeLevel = lv; });

  return {
    ok: true,
    today: todayKey,
    streak: streak,
    doneToday: !!days[todayKey],
    week: week,
    total: { answered: answers.length, correct: okAll, rate: answers.length ? Math.round(okAll / answers.length * 100) : null },
    sections: sections,
    vocab: { known: known, total: cards.length },
    mistakes: { count: mistakes.length, level: mistakeLevel },
    lastPractice: lastPractice,
    lastMock: mocks.length ? { level: mocks[0].level, total: mocks[0].total, result: mocks[0].result, at: mocks[0].at } : null
  };
}
