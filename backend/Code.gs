/**
 * R-ANGUAGE API - エントリポイント
 */

// シート名（スプレッドシートのタブ名と完全一致させる）
const SHEET_USERS = 'Users';
const SHEET_APPLICATIONS = 'Applications';

/**
 * GETリクエストの入口（動作確認用）
 */
function doGet(e) {
  return json_({ ok: true, message: 'R-ANGUAGE API is running' });
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
      case 'resetRequest':
        return json_(requestPasswordReset_(req.email));
      case 'resetCheck':
        return json_(checkResetToken_(req.token));
      case 'resetPassword':
        return json_(resetPassword_(req.token, req.password));
      case 'logout':
        return json_(logout_(req.token));
      case 'me':
        return json_(checkSession_(req.token));
      case 'me.profile':
        return json_(meProfile_(req.token));
      case 'me.changePassword':
        return json_(meChangePassword_(req.token, req.currentPassword, req.newPassword));
      case 'me.applyLevel':
        return json_(meApplyLevel_(req.token, req.level));
      case 'me.saveSettings':
        return json_(meSaveSettings_(req.token, req));
      case 'me.practiceMenu':
        return json_(mePracticeMenu_(req.token));
      case 'me.practiceStart':
        return json_(mePracticeStart_(req.token, req));
      case 'me.saveAnswers':
        return json_(meSaveAnswers_(req.token, req));
      case 'me.favorite':
        return json_(meFavorite_(req.token, req.questionId, req.on === true));
      case 'me.vocabMenu':
        return json_(meVocabMenu_(req.token));
      case 'me.vocabStart':
        return json_(meVocabStart_(req.token, req));
      case 'me.vocabMark':
        return json_(meVocabMark_(req.token, req));
      case 'me.mockMenu':
        return json_(meMockMenu_(req.token));
      case 'me.mockStart':
        return json_(meMockStart_(req.token, req.level, req.stage));
      case 'me.mockSubmit':
        return json_(meMockSubmit_(req.token, req));
      case 'me.mockResult':
        return json_(meMockResult_(req.token, req.resultId));
      case 'me.stats':
        return json_(meStats_(req.token));
      case 'me.resetStats':
        return json_(meResetStats_(req.token, req.level, req.section));
      case 'admin.importTemplates':
        return json_(adminImportTemplates_(req.token));
      case 'admin.setQuestionsStatus':
        return json_(bumpIfOk_(adminSetQuestionsStatus_(req.token, req.ids, req.status)));
      case 'admin.setCardsStatus':
        return json_(bumpIfOk_(adminSetCardsStatus_(req.token, req.ids, req.status)));
      case 'admin.importQuestions':
        return json_(bumpIfOk_(adminImportQuestions_(req.token, req.rows, req.dryRun === true)));
      case 'admin.importCards':
        return json_(bumpIfOk_(adminImportCards_(req.token, req.rows, req.dryRun === true)));
      case 'admin.examDates':
        return json_(adminListExamDates_(req.token));
      case 'admin.saveExamDate':
        return json_(adminSaveExamDate_(req.token, req.exam || {}));
      case 'admin.deleteExamDate':
        return json_(adminDeleteExamDate_(req.token, req.examId));
      case 'admin.list':
        return json_(adminListApplications_(req.token, req.status));
      case 'admin.issue':
        return json_(adminIssue_(req.token, req.applicationId));
      case 'admin.users':
        return json_(adminListUsers_(req.token));
      case 'admin.userStatus':
        return json_(adminSetUserStatus_(req.token, req.userId, req.status));
      case 'admin.setStage':
        return json_(adminSetStage_(req.token, req.userId, req.level, req.stage));
      case 'admin.addLevel':
        return json_(adminAddLevel_(req.token, req.userId, req.level));
      case 'admin.cancel':
        return json_(adminCancelApplication_(req.token, req.applicationId, req.note));
      case 'admin.questions':
        return json_(adminListQuestions_(req.token));
      case 'admin.saveQuestion':
        return json_(bumpIfOk_(adminSaveQuestion_(req.token, req.question || {})));
      case 'admin.deleteQuestion':
        return json_(bumpIfOk_(adminDeleteQuestion_(req.token, req.questionId)));
      case 'admin.cards':
        return json_(adminListCards_(req.token));
      case 'admin.saveCard':
        return json_(bumpIfOk_(adminSaveCard_(req.token, req.card || {})));
      case 'admin.deleteCard':
        return json_(bumpIfOk_(adminDeleteCard_(req.token, req.cardId)));
      case 'admin.notices':
        return json_(adminListNotices_(req.token));
      case 'admin.saveNotice':
        return json_(adminSaveNotice_(req.token, req.notice || {}));
      case 'admin.deleteNotice':
        return json_(adminDeleteNotice_(req.token, req.noticeId));
      default:
        return json_({ ok: false, message: '不明な操作です。' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, message: 'サーバーでエラーが発生しました。時間をおいてもう一度お試しください。' });
  }
}