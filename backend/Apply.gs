/**
 * R-anguage API - 申し込み
 */

// レベルごとの料金（税込・買い切り）
const PRICES = { N4: 3000, N3: 3500, N2: 4000, N1: 4500 };
const PAYMENT_METHODS = { konbini: 'コンビニ払い', bank_transfer: '銀行振込' };
const PAYMENT_DAYS = 7; // 支払期限（日）

/** 申込番号を作る（例：RA-20261024-K7Q2） */
function makeApplicationId_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 見間違えやすい O/0/I/1 は使わない
  let rand = '';
  for (let i = 0; i < 4; i++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
  const date = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  return 'RA-' + date + '-' + rand;
}

/** メールアドレスがUsersに登録済みか */
function emailExists_(email) {
  const sheet = getSheet_(SHEET_USERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  return sheet.getRange(2, 2, lastRow - 1, 1).getValues()
    .some(function (r) { return String(r[0]).trim().toLowerCase() === email; });
}

/** 申し込みを受け付ける */
function apply_(req) {
  const level = String(req.level || '');
  const payment = String(req.payment || '');
  const name = String(req.name || '').trim();
  const email = String(req.email || '').trim().toLowerCase();
  const password = String(req.password || '');

  // ---- 入力チェック ----
  if (!PRICES[level]) return { ok: false, message: 'レベルを選択してください。' };
  if (!PAYMENT_METHODS[payment]) return { ok: false, message: 'お支払い方法を選択してください。' };
  if (!name || name.length > 50) return { ok: false, message: 'お名前を50文字以内で入力してください。' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return { ok: false, message: 'メールアドレスの形式を確認してください。' };
  }
  if (password.length < 8 || password.length > 64) {
    return { ok: false, message: 'パスワードは8〜64文字で入力してください。' };
  }

  // ---- 登録（同時に申し込みが来ても重ならないよう、順番に処理する） ----
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let application;
  try {
    if (emailExists_(email)) {
      return {
        ok: false,
        message: 'このメールアドレスはすでに登録されています。レベルの追加は、ログイン後のマイページからお申し込みください。'
      };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAYMENT_DAYS * 24 * 60 * 60 * 1000);
    const userId = Utilities.getUuid();
    const salt = generateSalt_();

    getSheet_(SHEET_USERS).appendRow([
      userId, email, hashPassword_(password, salt), salt, name,
      'user',      // role
      'pending',   // status（入金待ち）
      '',          // levels（発行時に追加する）
      now, '', ''  // createdAt, activatedAt, lastLoginAt
    ]);

    application = {
      applicationId: makeApplicationId_(),
      level: level,
      amount: PRICES[level],
      payment: payment,
      expiresAt: expiresAt
    };
    getSheet_(SHEET_APPLICATIONS).appendRow([
      application.applicationId, userId, email, name, level, application.amount,
      payment, 'awaiting_payment', now, expiresAt, '', '', '', ''
    ]);
  } finally {
    lock.releaseLock();
  }

  sendApplyMails_(name, email, application);

  return {
    ok: true,
    applicationId: application.applicationId,
    expiresAt: application.expiresAt.toISOString()
  };
}

/** 受付メール（申込者あて）と、新着通知（管理者あて）を送る */
function sendApplyMails_(name, email, a) {
  const deadline = Utilities.formatDate(a.expiresAt, 'Asia/Tokyo', 'yyyy年M月d日 HH:mm');
  const amount = a.amount.toLocaleString('ja-JP');

  MailApp.sendEmail({
    to: email,
    subject: '【R-anguage】お申し込みを受け付けました（' + a.applicationId + '）',
    name: 'R-anguage',
    body: [
      name + ' 様',
      '',
      'R-anguage にお申し込みいただき、ありがとうございます。',
      '以下の内容でお申し込みを受け付けました。',
      '',
      '■ 申込番号：' + a.applicationId,
      '■ レベル　：' + a.level,
      '■ 金額　　：' + amount + '円（税込・買い切り）',
      '■ お支払い：' + PAYMENT_METHODS[a.payment],
      '■ 支払期限：' + deadline,
      '',
      'お支払い方法のご案内は、追ってメールでお送りします。',
      '銀行振込の場合は、振込名義の前に申込番号を付けてください。',
      '',
      'お支払いを確認したあと、アカウントを発行してメールでお知らせします。',
      'ログインには、お申し込み時に設定したパスワードをお使いください。',
      '',
      '※ 支払期限を過ぎると、お申し込みは自動的に取り消されます。',
      '※ このメールに心当たりがない場合は、このメールを破棄してください。',
      '',
      '----------------------------------------',
      'R-anguage｜JLPT N4〜N1 日本語学習システム',
      'https://jprojectsriki-cpu.github.io/r-anguage/frontend/user/'
    ].join('\n')
  });

  const adminEmail = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');
  if (adminEmail) {
    MailApp.sendEmail({
      to: adminEmail,
      subject: '【R-anguage管理】新しいお申し込み（' + a.applicationId + '）',
      name: 'R-anguage',
      body: [
        '新しいお申し込みがありました。',
        '',
        '申込番号：' + a.applicationId,
        'お名前　：' + name,
        'メール　：' + email,
        'レベル　：' + a.level + '（' + amount + '円）',
        'お支払い：' + PAYMENT_METHODS[a.payment],
        '支払期限：' + deadline
      ].join('\n')
    });
  }
}

/**
 * 【テスト用】申込の動作確認
 * 管理者のメールアドレスに「+ratest」を付けたアドレスで申し込む
 * （Gmailは「名前+好きな文字@gmail.com」宛のメールも、本人の受信箱に届く）
 */
function testApply() {
  const adminEmail = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');
  const testEmail = adminEmail.replace('@', '+ratest@');

  const res1 = apply_({ level: 'N3', payment: 'bank_transfer', name: 'テスト 太郎', email: testEmail, password: 'testpass123' });
  Logger.log('① 1回目の申込 → ' + JSON.stringify(res1));

  const res2 = apply_({ level: 'N2', payment: 'konbini', name: 'テスト 太郎', email: testEmail, password: 'testpass123' });
  Logger.log('② 同じメールで2回目 → ' + JSON.stringify(res2));

  const res3 = apply_({ level: 'N5', payment: 'konbini', name: 'テスト', email: 'x@example.com', password: 'testpass123' });
  Logger.log('③ 存在しないレベル → ' + JSON.stringify(res3));
}