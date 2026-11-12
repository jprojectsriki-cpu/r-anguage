/**
 * R-ANGUAGE API - STAGE（EASY → NORMAL → HARD）
 *
 * - 問題の STAGE：Questions シートの Q列（空なら EASY。前からある問題は、すべて EASY）
 *     EASY   … 本番の形式に慣れる（本番よりややさしい）
 *     NORMAL … 本番と同じくらいの難しさ
 *     HARD   … 本番より難しい応用
 * - 受講生のレベルごとの到達 STAGE：Users シートの N列（JSON）
 *     { stg: { N1: 'NORMAL' }, goal: { N1: '合格ライン到達の日時' } }
 *   （なければ EASY。管理者は、すべての STAGE を使える）
 * - 模試は、いまの STAGE の問題から出す。結果で次の STAGE を判定する
 *     合計がその割合以上 かつ どの区分も基準点以上（本番の合格の考え方と同じ）
 *     EASY 70%（126 / 180点）→ NORMAL を解放
 *     NORMAL 80%（144 / 180点）→ HARD を解放
 *     HARD 90%（162 / 180点）→ 「合格ライン到達」（バッジ）
 * - 練習（問題）は、解放した STAGE をどれでも選べる
 * - 管理画面の「アカウント」から、受講生の STAGE を変えられる（問い合わせの対応用）
 */

const STAGES = ['EASY', 'NORMAL', 'HARD'];
const STAGE_RATE = { EASY: 70, NORMAL: 80, HARD: 90 };
const Q_COL_STAGE = 17;      // Questions シートの Q列
const USER_COL_STAGES = 14;  // Users シートの N列
const MR_COL_STAGE = 12;     // MockResults シートの L列（その模試の STAGE）

/** STAGE の文字をそろえる（空なら EASY） */
function cleanStage_(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return s || 'EASY';
}

/** 問題の STAGE（わからないときは EASY） */
function qStage_(q) {
  return q && STAGES.indexOf(q.stage) >= 0 ? q.stage : 'EASY';
}

/** Users シート N列の JSON を読む */
function parseStages_(v) {
  let o = {};
  try { o = JSON.parse(String(v || '{}')) || {}; } catch (e) { o = {}; }
  return { stg: o.stg || {}, goal: o.goal || {} };
}

/** この受講生の、そのレベルの到達 STAGE（管理者は HARD） */
function userStage_(user, level) {
  if (user.role === 'admin') return 'HARD';
  const s = ((user.stages || {}).stg || {})[level];
  return STAGES.indexOf(s) >= 0 ? s : 'EASY';
}

/** その STAGE を使えるか */
function stageUnlocked_(user, level, stage) {
  const i = STAGES.indexOf(stage);
  return i >= 0 && i <= STAGES.indexOf(userStage_(user, level));
}

/** 次へ進むのに必要な点数（180点満点） */
function stageNeed_(stage) {
  return Math.ceil(180 * STAGE_RATE[stage] / 100);
}

/** 合格ライン到達の日時（なければ ''） */
function userGoal_(user, level) {
  return String(((user.stages || {}).goal || {})[level] || '');
}

/** レベルごとの STAGE の情報（受講生の画面に送る形） */
function stageInfo_(user, level) {
  const stage = userStage_(user, level);
  return {
    stage: stage,
    rate: STAGE_RATE[stage],
    need: stageNeed_(stage),
    next: STAGES[STAGES.indexOf(stage) + 1] || '',
    goal: userGoal_(user, level)
  };
}

/** 模試の結果（gradeMock_ の結果）で判定する */
function judgeStage_(stage, graded) {
  stage = STAGES.indexOf(stage) >= 0 ? stage : 'EASY';
  const need = stageNeed_(stage);
  const basesOk = graded.divisions.every(function (d) { return d.score !== null && d.score >= d.base; });
  return {
    stage: stage,
    rate: STAGE_RATE[stage],
    need: need,
    ok: graded.result !== '判定なし' && graded.total >= need && basesOk,
    lowBase: !basesOk,
    next: STAGES[STAGES.indexOf(stage) + 1] || ''
  };
}

/** シートの列が n 列より少なければ足す */
function ensureCols_(sheet, n) {
  const max = sheet.getMaxColumns();
  if (max < n) sheet.insertColumnsAfter(max, n - max);
}

function writeUserStages_(row, stages) {
  ensureCols_(getSheet_(SHEET_USERS), USER_COL_STAGES);
  getSheet_(SHEET_USERS).getRange(row, USER_COL_STAGES).setValue(JSON.stringify({ stg: stages.stg || {}, goal: stages.goal || {} }));
}

/**
 * 模試のあとに、到達 STAGE を進める（ロックの中で呼ぶ）
 * いまの STAGE の模試で合格したときだけ進む。返す値：{ unlocked: 'NORMAL' など, goal: true（今回はじめて到達） }
 */
function advanceStage_(me, level, judge, now) {
  const out = { unlocked: '', goal: false };
  if (!judge.ok || me.user.role === 'admin') return out;
  if (judge.stage !== userStage_(me.user, level)) return out;
  const stages = parseStages_(getSheet_(SHEET_USERS).getRange(me.row, USER_COL_STAGES).getValue());
  if (judge.next) {
    stages.stg[level] = judge.next;
    out.unlocked = judge.next;
  } else if (!stages.goal[level]) {
    stages.goal[level] = now.toISOString();
    out.goal = true;
  } else {
    return out;
  }
  writeUserStages_(me.row, stages);
  me.user.stages = stages;
  return out;
}

/** 【1回だけ実行】Questions シートの Q列・Users シートの N列・MockResults シートの L列に見出しを入れる */
function setupStage() {
  const q = getSheet_(SHEET_QUESTIONS);
  ensureStageHeader_(q);
  const rows = q.getMaxRows() - 1;
  q.getRange(2, Q_COL_STAGE, rows, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STAGES, true).setAllowInvalid(false).build())
    .setNumberFormat('@');
  q.setColumnWidth(Q_COL_STAGE, 80);
  ensureCols_(getSheet_(SHEET_USERS), USER_COL_STAGES);
  getSheet_(SHEET_USERS).getRange(1, USER_COL_STAGES).setValue('stages').setFontWeight('bold');
  const mr = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MOCK_RESULTS);
  if (mr) ensureCols_(mr, MR_COL_STAGE);
  if (mr) mr.getRange(1, MR_COL_STAGE).setValue('STAGE').setFontWeight('bold').setBackground('#FFE3EF');
  Logger.log('STAGE の列を用意しました（Questions の Q列：空の問題は EASY として出題されます）');
}

/** Questions シートの Q1 に見出しがなければ入れる */
function ensureStageHeader_(sheet) {
  ensureCols_(sheet, Q_COL_STAGE);
  const cell = sheet.getRange(1, Q_COL_STAGE);
  if (String(cell.getValue()) !== 'STAGE') cell.setValue('STAGE').setFontWeight('bold').setBackground('#FFF3CF');
}

/** 【管理者】受講生の STAGE を変える（HARD より前にすると、合格ライン到達の記録も消す） */
function adminSetStage_(token, userId, level, stage) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;
  level = String(level || '');
  stage = String(stage || '');
  if (LEVEL_LIST.indexOf(level) === -1) return { ok: false, message: 'レベルの指定が正しくありません。' };
  if (STAGES.indexOf(stage) === -1) return { ok: false, message: 'STAGE は EASY／NORMAL／HARD のどれかにしてください。' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const row = findUserRowById_(String(userId || ''));
    if (!row) return { ok: false, message: 'アカウントが見つかりません。' };
    const sheet = getSheet_(SHEET_USERS);
    const stages = parseStages_(sheet.getRange(row, USER_COL_STAGES).getValue());
    stages.stg[level] = stage;
    if (stage !== 'HARD') delete stages.goal[level];
    writeUserStages_(row, stages);
    return { ok: true, userId: userId, level: level, stage: stage };
  } finally {
    lock.releaseLock();
  }
}
