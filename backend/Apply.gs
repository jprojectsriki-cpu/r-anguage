/**
 * R-ANGUAGE API - 申し込み
 * - お支払いは銀行振込だけ（2026-11-03〜）。振込先は、スクリプト プロパティ BANK_INFO に入れる（コードには書かない）
 * - 期限切れ・キャンセルで「入金待ち」のまま残ったアカウントは、同じメールアドレスで申し込み直せる
 */

// レベルごとの料金（税込・買い切り）
const PRICES = { N4: 3000, N3: 3500, N2: 4000, N1: 4500 };
// お支払い方法の名前（konbini は、銀行振込だけにする前の申込を表示するために残す）
const PAYMENT_METHODS = { bank_transfer: '銀行振込', konbini: 'コンビニ払い' };
const PAYMENT_DEFAULT = 'bank_transfer'; // 新しい申込は、すべて銀行振込
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
  const payment = PAYMENT_DEFAULT; // 画面から何が送られても、銀行振込で受け付ける
  const name = String(req.name || '').trim();
  const email = String(req.email || '').trim().toLowerCase();
  const password = String(req.password || '');

  // ---- 入力チェック ----
  if (!PRICES[level]) return { ok: false, message: 'レベルを選択してください。' };
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
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAYMENT_DAYS * 24 * 60 * 60 * 1000);
    const salt = generateSalt_();
    let userId;

    const existing = findUserByEmail_(email);
    if (existing) {
      // 利用中・停止中のアカウントは、新しく申し込めない
      if (existing.status !== 'pending') {
        return {
          ok: false,
          message: 'このメールアドレスはすでに登録されています。レベルの追加は、ログイン後のマイページからお申し込みください。'
        };
      }

      // 「入金待ち」のアカウント：お支払い待ちの申込がまだ有効なら、二重の申し込みを防ぐ
      const apps = readApplications_().filter(function (a) { return a.userId === existing.userId; });
      const open = apps.filter(function (a) {
        if (a.status === 'paid') return true;
        return a.status === 'awaiting_payment' && a.expiresAt && new Date(a.expiresAt).getTime() > now.getTime();
      });
      if (open.length) {
        return {
          ok: false,
          message: 'このメールアドレスでは、お支払い待ちのお申し込み（' + open[0].applicationId + '）があります。受付メールに書かれた支払期限までにお支払いください。'
        };
      }

      // 期限が過ぎたのに、まだ「入金待ち」のままの申込は、ここで「期限切れ」にする（期限切れメールは送らない）
      const appSheet = getSheet_(SHEET_APPLICATIONS);
      const stamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
      apps.filter(function (a) { return a.status === 'awaiting_payment'; }).forEach(function (a) {
        appSheet.getRange(a.row, 8).setValue('expired');
        appSheet.getRange(a.row, 14).setValue((a.note ? a.note + '\n' : '') + '[' + stamp + ' 期限切れ（申し込み直しのため）]');
      });

      // 期限切れ・キャンセルで残っていたアカウントを、新しい内容で使い直す（C：passwordHash、D：salt、E：name）
      userId = existing.userId;
      getSheet_(SHEET_USERS).getRange(existing.row, 3, 1, 3).setValues([[hashPassword_(password, salt), salt, name]]);
    } else {
      userId = Utilities.getUuid();
      getSheet_(SHEET_USERS).appendRow([
        userId, email, hashPassword_(password, salt), salt, name,
        'user',      // role
        'pending',   // status（入金待ち）
        '',          // levels（発行時に追加する）
        now, '', ''  // createdAt, activatedAt, lastLoginAt
      ]);
    }

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

/**
 * 振込先の案内（受付メール・リマインドメールで使う）
 * 振込先は、スクリプト プロパティ BANK_INFO（例：「〇〇銀行 〇〇支店 普通 1234567 ナカムラ リキ」）
 */
function bankLines_(applicationId) {
  const bank = String(PropertiesService.getScriptProperties().getProperty('BANK_INFO') || '').trim();
  const code = String(applicationId || '').slice(-4);
  if (!bank) return ['振込先の口座は、追ってメールでお知らせします。'];
  return [
    '■ 振込先　：' + bank,
    '',
    '振込名義（お名前）の前に、申込番号の最後の4文字「' + code + '」を付けてください。',
    '（例：' + code + ' ヤマダ タロウ）',
    '振込手数料は、お客様のご負担となります。',
    '',
    '【ATMでの振り込み方】',
    '1. 銀行のATMで「振込」を選びます。',
    '2. 上の「振込先」の銀行・支店・口座の種類（普通）・口座番号を入れます。',
    '3. 金額を入れます（上の「金額」と同じ）。',
    '4. 振込名義（あなたの名前）の前に「' + code + '」を入れます。',
    '5. 内容を確かめて、お金を払います（現金か、キャッシュカード）。',
    '6. 明細書（レシート）は、アカウントが届くまで捨てないでください。',
    '※ コンビニのATMは、キャッシュカードがないと振り込めないことがあります。現金のときは、銀行のATMを使ってください。',
    '※ わからないときは、銀行の窓口で、このメールを見せてください。',
    '',
    '[How to pay at an ATM]',
    '1. At a bank ATM, choose "振込" (Transfer).',
    '2. Enter the bank, branch, account type (普通 = ordinary) and account number shown in "振込先" above.',
    '3. Enter the amount shown in "金額" above.',
    '4. Before your name (振込名義), enter "' + code + '". Your name is entered in katakana. Example: ' + code + ' ヤマダ タロウ',
    '5. Check the details and pay (cash or cash card).',
    '6. Keep the receipt (明細書) until you receive your account email.',
    '* Convenience store ATMs often accept transfers only with a cash card. To pay in cash, please use a bank ATM.',
    '* If you are not sure, show this email to the staff at the bank counter.'
  ];
}

/** 【確認用】振込先（BANK_INFO）が入っているかをログに出す */
function checkBankInfo() {
  const bank = PropertiesService.getScriptProperties().getProperty('BANK_INFO');
  Logger.log('BANK_INFO：' + (bank ? '入っています' : 'まだです（スクリプト プロパティに入れてください）'));
  Logger.log(bankLines_('RA-20261103-AB12').join('\n'));
}

/** 受付メール（申込者あて）と、新着通知（管理者あて）を送る */
function sendApplyMails_(name, email, a) {
  const deadline = Utilities.formatDate(a.expiresAt, 'Asia/Tokyo', 'yyyy年M月d日 HH:mm');
  const amount = a.amount.toLocaleString('ja-JP');

  MailApp.sendEmail({
    to: email,
    subject: '【R-ANGUAGE】お申し込みを受け付けました（' + a.applicationId + '）',
    name: 'R-ANGUAGE',
    body: [
      name + ' 様',
      '',
      'R-ANGUAGE にお申し込みいただき、ありがとうございます。',
      '以下の内容でお申し込みを受け付けました。',
      '',
      '■ 申込番号：' + a.applicationId,
      '■ レベル　：' + a.level,
      '■ 金額　　：' + amount + '円（税込・買い切り）',
      '■ お支払い：' + PAYMENT_METHODS[a.payment],
      '■ 支払期限：' + deadline,
      '',
    ].concat(bankLines_(a.applicationId)).concat([
      '',
      'お支払いを確認したあと、アカウントを発行してメールでお知らせします。',
      'ログインには、お申し込み時に設定したパスワードをお使いください。',
      '',
      '※ 支払期限を過ぎると、お申し込みは自動的に取り消されます。',
      '※ このメールに心当たりがない場合は、このメールを破棄してください。',
      '',
      '----------------------------------------',
      'R-ANGUAGE｜JLPT N4〜N1 日本語学習システム',
      'https://jprojectsriki-cpu.github.io/r-anguage/frontend/user/'
    ]).join('\n')
  });

  const adminEmail = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');
  if (adminEmail) {
    MailApp.sendEmail({
      to: adminEmail,
      subject: '【R-ANGUAGE管理】新しいお申し込み（' + a.applicationId + '）',
      name: 'R-ANGUAGE',
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

  const res2 = apply_({ level: 'N2', payment: 'bank_transfer', name: 'テスト 太郎', email: testEmail, password: 'testpass123' });
  Logger.log('② 同じメールで2回目 → ' + JSON.stringify(res2));

  const res3 = apply_({ level: 'N5', payment: 'bank_transfer', name: 'テスト', email: 'x@example.com', password: 'testpass123' });
  Logger.log('③ 存在しないレベル → ' + JSON.stringify(res3));
}