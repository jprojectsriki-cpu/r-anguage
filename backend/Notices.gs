/**
 * R-anguage API - お知らせの管理
 * ※ LEVEL_LIST・Q_STATUS は Questions.gs のものを使う
 */

const SHEET_NOTICES = 'Notices';
const N_HEADERS = ['お知らせID', 'タイトル', '本文', '対象', '表示開始日', '表示終了日', '重要', '状態', '作成日時', '更新日時'];
const N_COLS = N_HEADERS.length; // 10列（A〜J）
const N_TARGETS = ['すべて', 'N4', 'N3', 'N2', 'N1'];
const N_IMPORTANCE = ['通常', '重要'];

/**
 * 【1回だけ実行】Noticesシートを作り、見出し・プルダウン・書式を設定する
 * （すでにあるときは、見出しとプルダウンだけを設定し直す。入力済みのお知らせは消えない）
 */
function setupNoticesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NOTICES);
  if (!sheet) sheet = ss.insertSheet(SHEET_NOTICES);

  sheet.getRange(1, 1, 1, N_COLS).setValues([N_HEADERS]).setFontWeight('bold').setBackground('#FFE3EE');
  sheet.setFrozenRows(1);

  const rows = sheet.getMaxRows() - 1;
  const list = function (values) {
    return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  };
  sheet.getRange(2, 4, rows, 1).setDataValidation(list(N_TARGETS));    // D 対象
  sheet.getRange(2, 7, rows, 1).setDataValidation(list(N_IMPORTANCE)); // G 重要
  sheet.getRange(2, 8, rows, 1).setDataValidation(list(Q_STATUS));     // H 状態

  // 日付が自動で変換されないよう、A〜H列は「書式なしテキスト」にする（日付は 2026-11-01 の形で書く）
  sheet.getRange(2, 1, rows, 8).setNumberFormat('@');
  sheet.getRange(2, 1, rows, N_COLS).setWrap(true).setVerticalAlignment('top');

  [110, 220, 360, 70, 100, 100, 60, 70, 130, 130]
    .forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });

  Logger.log('Notices シートを準備しました（' + N_COLS + '列）');
}

/** 日付を「2026-11-01」の形にそろえる（空欄は空欄のまま。読めないものはそのまま返し、入力チェックで知らせる） */
function normalizeDate_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  const s = String(value).trim().replace(/[／/.年月]/g, '-').replace(/日$/, '');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return s;
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

/** 「2026-11-01」が実在する日付かどうか */
function isValidDate_(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

/** 今日の日付（日本時間）を「2026-11-01」の形で返す */
function todayJst_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

/** 1行をお知らせのオブジェクトにする */
function rowToNotice_(r, rowNumber) {
  return {
    row: rowNumber,
    noticeId: String(r[0] || '').trim(),
    title: String(r[1] || '').trim(),
    body: String(r[2] || ''),
    target: String(r[3] || '').trim(),
    startDate: normalizeDate_(r[4]),
    endDate: normalizeDate_(r[5]),
    importance: String(r[6] || '').trim(),
    status: String(r[7] || '').trim(),
    createdAt: r[8] || null,
    updatedAt: r[9] || null
  };
}

/** お知らせの入力内容をチェックし、問題点の一覧を返す（問題なければ空の配列） */
function validateNotice_(n) {
  const errors = [];
  if (!n.title) errors.push('タイトルを入力してください。');
  if (!String(n.body || '').trim()) errors.push('本文を入力してください。');
  if (N_TARGETS.indexOf(n.target) === -1) errors.push('対象は「すべて」か N4／N3／N2／N1 のどれかにしてください。');
  if (!n.startDate) errors.push('表示開始日を入力してください。');
  else if (!isValidDate_(n.startDate)) errors.push('表示開始日は 2026-11-01 の形で、正しい日付を入力してください。');
  if (n.endDate && !isValidDate_(n.endDate)) errors.push('表示終了日は 2026-11-30 の形で、正しい日付を入力してください（ずっと表示するときは空欄）。');
  if (isValidDate_(n.startDate) && isValidDate_(n.endDate) && n.endDate < n.startDate) errors.push('表示終了日は、表示開始日と同じ日かそれより後にしてください。');
  if (N_IMPORTANCE.indexOf(n.importance) === -1) errors.push('重要は「通常」か「重要」にしてください。');
  if (Q_STATUS.indexOf(n.status) === -1) errors.push('状態は「公開」か「下書き」にしてください。');
  return errors;
}

/**
 * 表示の状況を返す
 * draft：下書き / scheduled：表示前 / showing：表示中 / ended：表示終了
 */
function noticePhase_(n, today) {
  if (n.status !== '公開') return 'draft';
  if (n.startDate && n.startDate > today) return 'scheduled';
  if (n.endDate && n.endDate < today) return 'ended';
  return 'showing';
}

/** 新しいお知らせIDを作る（例：N20261027-K7Q2） */
function makeNoticeId_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 4; i++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'N' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd') + '-' + rand;
}

/** シートを読み込む。スプレッドシートで直接入力された行に、お知らせIDと作成日時を付ける */
function readNotices_() {
  const sheet = getSheet_(SHEET_NOTICES);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, N_COLS).getValues();
  const now = new Date();
  values.forEach(function (r, i) {
    const hasContent = r.slice(1, 8).some(function (v) { return String(v).trim() !== ''; });
    if (hasContent && !String(r[0]).trim()) {
      r[0] = makeNoticeId_();
      if (!r[8]) r[8] = now;
      if (!r[9]) r[9] = now;
      sheet.getRange(i + 2, 1).setValue(r[0]);
      sheet.getRange(i + 2, 9, 1, 2).setValues([[r[8], r[9]]]);
    }
  });

  return values
    .map(function (r, i) { return rowToNotice_(r, i + 2); })
    .filter(function (n) { return n.noticeId; });
}

/** 【管理者】お知らせの一覧（入力ミスは errors、表示の状況は phase に入る） */
function adminListNotices_(token) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const today = todayJst_();
    const list = readNotices_().map(function (n) {
      n.errors = validateNotice_(n);
      n.phase = n.errors.length ? 'error' : noticePhase_(n, today);
      delete n.row;
      return n;
    });
    return { ok: true, today: today, notices: list };
  } finally {
    lock.releaseLock();
  }
}

/** 【管理者】お知らせの保存（noticeId がなければ新規、あれば更新） */
function adminSaveNotice_(token, input) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;
  input = input || {};

  const n = {
    noticeId: String(input.noticeId || '').trim(),
    title: String(input.title || '').trim().slice(0, 100),
    body: String(input.body || '').slice(0, 3000),
    target: String(input.target || ''),
    startDate: normalizeDate_(input.startDate),
    endDate: normalizeDate_(input.endDate),
    importance: String(input.importance || ''),
    status: String(input.status || '')
  };
  const errors = validateNotice_(n);
  if (errors.length) return { ok: false, message: errors.join('\n'), errors: errors };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_(SHEET_NOTICES);
    const now = new Date();
    const values = [n.title, n.body, n.target, n.startDate, n.endDate, n.importance, n.status];

    if (n.noticeId) {
      const found = readNotices_().filter(function (x) { return x.noticeId === n.noticeId; })[0];
      if (!found) return { ok: false, message: 'お知らせが見つかりません。' };
      sheet.getRange(found.row, 2, 1, 7).setValues([values]);
      sheet.getRange(found.row, 10).setValue(now);
      return { ok: true, noticeId: n.noticeId, created: false, phase: noticePhase_(n, todayJst_()) };
    }

    const id = makeNoticeId_();
    sheet.appendRow([id].concat(values, [now, now]));
    return { ok: true, noticeId: id, created: true, phase: noticePhase_(n, todayJst_()) };
  } finally {
    lock.releaseLock();
  }
}

/** 【管理者】お知らせの削除 */
function adminDeleteNotice_(token, noticeId) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const found = readNotices_().filter(function (x) { return x.noticeId === noticeId; })[0];
    if (!found) return { ok: false, message: 'お知らせが見つかりません。' };
    getSheet_(SHEET_NOTICES).deleteRow(found.row);
    return { ok: true, noticeId: noticeId };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 【テスト用】お知らせの管理の動作確認（最後にテストのお知らせは削除される）
 * 事前に、スクリプト プロパティに TEST_PASSWORD（R-anguageの管理者パスワード）を入れておくこと
 */
function testNotices() {
  const props = PropertiesService.getScriptProperties();
  const password = props.getProperty('TEST_PASSWORD');
  if (!password) throw new Error('スクリプト プロパティに TEST_PASSWORD（R-anguageの管理者パスワード）を設定してください。');

  const admin = login_(props.getProperty('ADMIN_EMAIL'), password);
  if (!admin.ok) throw new Error('管理者のログインに失敗しました：' + admin.message + '（TEST_PASSWORD に R-anguageの管理者パスワードが入っているか確認してください）');

  const today = todayJst_();
  const notice = {
    title: '【テスト】{年末年始|ねんまつねんし}のお{休|やす}み', body: '12{月|がつ}29{日|にち}から1{月|がつ}3{日|か}まで、お{問|と}い{合|あ}わせをお{休|やす}みします。',
    target: 'すべて', startDate: today, endDate: '', importance: '重要', status: '下書き'
  };

  // ① 管理画面から1件作る（下書き）
  const saved = adminSaveNotice_(admin.token, notice);
  Logger.log('① 新しく保存 → ' + JSON.stringify(saved));

  // ② 同じお知らせを「公開」に変更（今日から表示）
  const updated = adminSaveNotice_(admin.token, Object.assign({}, notice, { noticeId: saved.noticeId, status: '公開' }));
  Logger.log('② 更新 → ' + JSON.stringify(updated));

  // ③ スプレッドシートに直接1行入れる（お知らせIDは空欄、表示開始日は 2099/1/1 の形）
  getSheet_(SHEET_NOTICES).appendRow(['', '【テスト】N3の{模擬試験|もぎしけん}を{追加|ついか}しました', '{新|あたら}しい{問題|もんだい}を{追加|ついか}しました。',
    'N3', '2099/1/1', '', '通常', '公開', '', '']);

  // ④ 一覧を取得（③の行にIDが付き、日付が 2099-01-01 にそろう）
  const list = adminListNotices_(admin.token);
  const mine = list.notices.filter(function (n) { return n.title.indexOf('【テスト】') === 0; });
  Logger.log('④ 一覧（今日 ' + list.today + '）→ 全' + list.notices.length + '件 / テストのお知らせ: ' +
    mine.map(function (n) { return n.noticeId + '（' + n.target + '・' + n.startDate + '〜' + (n.endDate || '終了日なし') + '・' + n.importance + '・' + n.phase + '・ミス' + n.errors.length + '件）'; }).join('、'));

  // ⑤ 入力ミスのあるお知らせは保存できない
  const bad = adminSaveNotice_(admin.token, { title: '', body: '', target: 'N5', startDate: '2026-02-30', endDate: '2026-01-01', importance: '', status: '公開' });
  Logger.log('⑤ 入力ミス → ' + bad.errors.length + '件：' + bad.errors.join(' / '));

  // ⑥ テストのお知らせを削除
  mine.forEach(function (n) { Logger.log('⑥ 削除 → ' + JSON.stringify(adminDeleteNotice_(admin.token, n.noticeId))); });

  props.deleteProperty('TEST_PASSWORD');
  Logger.log('TEST_PASSWORD を削除しました');
}
