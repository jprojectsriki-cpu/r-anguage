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


/* =========================================================
 * 受講生の管理
 * ========================================================= */

/** 【管理者】受講生の一覧（パスワードのハッシュ・ソルトは渡さない） */
function adminListUsers_(token) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;

  const sheet = getSheet_(SHEET_USERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, users: [] };

  const users = sheet.getRange(2, 1, lastRow - 1, 11).getValues()
    .filter(function (r) { return String(r[5]) === 'user'; })
    .map(function (r) {
      return {
        userId: String(r[0]),
        email: String(r[1]),
        name: String(r[4]),
        status: String(r[6]),
        levels: String(r[7] || '').split(',').filter(String),
        createdAt: r[8] || null,
        activatedAt: r[9] || null,
        lastLoginAt: r[10] || null
      };
    });
  return { ok: true, users: users };
}

/** 【管理者】アカウントの停止・再開（active ⇔ suspended のみ） */
function adminSetUserStatus_(token, userId, status) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;
  if (status !== 'active' && status !== 'suspended') return { ok: false, message: '状態の指定が正しくありません。' };

  const row = findUserRowById_(String(userId || ''));
  if (!row) return { ok: false, message: 'アカウントが見つかりません。' };

  const sheet = getSheet_(SHEET_USERS);
  const u = sheet.getRange(row, 1, 1, 11).getValues()[0];
  if (String(u[5]) === 'admin') return { ok: false, message: '管理者のアカウントは変更できません。' };
  if (String(u[6]) === 'pending') return { ok: false, message: '入金待ちのアカウントは、申込の「発行」で有効にしてください。' };

  sheet.getRange(row, 7).setValue(status);

  const cache = CacheService.getScriptCache();
  if (status === 'suspended') {
    // ログイン中の端末を、次の操作のときにログアウトさせる
    cache.put('current_' + userId, 'suspended', SESSION_TTL_SEC);
  } else {
    cache.remove('current_' + userId);
  }
  return { ok: true, userId: userId, status: status };
}

/** 【管理者】レベルを手動で追加する */
function adminAddLevel_(token, userId, level) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;
  if (!PRICES[level]) return { ok: false, message: 'レベルの指定が正しくありません。' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const row = findUserRowById_(String(userId || ''));
    if (!row) return { ok: false, message: 'アカウントが見つかりません。' };

    const sheet = getSheet_(SHEET_USERS);
    const levels = String(sheet.getRange(row, 8).getValue() || '').split(',').filter(String);
    if (levels.indexOf(level) !== -1) return { ok: false, message: 'すでに ' + level + ' を持っています。' };

    levels.push(level);
    const order = ['N4', 'N3', 'N2', 'N1'];
    levels.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    sheet.getRange(row, 8).setValue(levels.join(','));
    return { ok: true, userId: userId, levels: levels };
  } finally {
    lock.releaseLock();
  }
}

/** 【管理者】申込をキャンセルする（入金待ち・入金確認済みのみ）。メモを残す */
function adminCancelApplication_(token, applicationId, note) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const app = readApplications_().filter(function (a) { return a.applicationId === applicationId; })[0];
    if (!app) return { ok: false, message: '申込が見つかりません。' };
    if (app.status !== 'awaiting_payment' && app.status !== 'paid') {
      return { ok: false, message: '入金待ち・入金確認済みの申込だけキャンセルできます。' };
    }

    const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    const memo = (app.note ? app.note + '\n' : '') + '[' + stamp + ' キャンセル] ' + String(note || '').slice(0, 200);

    const sheet = getSheet_(SHEET_APPLICATIONS);
    sheet.getRange(app.row, 8).setValue('cancelled');
    sheet.getRange(app.row, 14).setValue(memo);
    return { ok: true, applicationId: applicationId, status: 'cancelled' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 【テスト用】受講生管理の動作確認
 * 事前に、スクリプト プロパティに TEST_PASSWORD（管理者のパスワード）を入れておくこと
 */
function testUserAdmin() {
  const props = PropertiesService.getScriptProperties();
  const adminEmail = props.getProperty('ADMIN_EMAIL');
  const password = props.getProperty('TEST_PASSWORD');
  if (!password) throw new Error('スクリプト プロパティに TEST_PASSWORD を設定してください。');
  const emailA = adminEmail.replace('@', '+ratest@');
  const emailB = adminEmail.replace('@', '+ratest2@');

  const appA = apply_({ level: 'N3', payment: 'bank_transfer', name: 'テスト 太郎', email: emailA, password: 'testpass123' });
  const appB = apply_({ level: 'N2', payment: 'konbini', name: 'テスト 花子', email: emailB, password: 'testpass123' });
  if (!appA.ok || !appB.ok) throw new Error('テスト申込に失敗しました。前のテストの行が残っていないか確認してください。');

  const admin = login_(adminEmail, password);
  if (!admin.ok) throw new Error('管理者のログインに失敗しました：' + admin.message + '（TEST_PASSWORD の値を確認してください）');
  const issued = adminIssue_(admin.token, appA.applicationId);
  if (!issued.ok) throw new Error('発行に失敗しました：' + issued.message);

  const list = adminListUsers_(admin.token);
  if (!list.ok) throw new Error('受講生の一覧の取得に失敗しました：' + list.message);
  Logger.log('① 受講生の一覧 → ' + list.users.length + '人 / ハッシュが含まれていない: ' + (JSON.stringify(list).indexOf('passwordHash') === -1));

  const userA = findUserByEmail_(emailA);
  const sessionA = login_(emailA, 'testpass123');
  Logger.log('② 停止 → ' + JSON.stringify(adminSetUserStatus_(admin.token, userA.userId, 'suspended')));
  Logger.log('③ 停止後、ログイン中の太郎の確認 → ' + JSON.stringify(checkSession_(sessionA.token)));
  Logger.log('④ 停止中の太郎のログイン → ' + login_(emailA, 'testpass123').message);
  Logger.log('⑤ 再開 → ' + JSON.stringify(adminSetUserStatus_(admin.token, userA.userId, 'active')));
  Logger.log('⑥ 再開後の太郎のログイン → ok: ' + login_(emailA, 'testpass123').ok);

  Logger.log('⑦ レベルを手動追加（N2） → ' + JSON.stringify(adminAddLevel_(admin.token, userA.userId, 'N2')));
  Logger.log('⑧ 同じレベルをもう一度 → ' + adminAddLevel_(admin.token, userA.userId, 'N2').message);

  Logger.log('⑨ 花子の申込をキャンセル → ' + JSON.stringify(adminCancelApplication_(admin.token, appB.applicationId, 'テストのため')));
  Logger.log('⑩ 入金待ちのない花子を停止しようとする → ' + adminSetUserStatus_(admin.token, findUserByEmail_(emailB).userId, 'suspended').message);

  props.deleteProperty('TEST_PASSWORD');
  Logger.log('TEST_PASSWORD を削除しました');
}