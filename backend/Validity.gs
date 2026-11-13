/**
 * R-ANGUAGE API - レベルごとの利用期限（1年間）
 *
 * - Users シートの O列（JSON）：{ exp: { N3: '期限の日時' }, rem: { N3: '30' または 'x' } }
 *     exp … レベルごとの利用期限。発行（入金の確認）した日から1年。期限内に更新すると、いまの期限から1年のばす
 *     rem … お知らせメールを送った記録（'30' ＝期限の30日前、'x' ＝期限切れ）。更新すると消す
 * - 期限が過ぎたレベルは使えない（ログインはできる。成績は残る）。マイページから更新の申し込みができる
 * - 期限の30日前から、更新の申し込みができる。毎日の dailyPaymentCheck の中で、30日前と期限切れのメールを送る
 * - 管理者アカウントには期限がない
 */

const USER_COL_VALID = 15;  // Users シートの O列
const RENEW_DAYS = 30;      // 期限の何日前から更新できるか・お知らせするか

/** O列の JSON を読む */
function parseValid_(v) {
  let o = {};
  try { o = JSON.parse(String(v || '{}')) || {}; } catch (e) { o = {}; }
  return { exp: o.exp || {}, rem: o.rem || {} };
}

function writeValid_(row, valid) {
  const sheet = getSheet_(SHEET_USERS);
  ensureCols_(sheet, USER_COL_VALID);
  sheet.getRange(row, USER_COL_VALID).setValue(JSON.stringify({ exp: valid.exp || {}, rem: valid.rem || {} }));
}

/** 1年後（2月29日は3月1日になる） */
function addYear_(d) {
  const x = new Date(d.getTime());
  x.setFullYear(x.getFullYear() + 1);
  return x;
}

/** そのレベルの期限（記録がなければ null） */
function levelExpiry_(valid, level) {
  const s = (valid.exp || {})[level];
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** そのレベルが使えるか（期限の記録がないレベルは、setupValidity を実行するまで使える） */
function levelActive_(valid, level, now) {
  const e = levelExpiry_(valid, level);
  return !e || e.getTime() > now.getTime();
}

/** 期限までの日数（切れていればマイナス） */
function daysLeft_(valid, level, now) {
  const e = levelExpiry_(valid, level);
  if (!e) return null;
  return Math.ceil((e.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

/** 更新の申し込みができるか（期限切れ、または期限の30日前から） */
function levelRenewable_(valid, level, now) {
  const d = daysLeft_(valid, level, now);
  return d !== null && d <= RENEW_DAYS;
}

/** レベルの期限を1年のばす（期限内なら、いまの期限から。切れていれば今日から） */
function extendLevels_(valid, levels, now) {
  levels.forEach(function (lv) {
    const cur = levelExpiry_(valid, lv);
    const base = cur && cur.getTime() > now.getTime() ? cur : now;
    valid.exp[lv] = addYear_(base).toISOString();
    delete valid.rem[lv];
  });
  return valid;
}

/** 受講生の画面に送る形：[{ level, expiresAt, active, daysLeft, renewable }] */
function validityList_(levels, valid, now) {
  return levels.map(function (lv) {
    const e = levelExpiry_(valid, lv);
    return {
      level: lv,
      expiresAt: e ? e.toISOString() : '',
      active: levelActive_(valid, lv, now),
      daysLeft: daysLeft_(valid, lv, now),
      renewable: levelRenewable_(valid, lv, now)
    };
  });
}

/** 期限を「2027年11月13日」の形にする */
function formatValid_(d) {
  return Utilities.formatDate(new Date(d), 'Asia/Tokyo', 'yyyy年M月d日');
}

/**
 * 【1回だけ実行】Users シートの O列に見出しを入れ、いま使えるレベルに期限（今日から1年）を入れる
 * もう期限が入っているレベルは変えないので、2回実行しても大丈夫
 */
function setupValidity() {
  const sheet = getSheet_(SHEET_USERS);
  ensureCols_(sheet, USER_COL_VALID);
  sheet.getRange(1, USER_COL_VALID).setValue('validity').setFontWeight('bold');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('受講生はいません'); return; }
  const now = new Date();
  const rows = sheet.getRange(2, 1, lastRow - 1, USER_COL_VALID).getValues();
  let count = 0;
  rows.forEach(function (r, i) {
    if (String(r[5]) !== 'user') return;
    const levels = String(r[7] || '').split(',').filter(String);
    if (!levels.length) return;
    const valid = parseValid_(r[USER_COL_VALID - 1]);
    const missing = levels.filter(function (lv) { return !levelExpiry_(valid, lv); });
    if (!missing.length) return;
    missing.forEach(function (lv) { valid.exp[lv] = addYear_(now).toISOString(); });
    writeValid_(i + 2, valid);
    count++;
  });
  Logger.log('利用期限の列を用意しました。期限を入れた受講生：' + count + '人（今日から1年：' + formatValid_(addYear_(now)) + 'まで）');
}

/**
 * 【毎日】期限の30日前のお知らせと、期限切れのお知らせを送る（dailyPaymentCheck から呼ぶ）
 */
function remindValidity_(now) {
  const sheet = getSheet_(SHEET_USERS);
  if (sheet.getMaxColumns() < USER_COL_VALID) return { soon: 0, expired: 0 };
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { soon: 0, expired: 0 };
  const rows = sheet.getRange(2, 1, lastRow - 1, USER_COL_VALID).getValues();
  const mails = [];
  rows.forEach(function (r, i) {
    if (String(r[5]) !== 'user' || String(r[6]) !== 'active') return;
    const levels = String(r[7] || '').split(',').filter(String);
    const valid = parseValid_(r[USER_COL_VALID - 1]);
    let changed = false;
    levels.forEach(function (lv) {
      const d = daysLeft_(valid, lv, now);
      if (d === null) return;
      if (d <= 0 && valid.rem[lv] !== 'x') {
        valid.rem[lv] = 'x'; changed = true;
        mails.push({ kind: 'expired', email: String(r[1]), name: String(r[4]), level: lv, exp: levelExpiry_(valid, lv) });
      } else if (d > 0 && d <= RENEW_DAYS && !valid.rem[lv]) {
        valid.rem[lv] = '30'; changed = true;
        mails.push({ kind: 'soon', email: String(r[1]), name: String(r[4]), level: lv, exp: levelExpiry_(valid, lv) });
      }
    });
    if (changed) writeValid_(i + 2, valid);
  });
  mails.forEach(sendValidityMail_);
  const soon = mails.filter(function (m) { return m.kind === 'soon'; }).length;
  Logger.log('利用期限のお知らせ：30日前 ' + soon + '件・期限切れ ' + (mails.length - soon) + '件');
  return { soon: soon, expired: mails.length - soon };
}

function sendValidityMail_(m) {
  const soon = m.kind === 'soon';
  MailApp.sendEmail({
    to: m.email,
    subject: soon
      ? '【R-ANGUAGE】' + m.level + ' の利用期限が近づいています（' + formatValid_(m.exp) + 'まで）'
      : '【R-ANGUAGE】' + m.level + ' の利用期限が過ぎました',
    name: 'R-ANGUAGE',
    body: [
      m.name + ' 様',
      '',
      'いつも R-ANGUAGE をご利用いただき、ありがとうございます。',
      soon
        ? m.level + ' の利用期限は ' + formatValid_(m.exp) + ' までです。'
        : m.level + ' の利用期限（' + formatValid_(m.exp) + '）が過ぎたため、' + m.level + ' の問題・単語カード・模擬試験が使えなくなりました。',
      soon
        ? '続けてお使いになる場合は、マイページの「使えるレベル」から更新のお申し込みができます（1年間・新規と同じ料金）。期限内に更新すると、いまの期限から1年のびます。'
        : 'これまでの成績は残っています。マイページの「使えるレベル」から更新のお申し込みをして、入金を確認すると、また使えるようになります。',
      '',
      'マイページ：https://jprojectsriki-cpu.github.io/r-anguage/frontend/user/app.html#mypage',
      '',
      '----------------------------------------',
      'R-ANGUAGE｜JLPT N4〜N1 日本語学習システム'
    ].join('\n')
  });
}

/** 【管理者】レベルの利用期限を変える（問い合わせの対応用）。date は「2027-11-13」の形 */
function adminSetValidity_(token, userId, level, date) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;
  level = String(level || '');
  date = String(date || '').trim();
  if (LEVEL_LIST.indexOf(level) === -1) return { ok: false, message: 'レベルの指定が正しくありません。' };
  const m = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return { ok: false, message: '期限は「2027-11-13」の形で入力してください。' };
  // その日の終わり（日本時間 23:59）まで使えるようにする
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 14, 59, 0));
  if (isNaN(d.getTime())) return { ok: false, message: '期限の日付が正しくありません。' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const row = findUserRowById_(String(userId || ''));
    if (!row) return { ok: false, message: 'アカウントが見つかりません。' };
    const sheet = getSheet_(SHEET_USERS);
    const levels = String(sheet.getRange(row, 8).getValue() || '').split(',').filter(String);
    if (levels.indexOf(level) === -1) return { ok: false, message: 'このアカウントは ' + level + ' を持っていません。' };
    ensureCols_(sheet, USER_COL_VALID);
    const valid = parseValid_(sheet.getRange(row, USER_COL_VALID).getValue());
    valid.exp[level] = d.toISOString();
    delete valid.rem[level];
    writeValid_(row, valid);
    return { ok: true, userId: userId, level: level, expiresAt: d.toISOString() };
  } finally {
    lock.releaseLock();
  }
}
