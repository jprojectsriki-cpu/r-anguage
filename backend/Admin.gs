/**
 * R-anguage API - 管理者用（申込一覧・発行）
 */

/** 管理者かどうかを確かめる */
function requireAdmin_(token) {
  const auth = checkSession_(token);
  if (!auth.ok) return auth;
  if (auth.user.role !== 'admin') {
    return { ok: false, reason: 'forbidden', message: '管理者のみ利用できます。' };
  }
  return auth;
}

/** Applicationsシートを読み込んで、オブジェクトの配列にする */
function readApplications_() {
  const sheet = getSheet_(SHEET_APPLICATIONS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 14).getValues().map(function (r, i) {
    return {
      row: i + 2,
      applicationId: String(r[0]),
      userId: String(r[1]),
      email: String(r[2]),
      name: String(r[3]),
      level: String(r[4]),
      amount: Number(r[5]),
      paymentMethod: String(r[6]),
      status: String(r[7]),
      createdAt: r[8] || null,
      expiresAt: r[9] || null,
      paidAt: r[10] || null,
      issuedAt: r[11] || null,
      note: String(r[13] || '')
    };
  });
}

/** userId から Users の行を探す（見つからなければ null） */
function findUserRowById_(userId) {
  const sheet = getSheet_(SHEET_USERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === userId) return i + 2;
  }
  return null;
}

/** 【管理者】申込の一覧（status を指定すると絞り込み。新しい順） */
function adminListApplications_(token, status) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;

  let list = readApplications_();
  if (status) list = list.filter(function (a) { return a.status === status; });
  list.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });

  return {
    ok: true,
    applications: list.map(function (a) { delete a.row; return a; })
  };
}

/** 【管理者】入金を確認して、アカウントを発行する */
function adminIssue_(token, applicationId) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let app;
  try {
    app = readApplications_().filter(function (a) { return a.applicationId === applicationId; })[0];
    if (!app) return { ok: false, message: '申込が見つかりません。' };

    const blocked = { issued: '発行済み', expired: '期限切れ', cancelled: 'キャンセル済み' };
    if (blocked[app.status]) {
      return { ok: false, message: 'この申込は「' + blocked[app.status] + '」のため発行できません。' };
    }

    const userRow = findUserRowById_(app.userId);
    if (!userRow) return { ok: false, message: 'アカウントが見つかりません。' };

    const users = getSheet_(SHEET_USERS);
    const u = users.getRange(userRow, 1, 1, 11).getValues()[0];
    if (String(u[6]) === 'suspended') {
      return { ok: false, message: 'このアカウントは停止中のため発行できません。先に停止を解除してください。' };
    }

    const now = new Date();

    // 申込：発行済みにする
    const apps = getSheet_(SHEET_APPLICATIONS);
    apps.getRange(app.row, 8).setValue('issued');               // status
    if (!app.paidAt) apps.getRange(app.row, 11).setValue(now);  // paidAt
    apps.getRange(app.row, 12).setValue(now);                   // issuedAt

    // アカウント：有効にして、レベルを追加する
    const levels = String(u[7] || '').split(',').filter(String);
    if (levels.indexOf(app.level) === -1) levels.push(app.level);
    const order = ['N4', 'N3', 'N2', 'N1'];
    levels.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });

    users.getRange(userRow, 7).setValue('active');              // status
    users.getRange(userRow, 8).setValue(levels.join(','));      // levels
    if (!u[9]) users.getRange(userRow, 10).setValue(now);       // activatedAt（初回だけ）

    app.levels = levels;
  } finally {
    lock.releaseLock();
  }

  sendIssueMail_(app);
  return { ok: true, applicationId: app.applicationId, levels: app.levels };
}

/** 発行メールを送る */
function sendIssueMail_(app) {
  MailApp.sendEmail({
    to: app.email,
    subject: '【R-anguage】アカウントを発行しました（' + app.applicationId + '）',
    name: 'R-anguage',
    body: [
      app.name + ' 様',
      '',
      'お支払いを確認いたしました。ありがとうございます。',
      'R-anguage のアカウントを発行しましたので、お知らせします。',
      '',
      '■ 申込番号　　　：' + app.applicationId,
      '■ 追加したレベル：' + app.level,
      '■ ご利用中のレベル：' + app.levels.join('、'),
      '■ ログインID　　：' + app.email,
      '',
      'ログインには、お申し込み時に設定したパスワードをお使いください。',
      '下のログインページからお入りいただけます。',
      'https://jprojectsriki-cpu.github.io/r-anguage/frontend/user/login.html',
      '',
      '※ 同じアカウントで、別の端末から同時にログインすることはできません。',
      '　 あとからログインした端末が優先され、前の端末は自動でログアウトします。',
      '',
      '----------------------------------------',
      'R-anguage｜JLPT N4〜N1 日本語学習システム'
    ].join('\n')
  });
}

/**
 * 【テスト用】管理機能の動作確認
 * 事前に、スクリプト プロパティに TEST_PASSWORD（管理者のパスワード）を入れておくこと
 */
function testAdmin() {
  const props = PropertiesService.getScriptProperties();
  const adminEmail = props.getProperty('ADMIN_EMAIL');
  const password = props.getProperty('TEST_PASSWORD');
  if (!password) throw new Error('スクリプト プロパティに TEST_PASSWORD を設定してください。');
  const testEmail = adminEmail.replace('@', '+ratest@');

  const a = apply_({ level: 'N3', payment: 'bank_transfer', name: 'テスト 太郎', email: testEmail, password: 'testpass123' });
  Logger.log('① テスト申込 → ' + JSON.stringify(a));

  if (!a.ok) throw new Error('①のテスト申込に失敗しました。Users と Applications に、前のテストの行が残っていないか確認してください。');

  Logger.log('② 発行前のテスト太郎のログイン → ' + login_(testEmail, 'testpass123').message);

  const admin = login_(adminEmail, password);
  const waiting = adminListApplications_(admin.token, 'awaiting_payment');
  Logger.log('③ 入金待ちの一覧 → ' + waiting.applications.length + '件 / 先頭: ' + waiting.applications[0].applicationId);

  Logger.log('④ 発行 → ' + JSON.stringify(adminIssue_(admin.token, a.applicationId)));
  Logger.log('⑤ もう一度発行 → ' + adminIssue_(admin.token, a.applicationId).message);

  const user = login_(testEmail, 'testpass123');
  Logger.log('⑥ 発行後のテスト太郎のログイン → ok: ' + user.ok + ' / levels: ' + (user.user && user.user.levels));
  Logger.log('⑦ テスト太郎が管理機能を呼ぶ → ' + adminListApplications_(user.token).message);

  props.deleteProperty('TEST_PASSWORD');
  Logger.log('TEST_PASSWORD を削除しました');
}