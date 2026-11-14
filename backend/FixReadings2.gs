/**
 * R-ANGUAGE API - 日付・時間のふりがなの見直し（2026-11-15）【必要なときに実行】
 *
 *   previewReadings2() … 直す予定の箇所と、目で確かめてほしい箇所をログに出す（何も変えない）
 *   fixReadings2()     … 直す（何回実行しても同じ結果。直すものがなければ何も変えない）
 *
 * 直すもの（Questions の本文・問題文・選択肢・解説、Vocab の例文）：
 *   1. 「〇月一日」の一日 → ついたち（いちにち になっているもの）
 *   2. 二日〜十日・十四日・二十日・二十四日の読み → ふつか・みっか…はつか（ごにち などになっているもの）
 *   3. 十分（じゅっぷん／じゅうぶん）を、前後の言葉から決められるもの
 *      じゅうぶん：十分に・十分だ・十分な・十分では・十分でな・十分だっ・十分すぎ・十分とは・十分可能 など
 *      じゅっぷん：〇時十分・十分ぐらい・十分前・十分後・十分間・十分ほど・十分おき・十分遅れ・十分早く・十分待つ・十分かかる、
 *                  およそ十分・あと十分・歩いて十分・駅まで十分、すぐ前に「十五分」などほかの時間がある など
 *      十分の一 → じゅうぶん
 *   決められない「十分です」「十分って」などは、ログの「目で確かめてほしい箇所」に出す
 */

const FIX2_DATE_YOMI = {
  '二日': 'ふつか', '三日': 'みっか', '四日': 'よっか', '五日': 'いつか', '六日': 'むいか',
  '七日': 'なのか', '八日': 'ようか', '九日': 'ここのか', '十日': 'とおか',
  '十四日': 'じゅうよっか', '二十日': 'はつか', '二十四日': 'にじゅうよっか'
};
const FIX2_ENOUGH_AFTER = /^(に(?![はも]?[一二三四五六七八九十0-9]|一|回|一本|ごと|一度)|だ|な(?!い)|では|でな|でしょ|だっ|すぎ|過ぎ|とは|とい|可能|理解|注意|気をつけ|\{気|\{注意|\{理解|\{可能|\{過)/;
const FIX2_MINUTE_AFTER = /^(ぐらい|くらい|前|後|間|ほど|おき|遅|早|待|かか|歩|たっ|経|以内|以上|ずつ|しか|程度|\{前|\{後|\{間|\{程度|\{以内|\{以上|\{遅|\{早|\{待|\{歩|\{経)/;

function fix2Plain_(s) { return String(s || '').replace(/\{([^{}|]+)\|[^{}|]+\}/g, '$1'); }

/** 1つの文字列を直す。log には {type, before, after} を足す */
function fix2Text_(s, log) {
  let t = String(s);
  // 1. 〇月一日 → ついたち
  t = t.replace(/(月(?:\|[^{}|]*)?\}?)\{一日\|いちにち\}/g, function (all, pre) {
    log.push({ type: '一日→ついたち', before: all, after: pre + '{一日|ついたち}' });
    return pre + '{一日|ついたち}';
  });
  t = t.replace(/\{([^{}|]*月一日)\|([^{}|]*)いちにち\}/g, function (all, base, y) {
    const a = '{' + base + '|' + y + 'ついたち}';
    log.push({ type: '一日→ついたち', before: all, after: a });
    return a;
  });
  // 2. 二日〜十日など
  t = t.replace(/\{((?:[^{}|]*月)?)(二十四日|二十日|十四日|十日|[二三四五六七八九]日)\|([^{}|]*)\}/g, function (all, mon, day, y) {
    const want = FIX2_DATE_YOMI[day];
    if (!want || y.slice(-want.length) === want) return all;
    if (mon) {
      // 〇月〇日 をまとめたふりがな：月の読みはそのまま、日の読みだけ直す
      const m = y.match(/^(.*?がつ)/);
      if (!m) return all;
      const a = '{' + mon + day + '|' + m[1] + want + '}';
      log.push({ type: '日付の読み', before: all, after: a });
      return a;
    }
    const a = '{' + day + '|' + want + '}';
    log.push({ type: '日付の読み', before: all, after: a });
    return a;
  });
  // 3. 十分
  t = t.replace(/\{十分\|(じゅうぶん|じゅっぷん|じっぷん)\}/g, function (all, y, off, str) {
    const after = str.slice(off + all.length);
    const before = fix2Plain_(str.slice(Math.max(0, off - 80), off)).replace(/_/g, '').slice(-30);
    let want = '';
    if (/時\}?$/.test(str.slice(0, off)) || /時$/.test(before)) want = 'じゅっぷん';
    else if (/^の\{?一/.test(after)) want = 'じゅうぶん';                       // 十分の一
    else if (FIX2_MINUTE_AFTER.test(after)) want = 'じゅっぷん';
    else if (/(およそ|約|あと|歩いて|走って|車で|自転車で|バスで|電車で|まで、?)$/.test(before)) want = 'じゅっぷん';
    else if (FIX2_ENOUGH_AFTER.test(after)) want = 'じゅうぶん';
    else if (/[一二三四五六七八九十0-9０-９]分/.test(before)) want = 'じゅっぷん';   // すぐ前に「十五分」など、ほかの時間
    if (!want) {
      log.push({ type: '確認', before: before + '【十分（' + y + '）】' + fix2Plain_(after).slice(0, 15), after: '' });
      return all;
    }
    if (want === y) return all;
    const a = '{十分|' + want + '}';
    log.push({ type: '十分の読み', before: before.slice(-12) + all + fix2Plain_(after).slice(0, 8), after: a });
    return a;
  });
  return t;
}

function previewReadings2() { fixReadings2_(false); }
function fixReadings2() { fixReadings2_(true); }

function fixReadings2_(doWrite) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = [], check = [];
  let qFixed = 0, vFixed = 0;
  const colName = { 4: '本文', 6: '問題文', 7: '選択肢1', 8: '選択肢2', 9: '選択肢3', 10: '選択肢4', 12: '解説' };

  const qs = ss.getSheetByName(SHEET_QUESTIONS);
  const qLast = qs.getLastRow();
  if (qLast > 1) {
    const values = qs.getRange(2, 1, qLast - 1, 13).getValues();
    values.forEach(function (r, i) {
      if (!r[0]) return;
      let changed = false;
      [4, 6, 7, 8, 9, 10, 12].forEach(function (c) {
        if (typeof r[c] !== 'string' || !r[c]) return;
        const log = [];
        const t = fix2Text_(r[c], log);
        log.forEach(function (l) {
          const head = r[0] + '（' + r[1] + ' ' + r[3] + '・' + colName[c] + '）';
          if (l.type === '確認') check.push(head + '　' + l.before);
          else out.push(head + '　' + l.type + '：' + l.before + ' → ' + l.after);
        });
        if (t !== r[c]) {
          changed = true;
          if (doWrite) qs.getRange(i + 2, c + 1).setValue(t);
        }
      });
      if (changed) qFixed++;
    });
  }

  const vs = ss.getSheetByName(SHEET_VOCAB);
  const vLast = vs ? vs.getLastRow() : 0;
  if (vLast > 1) {
    const vv = vs.getRange(2, 1, vLast - 1, 6).getValues();
    vv.forEach(function (r, i) {
      if (typeof r[5] !== 'string' || !r[5]) return;
      const log = [];
      const t = fix2Text_(r[5], log);
      log.forEach(function (l) {
        const head = r[0] + '（単語カード ' + r[1] + ' ' + r[2] + '・例文）';
        if (l.type === '確認') check.push(head + '　' + l.before);
        else out.push(head + '　' + l.type + '：' + l.before + ' → ' + l.after);
      });
      if (t !== r[5]) {
        vFixed++;
        if (doWrite) vs.getRange(i + 2, 6).setValue(t);
      }
    });
  }

  if (doWrite && (qFixed || vFixed)) bumpDataVersion_();

  const lines = [];
  lines.push(doWrite ? '【実行】問題 ' + qFixed + '件・単語カード ' + vFixed + '件を直しました'
                     : '【確認だけ】fixReadings2 を実行すると、問題 ' + qFixed + '件・単語カード ' + vFixed + '件を直します（まだ何も変えていません）');
  lines.push('');
  lines.push('■ 直す箇所：' + out.length + 'か所');
  out.forEach(function (s) { lines.push('・' + s); });
  lines.push('');
  lines.push('■ 目で確かめてほしい箇所（自動では直しません）：' + check.length + 'か所');
  check.forEach(function (s) { lines.push('・' + s); });
  Logger.log(lines.join('\n'));
}
