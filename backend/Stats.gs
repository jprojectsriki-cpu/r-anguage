/**
 * R-ANGUAGE API - ホームの学習記録（R-10e）
 *
 * - 数字はすべて、受講生ごとのまとめ（UserData シート、UserData.gs）から出す
 * - 連続日数：問題・単語カード・模試のどれかをした日が、今日（今日まだなら昨日）から何日続いているか。日付は日本時間
 * - この7日間：学習した日
 * - 正答率：全体と科目ごと（模試の答えもふくむ）
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
  const sections = SECTIONS.map(function (sec) {
    const v = sum.sec[sec] || [0, 0];
    return { section: sec, answered: v[0], correct: v[1], rate: v[0] ? Math.round(v[1] / v[0] * 100) : null };
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
  const qidx = questionIndex_();
  Object.keys(qidx).forEach(function (id) { if (levels.indexOf(qidx[id].level) >= 0) pub[id] = qidx[id]; });
  const mistakes = mistakeIdsOf_(ans).filter(function (id) { return pub[id]; });
  const mistakeLevels = {};
  mistakes.forEach(function (id) { mistakeLevels[pub[id].level] = (mistakeLevels[pub[id].level] || 0) + 1; });
  let mistakeLevel = '';
  Object.keys(mistakeLevels).forEach(function (lv) { if (!mistakeLevel || mistakeLevels[lv] > mistakeLevels[mistakeLevel]) mistakeLevel = lv; });

  // レベルごと（複数のレベルを受けている受講生は、ホームで切りかえて見る）
  const byLevel = levels.map(function (lv) {
    const L = sum.lv[lv] || { sec: {}, tot: [0, 0] };
    const lvCards = cards.filter(function (c) { return c.level === lv; });
    return {
      level: lv,
      total: { answered: L.tot[0], correct: L.tot[1], rate: L.tot[0] ? Math.round(L.tot[1] / L.tot[0] * 100) : null },
      sections: SECTIONS.map(function (sec) {
        const v = L.sec[sec] || [0, 0];
        return { section: sec, answered: v[0], correct: v[1], rate: v[0] ? Math.round(v[1] / v[0] * 100) : null };
      }),
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
    total: { answered: sum.tot[0], correct: sum.tot[1], rate: sum.tot[0] ? Math.round(sum.tot[1] / sum.tot[0] * 100) : null },
    sections: sections,
    vocab: { known: known, total: cards.length },
    mistakes: { count: mistakes.length, level: mistakeLevel },
    lastPractice: lastPractice,
    lastMock: sum.lm
  };
}
