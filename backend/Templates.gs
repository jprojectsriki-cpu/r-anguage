/**
 * R-ANGUAGE - 「まとめて登録」のテンプレート（Googleスプレッドシート）
 *
 * - createImportTemplates() を1回実行すると、Google ドライブに2つのスプレッドシートを作る
 *     「R-ANGUAGE 問題テンプレート」「R-ANGUAGE 単語カードテンプレート」
 *   （プルダウン・書き方・記入例・問題形式の一覧つき）
 * - URL はスクリプト プロパティ TEMPLATE_QUESTIONS_URL・TEMPLATE_CARDS_URL に残し、管理画面の「まとめて登録」から開ける
 * - もう一度実行しても、すでにあるときは作らない（作り直したいときは、プロパティを消してから実行）
 */

const TPL_ROWS = 1000;
const TPL_HEAD_BG = '#FFE08A';
const TPL_REQ_BG = '#FFD6E7';
const TPL_INPUT_BG = '#FFFBEA';

const TPL_Q_COLS = ['レベル', '科目', '問題形式', '本文', '音声ファイル', '問題文', '選択肢1', '選択肢2', '選択肢3', '選択肢4', '正解', '解説', '状態'];
const TPL_Q_WIDTHS = [70, 90, 150, 300, 160, 300, 130, 130, 130, 130, 60, 260, 70];
const TPL_Q_REQ = ['レベル', '科目', '問題形式', '問題文', '選択肢1', '選択肢2', '選択肢3', '選択肢4', '正解'];
const TPL_V_COLS = ['レベル', '単語', '読み', '英語の意味', '例文', '例文の英訳', '状態'];
const TPL_V_WIDTHS = [70, 130, 130, 220, 320, 300, 70];
const TPL_V_REQ = ['レベル', '単語', '読み', '英語の意味'];

const TPL_PASSAGE = '{私|わたし}の{町|まち}には{大|おお}きな{公園|こうえん}があります。{春|はる}になると、たくさんの{人|ひと}が{花見|はなみ}に{来|き}ます。\nでも、{最近|さいきん}はごみが{増|ふ}えて、{町|まち}の{人|ひと}たちは{困|こま}っています。';
const TPL_Q_EXAMPLES = [
  ['N3', '文字・語彙', '漢字読み', '', '', '{毎朝|まいあさ}、【散歩】をしてから{会社|かいしゃ}に{行|い}きます。', 'さんぽ', 'さんぼ', 'さんほ', 'ざんぽ', '1', '「散歩」は「さんぽ」と{読|よ}みます。', '下書き'],
  ['N3', '文字・語彙', '表記', '', '', '{日曜日|にちようび}に{部屋|へや}の【そうじ】をしました。', '掃除', '相除', '掃事', '想除', '1', '「そうじ」は「掃除」と{書|か}きます。', '下書き'],
  ['N3', '文法', '文法形式の判断', '', '', '{雨|あめ}が{降|ふ}っている（　　）、{試合|しあい}は{中止|ちゅうし}になった。', 'ので', 'のに', 'ながら', 'までに', '1', '「〜ので」は{理由|りゆう}を{表|あらわ}します。', '下書き'],
  ['N3', '読解', '内容理解（中文）', TPL_PASSAGE, '', '{町|まち}の{人|ひと}たちは、なぜ{困|こま}っていますか。', '{公園|こうえん}が{小|ちい}さいから', '{花見|はなみ}の{人|ひと}が{来|こ}ないから', 'ごみが{増|ふ}えたから', '{春|はる}が{短|みじか}いから', '3', '{最後|さいご}の{文|ぶん}に「ごみが{増|ふ}えて…{困|こま}っています」とあります。', '下書き'],
  ['N3', '読解', '内容理解（中文）', TPL_PASSAGE, '', 'この{公園|こうえん}について、{正|ただ}しいものはどれですか。', '{春|はる}に{多|おお}くの{人|ひと}が{来|く}る', '{町|まち}の{外|そと}にある', '{最近|さいきん}{新|あたら}しくできた', '{花見|はなみ}はできない', '1', '「{春|はる}になると、たくさんの{人|ひと}が{花見|はなみ}に{来|き}ます」とあります。', '下書き'],
  ['N3', '聴解', '課題理解', '', 'N3_choukai_001.mp3', '{男|おとこ}の{人|ひと}は、このあと{何|なに}をしますか。', '{資料|しりょう}をコピーする', '{会議室|かいぎしつ}を{予約|よやく}する', '{部長|ぶちょう}に{電話|でんわ}する', 'お{茶|ちゃ}を{用意|ようい}する', '2', '（スクリプト）{女|おんな}：{会議室|かいぎしつ}、まだ{予約|よやく}していないよね。{先|さき}にお{願|ねが}い。…　※スクリプトを{書|か}いておくと、{見直|みなお}しに{役立|やくだ}ちます。', '下書き']
];
const TPL_V_EXAMPLES = [
  ['N3', '経験', 'けいけん', 'experience; to experience', '{外国|がいこく}で{働|はたら}いた{経験|けいけん}があります。', 'I have experience working abroad.', '下書き'],
  ['N3', '約束', 'やくそく', 'promise; appointment', '{友|とも}だちと{会|あ}う{約束|やくそく}をしました。', 'I made plans to meet a friend.', '下書き'],
  ['N3', '締め切り', 'しめきり', 'deadline', 'レポートの{締|し}め{切|き}りは{金曜日|きんようび}です。', 'The report is due on Friday.', '下書き'],
  ['N3', '申し込む', 'もうしこむ', 'to apply; to sign up', 'インターネットで{試験|しけん}に{申|もう}し{込|こ}みました。', 'I applied for the exam online.', '下書き']
];

const TPL_Q_GUIDE = [
  '## このスプレッドシートの使い方',
  '1.「問題」シートに、1行に1問ずつ書きます（うすい黄色のセルが入力するところです。ピンクの見出しは必ず書く列です）。',
  '2. 書いた行の A列〜M列 を選んでコピーします（Ctrl+C。Mac は ⌘+C）。行番号をクリックして行ごと選んでもかまいません。',
  '3. R-ANGUAGE の管理画面 →「まとめて登録」→「問題」を開いて、貼り付け（Ctrl+V）→「チェックする」を押します。',
  '4. エラーがなければ「登録する」を押します。エラーがあるときは、このシートで直して、もう一度コピーして貼り付けます（エラーがあると1行も登録されません）。',
  '5. 登録が終わったら、「問題」シートの書いた行は消してかまいません（次の問題を書くときに、まちがえて2回貼り付けないため）。',
  '## 列の書き方',
  'レベル：N4／N3／N2／N1　　科目：文字・語彙／文法／読解／聴解（プルダウンから選びます）',
  '問題形式：「問題形式の一覧」シートの名前と同じにします（プルダウンから選べます）。表にない名前は、登録はできますが出題されません。',
  '本文：読解・文章の文法の文章。同じ文章の問題は、すべての行に同じ文章を「そのまま」書きます。同じ文章の問題は、ばらばらにならず続けて出題されます。',
  '音声ファイル：聴解の音声のファイル名（例：N3_choukai_001.mp3）。同じ音声の問題は、同じファイル名を書きます。',
  '問題文・選択肢・解説：ふりがなは {漢字|よみ} の形で書きます（例：{日本語|にほんご}）。',
  '正解：正しい選択肢の番号（1〜4）。　状態：「下書き」か「公開」（空のときは下書き）。',
  '## 気をつけること',
  '・漢字読みの問題では、問われている漢字にはふりがなを付けません。問われる言葉は【　】でかこむとわかりやすいです（例：【散歩】）。',
  '・セルの中で改行するときは Ctrl+Enter（Mac は ⌘+Enter）を押します。',
  '・同じ問題をもう一度貼り付けても、2回は登録されません（エラーになります）。',
  '・1回に登録できるのは 500行までです。多いときは分けて貼り付けます。',
  '・「記入例」シートは見本です。ここはコピーしないでください。',
  '## 聴解の音声ファイル',
  '・音声（mp3 など）は、リポジトリの frontend/user/audio/ フォルダに入れて push します。',
  '・ファイル名は半角の英数字にします（例：N3_choukai_001.mp3）。まとめて登録のチェックで、音声が見つからないときは注意が出ます。'
];
const TPL_V_GUIDE = [
  '## このスプレッドシートの使い方',
  '1.「単語カード」シートに、1行に1枚ずつ書きます（うすい黄色のセルが入力するところです。ピンクの見出しは必ず書く列です）。',
  '2. 書いた行の A列〜G列 を選んでコピーします（Ctrl+C。Mac は ⌘+C）。',
  '3. R-ANGUAGE の管理画面 →「まとめて登録」→「単語カード」を開いて、貼り付け（Ctrl+V）→「チェックする」を押します。',
  '4. エラーがなければ「登録する」を押します。エラーがあるときは、このシートで直して、もう一度コピーして貼り付けます（エラーがあると1行も登録されません）。',
  '5. 登録が終わったら、「単語カード」シートの書いた行は消してかまいません。',
  '## 列の書き方',
  'レベル：N4／N3／N2／N1　　単語：カードのおもてに出る言葉（例：経験）　　読み：ひらがな・カタカナ（例：けいけん）',
  '英語の意味：意味が2つ以上あるときは「;」で区切ります（例：promise; appointment）。',
  '例文：ふりがなは {漢字|よみ} の形で書きます（例：{友|とも}だち）。例文の英訳だけを書くことはできません。',
  '状態：「下書き」か「公開」（空のときは下書き）。',
  '## 気をつけること',
  '・同じレベルに、同じ単語・同じ読みのカードは2枚登録できません。別の意味は、英語の意味に「;」で足します。',
  '・セルの中で改行するときは Ctrl+Enter（Mac は ⌘+Enter）を押します。',
  '・1回に登録できるのは 500行までです。多いときは分けて貼り付けます。',
  '・「記入例」シートは見本です。ここはコピーしないでください。'
];

/** 【1回だけ実行】テンプレートのスプレッドシートを2つ作る */
function createImportTemplates() {
  const props = PropertiesService.getScriptProperties();
  const made = [];
  [['TEMPLATE_QUESTIONS_URL', 'R-ANGUAGE 問題テンプレート', buildQuestionTemplate_],
    ['TEMPLATE_CARDS_URL', 'R-ANGUAGE 単語カードテンプレート', buildCardTemplate_]].forEach(function (t) {
    const old = props.getProperty(t[0]);
    if (old) {
      try { SpreadsheetApp.openByUrl(old); Logger.log('すでにあります：' + t[1] + '　' + old); return; } catch (e) { /* 消されていたら作り直す */ }
    }
    const ss = SpreadsheetApp.create(t[1]);
    t[2](ss);
    props.setProperty(t[0], ss.getUrl());
    made.push(t[1]);
    Logger.log('作りました：' + t[1] + '　' + ss.getUrl());
  });
  Logger.log(made.length ? 'Google ドライブの「マイドライブ」にできています。管理画面の「まとめて登録」からも開けます。' : '新しく作ったものはありません。');
}

/** 管理画面用：テンプレートの URL */
function adminImportTemplates_(token) {
  const auth = requireAdmin_(token);
  if (!auth.ok) return auth;
  const props = PropertiesService.getScriptProperties();
  return { ok: true, questions: props.getProperty('TEMPLATE_QUESTIONS_URL') || '', cards: props.getProperty('TEMPLATE_CARDS_URL') || '' };
}

function tplHead_(sheet, cols, widths, required) {
  if (sheet.getMaxRows() < TPL_ROWS + 1) sheet.insertRowsAfter(sheet.getMaxRows(), TPL_ROWS + 1 - sheet.getMaxRows());
  sheet.getRange(1, 1, 1, cols.length).setValues([cols])
    .setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  cols.forEach(function (c, i) {
    sheet.getRange(1, i + 1).setBackground(required.indexOf(c) >= 0 ? TPL_REQ_BG : TPL_HEAD_BG);
    sheet.setColumnWidth(i + 1, widths[i]);
  });
  sheet.setRowHeight(1, 34);
  sheet.setFrozenRows(1);
}

function tplInput_(sheet, ncols) {
  const r = sheet.getRange(2, 1, TPL_ROWS, ncols);
  r.setNumberFormat('@').setWrap(true).setVerticalAlignment('top').setBackground(TPL_INPUT_BG);
}

function tplList_(sheet, col, values, help) {
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).setHelpText(help).build();
  sheet.getRange(2, col, TPL_ROWS, 1).setDataValidation(rule);
}

function tplGuide_(sheet, title, lines) {
  sheet.setColumnWidth(1, 24);
  sheet.setColumnWidth(2, 900);
  sheet.getRange(1, 2).setValue(title).setFontSize(14).setFontWeight('bold');
  lines.forEach(function (ln, i) {
    const cell = sheet.getRange(i + 3, 2);
    if (ln.indexOf('## ') === 0) cell.setValue(ln.slice(3)).setFontWeight('bold').setFontColor('#8338EC').setFontSize(11);
    else cell.setValue(ln).setWrap(true);
  });
  sheet.setHiddenGridlines(true);
}

function tplExamples_(sheet, cols, widths, required, rows) {
  tplHead_(sheet, cols, widths, required);
  sheet.getRange(2, 1, rows.length, cols.length).setNumberFormat('@').setValues(rows).setWrap(true).setVerticalAlignment('top');
  sheet.setTabColor('#4CC9F0');
}

function buildQuestionTemplate_(ss) {
  const guide = ss.getSheets()[0];
  guide.setName('書き方');
  tplGuide_(guide, 'R-ANGUAGE 問題テンプレートの書き方', TPL_Q_GUIDE);

  const input = ss.insertSheet('問題', 1);
  tplHead_(input, TPL_Q_COLS, TPL_Q_WIDTHS, TPL_Q_REQ);
  tplInput_(input, TPL_Q_COLS.length);
  input.setTabColor('#FF006E');

  const counts = readQuestionCounts_();
  const forms = [];
  counts.forEach(function (c) { if (forms.indexOf(c.form) === -1) forms.push(c.form); });
  const list = ss.insertSheet('リスト');
  list.getRange(1, 1, forms.length, 1).setValues(forms.map(function (f) { return [f]; }));

  tplList_(input, 1, LEVEL_LIST, 'N4／N3／N2／N1 から選んでください。');
  tplList_(input, 2, SECTIONS, '文字・語彙／文法／読解／聴解 から選んでください。');
  input.getRange(2, 3, TPL_ROWS, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(list.getRange(1, 1, forms.length, 1), true).setAllowInvalid(false)
      .setHelpText('「問題形式の一覧」シートの名前から選んでください。').build());
  tplList_(input, 11, ['1', '2', '3', '4'], '正しい選択肢の番号（1〜4）を選んでください。');
  tplList_(input, 13, ['下書き', '公開'], '「下書き」か「公開」を選んでください（空なら下書き）。');
  input.getRange(1, 4).setNote('読解・文章の文法で使います。同じ文章の問題は、すべての行に同じ文章をそのまま書きます（続けて出題されます）。');
  input.getRange(1, 5).setNote('聴解で使います。例：N3_choukai_001.mp3（frontend/user/audio/ に入れるファイルの名前）');
  input.getRange(1, 11).setNote('正しい選択肢の番号（1〜4）');
  input.getRange(1, 13).setNote('空のときは「下書き」で登録されます。管理画面で確かめてから「公開」にできます。');

  tplExamples_(ss.insertSheet('記入例', 2), TPL_Q_COLS, TPL_Q_WIDTHS, TPL_Q_REQ, TPL_Q_EXAMPLES);

  const qc = ss.insertSheet('問題形式の一覧', 3);
  tplHead_(qc, ['レベル', '科目', '問題形式', '本番の問題数'], [70, 100, 160, 100], []);
  qc.getRange(2, 1, counts.length, 4).setValues(counts.map(function (c) { return [c.level, c.section, c.form, c.count]; }));
  qc.getRange(counts.length + 3, 1).setValue('出典：日本語能力試験 公式サイトの「問題の構成」（N4 は2020年12月から、N1 の聴解は2022年12月からの数）。R-ANGUAGE のスプレッドシートの QuestionCounts シートと同じです。').setFontSize(9).setFontColor('#555555');
  qc.setTabColor('#06D6A0');

  list.hideSheet();
  ss.setActiveSheet(input);
}

function buildCardTemplate_(ss) {
  const guide = ss.getSheets()[0];
  guide.setName('書き方');
  tplGuide_(guide, 'R-ANGUAGE 単語カードテンプレートの書き方', TPL_V_GUIDE);

  const input = ss.insertSheet('単語カード', 1);
  tplHead_(input, TPL_V_COLS, TPL_V_WIDTHS, TPL_V_REQ);
  tplInput_(input, TPL_V_COLS.length);
  input.setTabColor('#06D6A0');
  tplList_(input, 1, LEVEL_LIST, 'N4／N3／N2／N1 から選んでください。');
  tplList_(input, 7, ['下書き', '公開'], '「下書き」か「公開」を選んでください（空なら下書き）。');
  input.getRange(1, 3).setNote('ひらがな・カタカナで書きます。');
  input.getRange(1, 4).setNote('意味が2つ以上あるときは「;」で区切ります（例：promise; appointment）。');

  tplExamples_(ss.insertSheet('記入例', 2), TPL_V_COLS, TPL_V_WIDTHS, TPL_V_REQ, TPL_V_EXAMPLES);
  ss.setActiveSheet(input);
}
