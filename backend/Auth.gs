/**
 * R-anguage API - 認証まわり（パスワードのハッシュ化・管理者登録）
 */

// ハッシュを繰り返す回数（多いほど安全だが処理が遅くなる）
const HASH_ITERATIONS = 1000;

/** ランダムなソルトを作る（32文字の英数字） */
function generateSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

/** パスワード + ソルト を SHA-256 で繰り返しハッシュ化し、16進数の文字列で返す */
function hashPassword_(password, salt) {
  const saltBytes = Utilities.newBlob(salt).getBytes();
  let bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, salt + password, Utilities.Charset.UTF_8);
  for (let i = 1; i < HASH_ITERATIONS; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes.concat(saltBytes));
  }
  return bytes.map(function (b) {
    return ((b + 256) % 256).toString(16).padStart(2, '0');
  }).join('');
}

/** 入力されたパスワードが正しいかを確認する */
function verifyPassword_(password, salt, storedHash) {
  return hashPassword_(password, salt) === storedHash;
}

/**
 * 【1回だけ実行】最初の管理者アカウントを登録する
 * 事前に、スクリプト プロパティに ADMIN_EMAIL と ADMIN_PASSWORD を設定しておくこと
 */
function setupAdmin() {
  const props = PropertiesService.getScriptProperties();
  const email = String(props.getProperty('ADMIN_EMAIL') || '').trim().toLowerCase();
  const password = String(props.getProperty('ADMIN_PASSWORD') || '');

  if (!email || !password) {
    throw new Error('スクリプト プロパティに ADMIN_EMAIL と ADMIN_PASSWORD を設定してください。');
  }
  if (password.length < 8) {
    throw new Error('パスワードは8文字以上にしてください。');
  }

  const sheet = getSheet_(SHEET_USERS);

  // ハッシュ・ソルト・levels列が数値などに自動変換されないよう「書式なしテキスト」にする
  sheet.getRange('C:D').setNumberFormat('@');
  sheet.getRange('H:H').setNumberFormat('@');

  // 同じメールアドレスが登録済みでないか確認
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const emails = sheet.getRange(2, 2, lastRow - 1, 1).getValues()
      .map(function (r) { return String(r[0]).trim().toLowerCase(); });
    if (emails.indexOf(email) !== -1) {
      throw new Error('このメールアドレスはすでに登録されています。');
    }
  }

  const salt = generateSalt_();
  const now = new Date();
  sheet.appendRow([
    Utilities.getUuid(),            // userId
    email,                          // email
    hashPassword_(password, salt),  // passwordHash
    salt,                           // salt
    '管理者',                       // name
    'admin',                        // role
    'active',                       // status
    '',                             // levels（管理者は不要）
    now,                            // createdAt
    now,                            // activatedAt
    ''                              // lastLoginAt
  ]);

  // 使い終わったパスワードはプロパティから削除する
  props.deleteProperty('ADMIN_PASSWORD');
  Logger.log('管理者を登録しました: ' + email);
}