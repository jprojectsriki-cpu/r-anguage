/**
 * R-anguage API - 支払期限の自動処理（毎日1回、深夜3時ごろに自動で動く）
 * - 支払期限を過ぎた「入金待ち」の申込を「期限切れ」にして、申込者にメールで知らせる
 * - 支払期限が明日（または今日）の申込者に、1回だけリマインドメールを送る
 * - 処理したものがあった日は、管理者にまとめてメールで知らせる
 * ※ readApplications_ は Admin.gs、PAYMENT_METHODS は Apply.gs のものを使う
 */

const REMIND_COL = 15;          // Applications シートの O列：リマインドを送った日時
const CHECK_HOUR = 3;           // 毎日この時間（日本時間）ごろに動く
const APPLY_PAGE_URL = 'https://jprojectsriki-cpu.github.io/r-anguage/frontend/user/#pricing';

/**
 * 【1回だけ実行】毎日の自動処理を設定する
 * - Applications シートの O1 に「remindedAt」の見出しを入れる
 * - 毎日3時ごろに dailyPaymentCheck が動くように、トリガーを登録する（何回実行しても1つだけになる）
 */
function setupPaymentCheck() {
  const sheet = getSheet_(SHEET_APPLICATIONS);
  if (!String(sheet.getRange(1, REMIND_COL).getValue()).trim()) {
    sheet.getRange(1, REMIND_COL).setValue('remindedAt').setFontWeight('bold');
  }

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyPaymentCheck') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyPaymentCheck')
    .timeBased()
    .everyDays(1)
    .atHour(CHECK_HOUR)
    .inTimezone('Asia/Tokyo')
    .create();

  Logger.log('毎日 ' + CHECK_HOUR + '時ごろ（日本時間）に dailyPaymentCheck が動くように設定しました');
}

/** 日本時間の日付を「2026-10-28」の形で返す */
function jstDate_(d) {
  return Utilities.formatDate(new Date(d), 'Asia/Tokyo', 'yyyy-MM-dd');
}

/** 【毎日自動で動く】期限切れの処理とリマインド */
function dailyPaymentCheck() {
  const now = new Date();
  const today = jstDate_(now);
  const tomorrow = jstDate_(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const stamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

  const expired = [];
  const reminded = [];

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_(SHEET_APPLICATIONS);
    const apps = readApplications_();
    if (!apps.length) return { expired: 0, reminded: 0 };
    const remindedAt = sheet.getRange(2, REMIND_COL, apps.length, 1).getValues();

    apps.forEach(function (a, i) {
      if (a.status !== 'awaiting_payment' || !a.expiresAt) return;
      const limit = new Date(a.expiresAt);
      if (isNaN(limit.getTime())) return;

      if (limit.getTime() <= now.getTime()) {
        // 期限切れにする
        sheet.getRange(a.row, 8).setValue('expired');
        sheet.getRange(a.row, 14).setValue((a.note ? a.note + '\n' : '') + '[' + stamp + ' 期限切れ（自動）]');
        expired.push(a);
      } else if (!remindedAt[i][0] && jstDate_(limit) <= tomorrow) {
        // 期限が明日（または今日）で、まだリマインドしていない
        sheet.getRange(a.row, REMIND_COL).setValue(now);
        reminded.push(a);
      }
    });
  } finally {
    lock.releaseLock();
  }

  // メールは、シートの書き込みが終わってから送る
  expired.forEach(function (a) { sendExpiredMail_(a); });
  reminded.forEach(function (a) { sendReminderMail_(a, today); });
  if (expired.length || reminded.length) sendCheckSummaryMail_(expired, reminded);

  Logger.log('期限切れ ' + expired.length + '件：' + expired.map(function (a) { return a.applicationId; }).join('、'));
  Logger.log('リマインド ' + reminded.length + '件：' + reminded.map(function (a) { return a.applicationId; }).join('、'));
  return { expired: expired.length, reminded: reminded.length };
}

/** 期限を「2026年11月4日 15:30」の形にする */
function formatLimit_(d) {
  return Utilities.formatDate(new Date(d), 'Asia/Tokyo', 'yyyy年M月d日 HH:mm');
}

/** 期限切れのお知らせ（申込者あて） */
function sendExpiredMail_(a) {
  MailApp.sendEmail({
    to: a.email,
    subject: '【R-anguage】お支払いの期限が過ぎたため、お申し込みを取り消しました（' + a.applicationId + '）',
    name: 'R-anguage',
    body: [
      a.name + ' 様',
      '',
      'R-anguage にお申し込みいただき、ありがとうございました。',
      'お支払いの期限までに入金を確認できなかったため、以下のお申し込みを取り消しました。',
      '',
      '■ 申込番号：' + a.applicationId,
      '■ レベル　：' + a.level,
      '■ 支払期限：' + formatLimit_(a.expiresAt),
      '',
      'あらためてご利用いただく場合は、同じメールアドレスで、もう一度お申し込みいただけます。',
      APPLY_PAGE_URL,
      '',
      '※ 期限の直前にお支払いいただいた場合など、行き違いがありましたら、このメールにご返信ください。',
      '',
      '----------------------------------------',
      'R-anguage｜JLPT N4〜N1 日本語学習システム'
    ].join('\n')
  });
}

/** 支払期限のリマインド（申込者あて） */
function sendReminderMail_(a, today) {
  const isToday = jstDate_(a.expiresAt) === today;
  MailApp.sendEmail({
    to: a.email,
    subject: '【R-anguage】お支払いの期限は' + (isToday ? '今日' : '明日') + 'です（' + a.applicationId + '）',
    name: 'R-anguage',
    body: [
      a.name + ' 様',
      '',
      'R-anguage にお申し込みいただき、ありがとうございます。',
      'お支払いの期限が' + (isToday ? '今日' : '明日') + 'になりましたので、お知らせします。',
      '',
      '■ 申込番号：' + a.applicationId,
      '■ レベル　：' + a.level,
      '■ 金額　　：' + Number(a.amount).toLocaleString('ja-JP') + '円（税込・買い切り）',
      '■ お支払い：' + (PAYMENT_METHODS[a.paymentMethod] || a.paymentMethod),
      '■ 支払期限：' + formatLimit_(a.expiresAt),
      '',
      '銀行振込の場合は、振込名義の前に申込番号を付けてください。',
      '期限を過ぎると、お申し込みは自動的に取り消されます。',
      '',
      '※ このメールと行き違いでお支払いいただいた場合は、ご容赦ください。',
      '',
      '----------------------------------------',
      'R-anguage｜JLPT N4〜N1 日本語学習システム'
    ].join('\n')
  });
}

/** 処理のまとめ（管理者あて） */
function sendCheckSummaryMail_(expired, reminded) {
  const adminEmail = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');
  if (!adminEmail) return;
  const line = function (a) { return '・' + a.applicationId + '　' + a.name + '　' + a.level + '　期限 ' + formatLimit_(a.expiresAt); };
  MailApp.sendEmail({
    to: adminEmail,
    subject: '【R-anguage管理】支払期限の処理：期限切れ ' + expired.length + '件・リマインド ' + reminded.length + '件',
    name: 'R-anguage',
    body: [
      '支払期限の自動処理を行いました。',
      '',
      '■ 期限切れにした申込（' + expired.length + '件）',
      expired.length ? expired.map(line).join('\n') : '・なし',
      '',
      '■ リマインドメールを送った申込（' + reminded.length + '件）',
      reminded.length ? reminded.map(line).join('\n') : '・なし',
      '',
      '管理画面：https://jprojectsriki-cpu.github.io/r-anguage/frontend/admin/'
    ].join('\n')
  });
}

/**
 * 【テスト用】支払期限の処理と、申し込み直しの動作確認
 * - 管理者のメールアドレスに「+ratest」「+ratest2」を付けたアドレスで申し込み、最後にテストの行を消す
 * - 管理者のメールアドレスに、受付・期限切れ・リマインド・まとめのメールが届く
 * ※ 本物の「入金待ち」の申込で期限が過ぎているものがあれば、それも期限切れになる（毎日の処理と同じ）
 */
function testPaymentCheck() {
  const adminEmail = String(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || '');
  if (!adminEmail) throw new Error('スクリプト プロパティに ADMIN_EMAIL がありません。');
  const emailA = adminEmail.replace('@', '+ratest@').toLowerCase();
  const emailB = adminEmail.replace('@', '+ratest2@').toLowerCase();
  if (findUserByEmail_(emailA) || findUserByEmail_(emailB)) {
    throw new Error('前のテストの行（+ratest / +ratest2）が Users シートに残っています。先に削除してから実行してください。');
  }

  // ① 2人分の申込を作る
  const a = apply_({ level: 'N4', payment: 'bank_transfer', name: 'テスト 太郎', email: emailA, password: 'testpass123' });
  const b = apply_({ level: 'N3', payment: 'konbini', name: 'テスト 花子', email: emailB, password: 'testpass123' });
  if (!a.ok || !b.ok) throw new Error('テストの申込に失敗しました：' + (a.message || b.message));
  Logger.log('① 申込 → ' + a.applicationId + '、' + b.applicationId);

  // ② 期限を書きかえる：Aは1時間前（期限切れになる）、Bは明日の正午（リマインドの対象）
  const sheet = getSheet_(SHEET_APPLICATIONS);
  const rowOf = function (id) { return readApplications_().filter(function (x) { return x.applicationId === id; })[0].row; };
  const now = new Date();
  const tomorrowNoon = new Date(jstDate_(new Date(now.getTime() + 24 * 60 * 60 * 1000)) + 'T12:00:00+09:00');
  sheet.getRange(rowOf(a.applicationId), 10).setValue(new Date(now.getTime() - 60 * 60 * 1000));
  sheet.getRange(rowOf(b.applicationId), 10).setValue(tomorrowNoon);

  // ③ 1回目の処理：Aが期限切れ、Bにリマインド
  Logger.log('③ 1回目 → ' + JSON.stringify(dailyPaymentCheck()));

  // ④ 2回目の処理：同じメールを2回は送らない（0件ずつになる）
  Logger.log('④ 2回目 → ' + JSON.stringify(dailyPaymentCheck()));

  // ⑤ Bは、お支払い待ちの申込が有効なので、申し込み直せない
  const b2 = apply_({ level: 'N2', payment: 'konbini', name: 'テスト 花子', email: emailB, password: 'testpass123' });
  Logger.log('⑤ Bの申し込み直し → ok:' + b2.ok + ' / ' + b2.message);

  // ⑥ Aは期限切れなので、同じメールアドレスで申し込み直せる（アカウントは同じものを使う）
  const userBefore = findUserByEmail_(emailA);
  const a2 = apply_({ level: 'N2', payment: 'konbini', name: 'テスト 次郎', email: emailA, password: 'newpass456' });
  const userAfter = findUserByEmail_(emailA);
  Logger.log('⑥ Aの申し込み直し → ok:' + a2.ok + ' / ' + a2.applicationId +
    ' / 同じアカウント:' + (userBefore.userId === userAfter.userId) + ' / 名前:' + userAfter.name +
    ' / 新しいパスワード:' + verifyPassword_('newpass456', userAfter.salt, userAfter.passwordHash));

  // ⑦ テストの行を消す（下の行から消す）
  const removed = cleanupPaymentTest_([emailA, emailB]);
  Logger.log('⑦ テストの行を削除 → Users ' + removed.users + '行・Applications ' + removed.apps + '行');
}

/** テストで作った行を、Users と Applications から消す */
function cleanupPaymentTest_(emails) {
  const result = { users: 0, apps: 0 };
  [[SHEET_USERS, 2, 'users'], [SHEET_APPLICATIONS, 3, 'apps']].forEach(function (t) {
    const sheet = getSheet_(t[0]);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const values = sheet.getRange(2, t[1], lastRow - 1, 1).getValues();
    for (let i = values.length - 1; i >= 0; i--) {
      if (emails.indexOf(String(values[i][0]).trim().toLowerCase()) !== -1) {
        sheet.deleteRow(i + 2);
        result[t[2]]++;
      }
    }
  });
  return result;
}
