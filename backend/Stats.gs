/**
 * R-ANGUAGE API - ホームの学習記録（R-10e）
 *
 * - 数字はすべて、受講生ごとのまとめ（UserData シート、UserData.gs）から出す
 * - 連続日数：問題・単語カード・模試のどれかをした日が、今日（今日まだなら昨日）から何日続いているか。日付は日本時間
 * - この7日間：学習した日
 * - 正答率：全体と科目ごと（模試の答えもふくむ）。1問につき「最後の答え」だけで数える（2026-11 から）
 *   解き直して正解すれば 100% にできる。公開をやめた問題は数えない
 *   マイページの「成績のリセット」をした科目は、リセットより前の答えを数えない（回答の記録・まちがい復習は消さない）
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
  // 受講生ごとのまとめ（UserData.gs）。ほかの受講生の行は読まない
  const sum = udSum_(uid);
  const ans = udAns_(uid);
  const days = sum.days;
  const qidx = questionIndex_();

  // 正答率：問題ごとの最後の答えから数える { レベル: { 科目: [答えた問題数, 正解数] } }
  const rst = sum.rst || {};
  const cnt = {};
  Object.keys(ans).forEach(function (id) {
    const q = qidx[id];
    if (!q || levels.indexOf(q.level) < 0 || SECTIONS.indexOf(q.section) < 0) return;
    const t = Number(ans[id][0]) || 0;
    if (t < (Number(rst[q.level + '|' + q.section]) || 0) || t < (Number(rst[q.level + '|*']) || 0)) return;
    const L = cnt[q.level] || (cnt[q.level] = {});
    const v = L[q.section] || (L[q.section] = [0, 0]);
    v[0]++;
    if (Number(ans[id][1]) === 1) v[1]++;
  });
  function rateRow(sec, v) { return { section: sec, answered: v[0], correct: v[1], rate: v[0] ? Math.round(v[1] / v[0] * 100) : null }; }
  function totalOf(rows) {
    const a = rows.reduce(function (n, r) { return n + r.answered; }, 0);
    const c = rows.reduce(function (n, r) { return n + r.correct; }, 0);
    return { answered: a, correct: c, rate: a ? Math.round(c / a * 100) : null };
  }
  const sections = SECTIONS.map(function (sec) {
    const v = [0, 0];
    levels.forEach(function (lv) { const x = (cnt[lv] || {})[sec]; if (x) { v[0] += x[0]; v[1] += x[1]; } });
    return rateRow(sec, v);
  });

  // 単語カード
  const cards = readPublicCards_().filter(function (c) { return levels.indexOf(c.level) >= 0; });
  const mine = readMyVocab_(uid);
  const known = cards.filter(function (c) { return mine[c.cardId] && mine[c.cardId].state === '覚えた'; }).length;

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
  const lastPractice = sum.lp && levels.indexOf(sum.lp.level) >= 0 ? sum.lp : null;

  // まちがい復習の数（いま出せる問題だけ）
  const pub = {};
  Object.keys(qidx).forEach(function (id) { if (levels.indexOf(qidx[id].level) >= 0) pub[id] = qidx[id]; });
  const mistakes = mistakeIdsOf_(ans).filter(function (id) { return pub[id]; });
  const mistakeLevels = {};
  mistakes.forEach(function (id) { mistakeLevels[pub[id].level] = (mistakeLevels[pub[id].level] || 0) + 1; });
  let mistakeLevel = '';
  Object.keys(mistakeLevels).forEach(function (lv) { if (!mistakeLevel || mistakeLevels[lv] > mistakeLevels[mistakeLevel]) mistakeLevel = lv; });

  // レベルごと（複数のレベルを受けている受講生は、ホームで切りかえて見る）
  const byLevel = levels.map(function (lv) {
    const lvCards = cards.filter(function (c) { return c.level === lv; });
    const rows = SECTIONS.map(function (sec) { return rateRow(sec, (cnt[lv] || {})[sec] || [0, 0]); });
    return {
      level: lv,
      total: totalOf(rows),
      sections: rows,
      vocab: { known: lvCards.filter(function (c) { return mine[c.cardId] && mine[c.cardId].state === '覚えた'; }).length, total: lvCards.length },
      mistakes: mistakeLevels[lv] || 0,
      lastMock: sum.lmv[lv] || null
    };
  });

  return {
    ok: true,
    byLevel: byLevel,
    today: todayKey,
    streak: streak,
    doneToday: !!days[todayKey],
    week: week,
    total: totalOf(sections),
    sections: sections,
    vocab: { known: known, total: cards.length },
    mistakes: { count: mistakes.length, level: mistakeLevel },
    lastPractice: lastPractice,
    lastMock: sum.lm
  };
}

/**
 * 成績のリセット（マイページ）。level のうち section（'ALL' ならそのレベルの全科目）の正答率を 0 からにする
 * - 今までの答えは消さない。リセットした時刻だけを覚えて、それより前の答えを正答率に数えない
 * - 回答の記録（月ごとのファイル）・まちがい復習・単語カード・連続日数は変えない
 */
function meResetStats_(token, level, section) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  level = String(level || '');
  section = String(section || '');
  if (practiceLevels_(me.user).indexOf(level) < 0) return { ok: false, message: 'このレベルは使えません。' };
  if (section !== 'ALL' && SECTIONS.indexOf(section) < 0) return { ok: false, message: '科目を選んでください。' };
  const uid = me.user.userId;
  const t = Math.floor(Date.now() / 1000) + 1; // いままでの答えをすべてふくめる
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sum = udSum_(uid);
    if (section === 'ALL') {
      SECTIONS.forEach(function (sec) { delete sum.rst[level + '|' + sec]; });
      sum.rst[level + '|*'] = t;
    } else {
      sum.rst[level + '|' + section] = t;
    }
    udWrite_(uid + '|sum', sum);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, level: level, section: section };
}
