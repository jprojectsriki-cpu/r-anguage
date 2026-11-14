/**
 * テスト用アカウントの片づけ
 *
 * 使い方（GASのエディタで実行）：
 *   1. previewCleanup … 消す予定のアカウントと、各シートで消える行の数をログに出す（何も消さない）
 *   2. runCleanup     … 実際に消す（元に戻せない）
 *
 * 消す対象：
 *   - メールアドレスに「+ratest」を含むアカウント（+ratest・+ratest2・+ratest3・+ratest4 など）
 *   - CLEANUP_EXTRA_EMAILS に書いたメールアドレスのアカウント
 *   - CLEANUP_ADMIN_RECORDS が true なら、管理者アカウントの学習の記録（アカウントそのものは消さない）
 *
 * 消すもの：Users・Applications・UserData・Answers・Favorites・VocabProgress・MockResults の行、
 *           月ごとの「R-ANGUAGE 回答の記録」ファイルの行、ログインの記録（キャッシュ）
 * 消さないもの：問題・単語カード・お知らせ・試験日、ほかの受講生のデータ
 */

const CLEANUP_MATCH = '+ratest';     // メールアドレスにこの文字が入っていたら対象
const CLEANUP_EXTRA_EMAILS = [];      // ほかに消したいアカウントがあれば 'xxx@gmail.com' のように書く
const CLEANUP_ADMIN_RECORDS = true;   // 管理者アカウントの学習の記録も消す（アカウントは残す）

function previewCleanup() { cleanup_(false); }
function runCleanup() { cleanup_(true); }

function cleanup_(doDelete) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const t = cleanupTargets_();
    const log = [];
    log.push(doDelete ? '【実行】次のデータを消しました' : '【確認だけ】runCleanup を実行すると、次のデータを消します（まだ何も消していません）');
    log.push('');
    log.push('■ 消すアカウント：' + t.accounts.length + '人');
    t.accounts.forEach(function (u) { log.push('  ・' + u.email + '（' + (u.levels || 'レベルなし') + '・' + u.status + '）'); });
    if (t.admins.length) {
      log.push('■ 学習の記録だけ消す管理者アカウント：' + t.admins.length + '人');
      t.admins.forEach(function (u) { log.push('  ・' + u.email); });
    }
    log.push('■ 残るアカウント（受講生）：' + t.keep.length + '人');
    t.keep.forEach(function (u) { log.push('  ・' + u.email + '（' + (u.levels || 'レベルなし') + '・' + u.status + '）'); });
    log.push('');

    if (!t.accounts.length && !t.admins.length) {
      log.push('消すものはありません。');
      Logger.log(log.join('\n'));
      return;
    }

    const all = {};     // アカウントごと消す userId
    t.accounts.forEach(function (u) { all[u.userId] = true; });
    const rec = {};     // 学習の記録を消す userId（アカウントごと消す人＋管理者）
    Object.keys(all).forEach(function (id) { rec[id] = true; });
    t.admins.forEach(function (u) { rec[u.userId] = true; });
    const emails = {};
    t.accounts.forEach(function (u) { emails[u.email] = true; });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    log.push('■ 消える行の数');
    log.push('  Users：' + cleanupRows_(ss.getSheetByName(SHEET_USERS), function (r) { return all[String(r[0])]; }, doDelete) + '行');
    log.push('  Applications：' + cleanupRows_(ss.getSheetByName(SHEET_APPLICATIONS), function (r) {
      return all[String(r[1])] || emails[String(r[2]).trim().toLowerCase()];
    }, doDelete) + '行');
    log.push('  UserData：' + cleanupRows_(ss.getSheetByName(SHEET_USER_DATA), function (r) {
      return rec[String(r[0]).split('|')[0]];
    }, doDelete) + '行');
    [SHEET_ANSWERS, SHEET_FAVORITES, SHEET_VOCAB_PROGRESS].forEach(function (name) {
      log.push('  ' + name + '：' + cleanupRows_(ss.getSheetByName(name), function (r) { return rec[String(r[0])]; }, doDelete) + '行');
    });
    log.push('  MockResults：' + cleanupRows_(ss.getSheetByName(SHEET_MOCK_RESULTS), function (r) { return rec[String(r[1])]; }, doDelete) + '行');

    // 月ごとの「回答の記録」ファイル
    const props = PropertiesService.getScriptProperties().getProperties();
    Object.keys(props).sort().forEach(function (k) {
      if (k.indexOf('ANSWER_LOG_') !== 0 || /_PART$/.test(k)) return;
      let file;
      try { file = SpreadsheetApp.openById(props[k]); } catch (e) { log.push('  ' + k + '：ファイルを開けませんでした'); return; }
      const sh = file.getSheetByName(SHEET_ANSWERS) || file.getSheets()[0];
      log.push('  ' + file.getName() + '：' + cleanupRows_(sh, function (r) { return rec[String(r[0])]; }, doDelete) + '行');
    });

    if (doDelete) {
      const cache = CacheService.getScriptCache();
      Object.keys(rec).forEach(function (id) {
        cache.removeAll(['current_' + id, 'udrow:' + id + '|ans', 'udrow:' + id + '|voc', 'udrow:' + id + '|sum']);
      });
      log.push('');
      log.push('片づけが終わりました。');
    }
    Logger.log(log.join('\n'));
  } finally {
    lock.releaseLock();
  }
}

/** 消す対象のアカウントを Users シートから探す */
function cleanupTargets_() {
  const sh = getSheet_(SHEET_USERS);
  const last = sh.getLastRow();
  const extra = {};
  CLEANUP_EXTRA_EMAILS.forEach(function (e) { extra[String(e).trim().toLowerCase()] = true; });
  const res = { accounts: [], admins: [], keep: [] };
  if (last < 2) return res;
  sh.getRange(2, 1, last - 1, 8).getValues().forEach(function (r) {
    const u = { userId: String(r[0]), email: String(r[1]).trim().toLowerCase(), role: String(r[5]), status: String(r[6]), levels: String(r[7]) };
    if (!u.userId) return;
    if (u.role === 'admin') {
      if (CLEANUP_ADMIN_RECORDS) res.admins.push(u);
      return;
    }
    if (u.email.indexOf(CLEANUP_MATCH) >= 0 || extra[u.email]) res.accounts.push(u);
    else res.keep.push(u);
  });
  return res;
}

/** 条件に合う行を数える（doDelete なら下から消す）。見出しの1行目は残す */
function cleanupRows_(sh, match, doDelete) {
  if (!sh) return 0;
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const width = Math.max(1, Math.min(sh.getLastColumn(), 3));
  const rows = sh.getRange(2, 1, last - 1, width).getValues();
  const hits = [];
  rows.forEach(function (r, i) { if (match(r)) hits.push(i + 2); });
  if (doDelete && hits.length) {
    // つながった行はまとめて消す（下から）
    let end = hits[hits.length - 1], start = end;
    for (let i = hits.length - 2; i >= -1; i--) {
      if (i >= 0 && hits[i] === start - 1) { start = hits[i]; continue; }
      if (start === 2 && end === last && sh.getMaxRows() <= last) sh.insertRowAfter(last); // 最後の行まで全部消すときは、1行足してから
      sh.deleteRows(start, end - start + 1);
      if (i >= 0) { end = hits[i]; start = end; }
    }
  }
  return hits.length;
}
