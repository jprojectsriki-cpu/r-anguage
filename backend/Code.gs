/**
 * R-anguage API - エントリポイント
 */

// シート名（スプレッドシートのタブ名と完全一致させる）
const SHEET_USERS = 'Users';
const SHEET_APPLICATIONS = 'Applications';

/**
 * GETリクエストの入口（動作確認用）
 */
function doGet(e) {
  return json_({ ok: true, message: 'R-anguage API is running' });
}

/**
 * オブジェクトをJSONで返す共通関数
 */
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 名前を指定してシートを取得する（なければエラー）
 */
function getSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(name + ' シートが見つかりません。シート名を確認してください。');
  return sheet;
}

/**
 * 動作確認：2つのシートの見出しを読み取ってログに出す
 */
function testSheets() {
  [SHEET_USERS, SHEET_APPLICATIONS].forEach(function (name) {
    const sheet = getSheet_(name);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    Logger.log(name + '（' + headers.length + '列）: ' + headers.join(', '));
  });
}


/**
 * POSTリクエストの入口
 * フロントからは { action: '○○', ... } の形のJSONを送ってもらう
 */
function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, message: 'リクエストの形式が正しくありません。' });
  }

  try {
    switch (req.action) {
      case 'apply':
        return json_(apply_(req));
      case 'login':
        return json_(login_(req.email, req.password));
      case 'logout':
        return json_(logout_(req.token));
      case 'me':
        return json_(checkSession_(req.token));
      case 'admin.list':
        return json_(adminListApplications_(req.token, req.status));
      case 'admin.issue':
        return json_(adminIssue_(req.token, req.applicationId));
      default:
        return json_({ ok: false, message: '不明な操作です。' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, message: 'サーバーでエラーが発生しました。時間をおいてもう一度お試しください。' });
  }
}