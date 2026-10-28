/**
 * R-anguage API - パスワード再設定
 * - 再設定メールのリンクは30分間有効・1回だけ使える
 * - 登録されていないメールアドレスでも、同じ返事を返す（登録の有無を知られないため）
 */

const RESET_TTL_SEC = 30 * 60;      // リンクの有効時間（30分）
const RESET_MAX_PER_HOUR = 3;       // 同じメールアドレスで1時間に申し込める回数
const RESET_PAGE_URL = 'https://jprojectsriki-cpu.github.io/r-anguage/frontend/user/reset.html';
const RESET_LOGIN_URL = 'https://jprojectsriki-cpu.github.io/r-anguage/frontend/user/login.html';
const RESET_PW_MIN = 8;
const RESET_PW_MAX = 64;      // 申込（Apply.gs）と同じ8〜64文字

const RESET_SENT_MESSAGE = 'ご入力のメールアドレスが登録されている場合は、パスワード再設定のご案内をメールでお送りしました。メールに書かれたリンクから、30分以内に新しいパスワードを設定してください。';
const RESET_INVALID_MESSAGE = 'このリンクは使えません。有効期限（30分）が過ぎたか、すでに使われたリンクです。お手数ですが、もう一度パスワード再設定のお手続きをしてください。';

/** 再設定の申し込み：メールアドレスが有効なアカウントなら、再設定メールを送る */
function requestPasswordReset_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'メールアドレスを確認してください。' };
  }

  const cache = CacheService.getScriptCache();

  // 同じメールアドレスでの申し込みが多すぎるときは、メールを送らない（返事は同じ）
  const countKey = 'resetreq_' + email;
  const count = Number(cache.get(countKey) || 0);
  if (count >= RESET_MAX_PER_HOUR) return { ok: true, message: RESET_SENT_MESSAGE };
  cache.put(countKey, String(count + 1), 60 * 60);

  const user = findUserByEmail_(email);
  if (!user || user.status !== 'active') return { ok: true, message: RESET_SENT_MESSAGE };

  // 前に送ったリンクは使えなくする
  const oldToken = cache.get('resetuser_' + user.userId);
  if (oldToken) cache.remove('reset_' + oldToken);

  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('reset_' + token, JSON.stringify({ userId: user.userId, email: user.email }), RESET_TTL_SEC);
  cache.put('resetuser_' + user.userId, token, RESET_TTL_SEC);

  sendResetMail_(user, token);
  return { ok: true, message: RESET_SENT_MESSAGE };
}

/** リンクがまだ使えるかを確認する（再設定ページを開いたときに使う） */
function checkResetToken_(token) {
  const raw = token ? CacheService.getScriptCache().get('reset_' + token) : null;
  if (!raw) return { ok: false, reason: 'invalid', message: RESET_INVALID_MESSAGE };
  const data = JSON.parse(raw);
  return { ok: true, email: resetMaskEmail_(data.email) };
}

/** 新しいパスワードを設定する */
function resetPassword_(token, password) {
  password = String(password || '');
  if (password.length < RESET_PW_MIN) return { ok: false, message: 'パスワードは' + RESET_PW_MIN + '文字以上で入力してください。' };
  if (password.length > RESET_PW_MAX) return { ok: false, message: 'パスワードは' + RESET_PW_MAX + '文字以内で入力してください。' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let user;
  try {
    const cache = CacheService.getScriptCache();
    const raw = token ? cache.get('reset_' + token) : null;
    if (!raw) return { ok: false, reason: 'invalid', message: RESET_INVALID_MESSAGE };
    const data = JSON.parse(raw);

    user = findUserByEmail_(String(data.email).toLowerCase());
    if (!user || user.userId !== data.userId || user.status !== 'active') {
      cache.remove('reset_' + token);
      return { ok: false, reason: 'invalid', message: RESET_INVALID_MESSAGE };
    }

    // パスワードを保存（C列：passwordHash、D列：salt）
    const salt = generateSalt_();
    getSheet_(SHEET_USERS).getRange(user.row, 3, 1, 2).setValues([[hashPassword_(password, salt), salt]]);

    // リンクを使えなくする・ログイン中の端末をログアウトさせる・ログイン失敗の回数を消す
    cache.remove('reset_' + token);
    cache.remove('resetuser_' + user.userId);
    cache.remove('current_' + user.userId);
    cache.remove('loginfail_' + String(user.email).toLowerCase());
  } finally {
    lock.releaseLock();
  }

  sendResetDoneMail_(user);
  return { ok: true, message: '新しいパスワードを設定しました。ログインページから、新しいパスワードでログインしてください。' };
}

/** メールアドレスの一部を隠す（例：ri****@example.com） */
function resetMaskEmail_(email) {
  const parts = String(email).split('@');
  const name = parts[0] || '';
  return name.slice(0, 2) + '****@' + (parts[1] || '');
}

/** 再設定メールを送る */
function sendResetMail_(user, token) {
  MailApp.sendEmail({
    to: user.email,
    subject: '【R-anguage】パスワード再設定のご案内',
    name: 'R-anguage',
    body: [
      user.name + ' 様',
      '',
      'R-anguage のパスワード再設定のお申し込みを受け付けました。',
      '下のリンクを開いて、新しいパスワードを設定してください。',
      '',
      RESET_PAGE_URL + '?token=' + token,
      '',
      '※ このリンクの有効期限は、メールの送信から30分です。',
      '※ このリンクは1回だけ使えます。',
      '※ 心当たりがない場合は、このメールを無視してください。パスワードは変わりません。',
      '',
      '----------------------------------------',
      'R-anguage｜JLPT N4〜N1 日本語学習システム'
    ].join('\n')
  });
}

/** パスワードを変更したことを知らせるメールを送る */
function sendResetDoneMail_(user) {
  MailApp.sendEmail({
    to: user.email,
    subject: '【R-anguage】パスワードを変更しました',
    name: 'R-anguage',
    body: [
      user.name + ' 様',
      '',
      'R-anguage のパスワードを変更しました。',
      'ログイン中だった端末は、安全のためログアウトしています。',
      '新しいパスワードで、もう一度ログインしてください。',
      '',
      RESET_LOGIN_URL,
      '',
      '※ 心当たりがない場合は、すぐにパスワード再設定のお手続きをしてください。',
      '',
      '----------------------------------------',
      'R-anguage｜JLPT N4〜N1 日本語学習システム'
    ].join('\n')
  });
}

/**
 * 【テスト用】パスワード再設定の動作確認
 * - R-anguageの管理者アカウントで、パスワードを「今と同じパスワード」に設定し直して確認する（パスワードは変わらない）
 * - 管理者のメールアドレスに、「パスワード再設定のご案内」と「パスワードを変更しました」の2通が届く
 * 事前に、スクリプト プロパティに TEST_PASSWORD（R-anguageの管理者パスワード）を入れておくこと
 */
function testReset() {
  const props = PropertiesService.getScriptProperties();
  const password = props.getProperty('TEST_PASSWORD');
  const email = String(props.getProperty('ADMIN_EMAIL') || '').trim().toLowerCase();
  if (!password) throw new Error('スクリプト プロパティに TEST_PASSWORD（R-anguageの管理者パスワード）を設定してください。');

  // 最初に、TEST_PASSWORD が今の管理者パスワードと同じかを確かめる（違うときは何も変えずに止める）
  const before = login_(email, password);
  if (!before.ok) throw new Error('TEST_PASSWORD が R-anguageの管理者パスワードと一致しません。何も変更せずに止めました：' + before.message);
  logout_(before.token);

  const cache = CacheService.getScriptCache();
  cache.remove('resetreq_' + email); // テストのために、申し込み回数を0にもどす

  // ① 登録されていないメールアドレス → 同じ返事で、メールは送らない
  Logger.log('① 未登録のアドレス → ' + JSON.stringify(requestPasswordReset_('no-such-user@example.com')));

  // ② 管理者のメールアドレス → 再設定メールを送る
  Logger.log('② 申し込み → ' + JSON.stringify(requestPasswordReset_(email)));
  const user = findUserByEmail_(email);
  const token = cache.get('resetuser_' + user.userId);

  // ③ リンクの確認
  Logger.log('③ リンクの確認 → ' + JSON.stringify(checkResetToken_(token)));
  Logger.log('③ でたらめなリンク → ' + JSON.stringify(checkResetToken_('abc')));

  // ④ 短すぎるパスワードは設定できない
  Logger.log('④ 短いパスワード → ' + JSON.stringify(resetPassword_(token, 'short')));

  // ⑤ 今と同じパスワードで設定し直す（パスワードは変わらない）
  Logger.log('⑤ 再設定 → ' + JSON.stringify(resetPassword_(token, password)));

  // ⑥ 同じリンクは2回使えない
  Logger.log('⑥ 2回目 → ' + JSON.stringify(resetPassword_(token, password)));

  // ⑦ 管理者パスワードでログインできるか
  const after = login_(email, password);
  Logger.log('⑦ ログイン → ok:' + after.ok);
  if (after.ok) logout_(after.token);

  cache.remove('resetreq_' + email);
  props.deleteProperty('TEST_PASSWORD');
  Logger.log('TEST_PASSWORD を削除しました');
}
