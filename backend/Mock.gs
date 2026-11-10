/**
 * R-ANGUAGE API - 受講生の「模擬試験」（R-10d）
 *
 * - 科目（試験の時間の区切り）と時間、点数の区分・合格点・基準点は、日本語能力試験の公式の情報に合わせてある
 *     N1・N2：言語知識（文字・語彙・文法）・読解／聴解（2科目）
 *     N3・N4：言語知識（文字・語彙）／言語知識（文法）・読解／聴解（3科目）
 * - 問題の数は QuestionCounts シートのとおり（「問題」と同じ）。登録された問題からランダムに出す
 * - 問題を出すときは、正解と解説は送らない。答えを出したあと（me.mockSubmit）に、サーバーで採点して返す
 * - 点数は「目安」：区分ごとの正答率 × 区分の満点（本番は尺度得点という特別な計算をする）
 * - MockResults シートに結果を残す。答えは Answers シートにも残す（解き方＝mock）ので、まちがい復習に入る
 */

const SHEET_MOCK_RESULTS = 'MockResults';
const MR_HEADERS = ['結果ID', 'userId', 'レベル', '受けた日時', '合計', '合格点', '合否', '区分の点数', '正解数', '問題数', 'くわしい結果'];

/** 科目と時間（分） */
const MOCK_PAPERS = {
  N1: [
    { key: 'p1', name: '言語知識（文字・語彙・文法）・読解', sections: ['文字・語彙', '文法', '読解'], minutes: 110 },
    { key: 'p2', name: '聴解', sections: ['聴解'], minutes: 55 }
  ],
  N2: [
    { key: 'p1', name: '言語知識（文字・語彙・文法）・読解', sections: ['文字・語彙', '文法', '読解'], minutes: 105 },
    { key: 'p2', name: '聴解', sections: ['聴解'], minutes: 50 }
  ],
  N3: [
    { key: 'p1', name: '言語知識（文字・語彙）', sections: ['文字・語彙'], minutes: 30 },
    { key: 'p2', name: '言語知識（文法）・読解', sections: ['文法', '読解'], minutes: 70 },
    { key: 'p3', name: '聴解', sections: ['聴解'], minutes: 40 }
  ],
  N4: [
    { key: 'p1', name: '言語知識（文字・語彙）', sections: ['文字・語彙'], minutes: 25 },
    { key: 'p2', name: '言語知識（文法）・読解', sections: ['文法', '読解'], minutes: 55 },
    { key: 'p3', name: '聴解', sections: ['聴解'], minutes: 35 }
  ]
};

/** 点数の区分（満点・基準点）と合格点 */
const MOCK_SCORING = {
  N1: { pass: 100, divisions: [
    { name: '言語知識（文字・語彙・文法）', sections: ['文字・語彙', '文法'], max: 60, base: 19 },
    { name: '読解', sections: ['読解'], max: 60, base: 19 },
    { name: '聴解', sections: ['聴解'], max: 60, base: 19 }] },
  N2: { pass: 90, divisions: [
    { name: '言語知識（文字・語彙・文法）', sections: ['文字・語彙', '文法'], max: 60, base: 19 },
    { name: '読解', sections: ['読解'], max: 60, base: 19 },
    { name: '聴解', sections: ['聴解'], max: 60, base: 19 }] },
  N3: { pass: 95, divisions: [
    { name: '言語知識（文字・語彙・文法）', sections: ['文字・語彙', '文法'], max: 60, base: 19 },
    { name: '読解', sections: ['読解'], max: 60, base: 19 },
    { name: '聴解', sections: ['聴解'], max: 60, base: 19 }] },
  N4: { pass: 90, divisions: [
    { name: '言語知識（文字・語彙・文法）・読解', sections: ['文字・語彙', '文法', '読解'], max: 120, base: 38 },
    { name: '聴解', sections: ['聴解'], max: 60, base: 19 }] }
};

/** 【1回だけ実行】MockResults シートを用意する */
function setupMock() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_MOCK_RESULTS);
  if (!sh) sh = ss.insertSheet(SHEET_MOCK_RESULTS);
  sh.getRange(1, 1, 1, MR_HEADERS.length).setValues([MR_HEADERS]).setFontWeight('bold').setBackground('#FFE3EF');
  sh.setFrozenRows(1);
  Logger.log('MockResults シートを用意しました');
}

/** 問題を出すとき（正解・解説なし） */
function toMockQuestion_(q) {
  return { questionId: q.questionId, section: q.section, form: q.form, passage: q.passage, audio: q.audio, question: q.question, choices: q.choices };
}

/** この受講生の模試の結果（新しい順） */
/** 1回の模試の「くわしい結果」（JSON の文字）を、結果IDで探して読む */
function readMockDetail_(resultId) {
  const sheet = getSheet_(SHEET_MOCK_RESULTS);
  if (sheet.getLastRow() < 2) return '';
  const hit = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(String(resultId)).matchEntireCell(true).findNext();
  return hit ? String(sheet.getRange(hit.getRow(), MR_HEADERS.length).getValue() || '') : '';
}

function readMyMockResults_(userId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MOCK_RESULTS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  // 「くわしい結果」（11列目・長い）は読まない。必要なときは readMockDetail_ で1行だけ読む
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, MR_HEADERS.length - 1).getValues()
    .filter(function (r) { return String(r[1]) === userId; })
    .map(function (r) {
      let divisions = [];
      try { divisions = JSON.parse(r[7] || '[]'); } catch (e) { divisions = []; }
      return {
        resultId: String(r[0]), level: String(r[2]), at: r[3] instanceof Date ? r[3].toISOString() : String(r[3]),
        total: Number(r[4]), pass: Number(r[5]), result: String(r[6]), divisions: divisions,
        correct: Number(r[8]), count: Number(r[9])
      };
    })
    .reverse();
}

/** 模試のメニュー：レベルごとの科目・時間・問題数と、今までの結果 */
function meMockMenu_(token) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  const levels = practiceLevels_(me.user);
  const counts = readQuestionCounts_();
  const questions = readPublicQuestions_();
  const have = {};
  questions.forEach(function (q) {
    const k = q.level + '|' + q.section + '|' + q.form;
    have[k] = (have[k] || 0) + 1;
  });
  return {
    ok: true,
    isAdmin: me.user.role === 'admin',
    levels: levels.map(function (lv) {
      const sc = MOCK_SCORING[lv];
      return {
        level: lv,
        pass: sc.pass,
        divisions: sc.divisions.map(function (d) { return { name: d.name, max: d.max, base: d.base }; }),
        papers: MOCK_PAPERS[lv].map(function (p) {
          let want = 0, got = 0;
          counts.filter(function (c) { return c.level === lv && p.sections.indexOf(c.section) >= 0; }).forEach(function (c) {
            want += c.count;
            got += Math.min(c.count, have[lv + '|' + c.section + '|' + c.form] || 0);
          });
          return { key: p.key, name: p.name, minutes: p.minutes, want: want, have: got };
        })
      };
    }),
    history: readMyMockResults_(me.user.userId).slice(0, 20).map(function (r) {
      return { resultId: r.resultId, level: r.level, at: r.at, total: r.total, pass: r.pass, result: r.result, divisions: r.divisions, correct: r.correct, count: r.count };
    })
  };
}

/** 模試を始める：科目ごとの問題（QuestionCounts の順番・数） */
function meMockStart_(token, level) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  level = String(level || '');
  if (practiceLevels_(me.user).indexOf(level) === -1) return { ok: false, message: 'このレベルは、まだ使えません。マイページから追加できます。' };
  const counts = readQuestionCounts_().filter(function (c) { return c.level === level; });
  const all = readPublicQuestions_().filter(function (q) { return q.level === level; });
  let total = 0;
  const lastAt = lastAnsweredMap_(me.user.userId); // まだ解いていない問題を先に
  const papers = MOCK_PAPERS[level].map(function (p) {
    const list = [];
    counts.filter(function (c) { return p.sections.indexOf(c.section) >= 0; })
      .sort(function (a, b) { return p.sections.indexOf(a.section) - p.sections.indexOf(b.section); })
      .forEach(function (c) {
        Array.prototype.push.apply(list, pickUnits_(all.filter(function (q) { return q.section === c.section && q.form === c.form; }), c.count, lastAt));
      });
    total += list.length;
    return { key: p.key, name: p.name, minutes: p.minutes, questions: list.map(toMockQuestion_) };
  });
  if (!total) return { ok: false, message: 'このレベルの問題は、まだ登録されていません。' };
  return { ok: true, level: level, papers: papers };
}

/**
 * 答えを出す：採点して記録する
 * input: { level, answers: [{ questionId, chosen }]（答えていない問題は chosen なし）, minutes: { p1: 使った分, ... } }
 */
function meMockSubmit_(token, input) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  input = input || {};
  const level = String(input.level || '');
  if (practiceLevels_(me.user).indexOf(level) === -1) return { ok: false, message: 'このレベルは、まだ使えません。' };
  const list = Array.isArray(input.answers) ? input.answers.slice(0, 400) : [];
  const byId = {};
  readPublicQuestions_().forEach(function (q) { byId[q.questionId] = q; });

  const items = [];
  const seen = {};
  list.forEach(function (a) {
    const q = byId[String(a.questionId)];
    if (!q || q.level !== level || seen[q.questionId]) return;
    seen[q.questionId] = true;
    const chosen = ['1', '2', '3', '4'].indexOf(String(a.chosen)) >= 0 ? Number(a.chosen) : 0;
    items.push({ q: q, chosen: chosen, correct: chosen === Number(q.answer) });
  });
  if (!items.length) return { ok: false, message: '採点できる問題がありません。' };

  const graded = gradeMock_(level, items);
  const now = new Date();
  const resultId = 'M' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMddHHmmss') + '-' + Math.floor(Math.random() * 900 + 100);
  const detail = items.map(function (it) { return [it.q.questionId, it.chosen, it.correct ? 1 : 0]; });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    getSheet_(SHEET_MOCK_RESULTS).appendRow([
      resultId, me.user.userId, level, now, graded.total, graded.pass, graded.result,
      JSON.stringify(graded.divisions), graded.correct, items.length, JSON.stringify(detail)
    ]);
    // 答えた問題は、受講生ごとのまとめにも入れる（まちがい復習・正答率に入る）
    const answered = items.filter(function (it) { return it.chosen; });
    const uid = me.user.userId;
    const ans = udAns_(uid);
    const sum = udSum_(uid);
    udAddAnswers_(uid, answered.map(function (it) {
      return { questionId: it.q.questionId, level: it.q.level, section: it.q.section, form: it.q.form, correct: it.correct };
    }), 'mock', now, ans, sum);
    if (!answered.length) udMarkDay_(sum, now, 1);
    sum.lm = { level: level, total: graded.total, result: graded.result, at: now.toISOString() };
    sum.lmv[level] = sum.lm;
    udWrite_(uid + '|ans', ans);
    udWrite_(uid + '|sum', sum);
    var logRows = answered.map(function (it) {
      return [uid, it.q.questionId, it.q.level, it.q.section, it.q.form, it.chosen, it.correct, now, 'mock'];
    });
  } finally {
    lock.releaseLock();
  }
  writeAnswerLog_(logRows || [], now);
  return Object.assign({ ok: true, resultId: resultId, level: level, at: now.toISOString() }, graded, { count: items.length, review: reviewItems_(items) });
}

/** 区分ごとの点数（目安）と合否 */
function gradeMock_(level, items) {
  const sc = MOCK_SCORING[level];
  let lacking = false;
  const divisions = sc.divisions.map(function (d) {
    const inDiv = items.filter(function (it) { return d.sections.indexOf(it.q.section) >= 0; });
    const ok = inDiv.filter(function (it) { return it.correct; }).length;
    if (!inDiv.length) { lacking = true; return { name: d.name, max: d.max, base: d.base, score: null, correct: 0, count: 0 }; }
    return { name: d.name, max: d.max, base: d.base, score: Math.round(ok / inDiv.length * d.max), correct: ok, count: inDiv.length };
  });
  const total = divisions.reduce(function (s, d) { return s + (d.score || 0); }, 0);
  const basesOk = divisions.every(function (d) { return d.score === null || d.score >= d.base; });
  let result;
  if (lacking) result = '判定なし';
  else result = total >= sc.pass && basesOk ? '合格' : '不合格';
  return {
    total: total, pass: sc.pass, result: result, divisions: divisions,
    correct: items.filter(function (it) { return it.correct; }).length
  };
}

/** 見直し用（正解・解説つき） */
function reviewItems_(items) {
  return items.map(function (it) {
    const q = it.q;
    return {
      questionId: q.questionId, section: q.section, form: q.form, passage: q.passage, audio: q.audio, question: q.question,
      choices: q.choices, answer: Number(q.answer), explanation: q.explanation, chosen: it.chosen, correct: it.correct
    };
  });
}

/** 前に受けた模試の結果（答えと解説つき） */
function meMockResult_(token, resultId) {
  const me = requireMe_(token);
  if (!me.ok) return me;
  const r = readMyMockResults_(me.user.userId).filter(function (x) { return x.resultId === String(resultId || ''); })[0];
  if (!r) return { ok: false, message: 'この結果は見つかりません。' };
  let detail = [];
  try { detail = JSON.parse(readMockDetail_(r.resultId) || '[]'); } catch (e) { detail = []; }
  const byId = {};
  readQuestions_().forEach(function (q) { byId[q.questionId] = q; });
  const items = detail.map(function (d) {
    const q = byId[String(d[0])];
    return q ? { q: q, chosen: Number(d[1]) || 0, correct: d[2] === 1 } : null;
  }).filter(Boolean);
  return {
    ok: true, resultId: r.resultId, level: r.level, at: r.at, total: r.total, pass: r.pass, result: r.result,
    divisions: r.divisions, correct: r.correct, count: r.count, review: reviewItems_(items),
    missing: detail.length - items.length
  };
}
