/**
 * R-ANGUAGE API - 公開中の問題・単語カードの一覧のキャッシュ
 *
 * - 受講生の画面は、問題や単語カードの一覧を何度も読む。毎回シートを全部読むと遅いので、
 *   読んだ結果を CacheService に 10分間ためておく（1つの値は 100KB までなので、小さく分けて入れる）
 * - 公開中の問題・単語カードはレベルごとに分けてためる。受講生は、自分が使うレベルの分だけ取り出す（2026-11-12）
 * - 管理画面で問題・単語カードを登録・公開・編集・削除したら、データの番号（DATA_VER）を変えて、
 *   古いキャッシュを使わないようにする
 * - スプレッドシートを直接書きかえたときは、最大10分で新しい内容になる（すぐ反映したいときは refreshCache を実行）
 */
const CACHE_TTL_SEC = 600;
const CACHE_CHUNK = 30000; // 1つの値に入れる文字数（日本語でも 100KB をこえないように）

function dataVersion_() {
  return PropertiesService.getScriptProperties().getProperty('DATA_VER') || '0';
}

/** データの番号を変える（キャッシュを使わなくする） */
function bumpDataVersion_() {
  PropertiesService.getScriptProperties().setProperty('DATA_VER', String(Date.now()));
}

/** 管理画面の書きこみが成功したら、データの番号を変える */
function bumpIfOk_(res) {
  if (res && res.ok) bumpDataVersion_();
  return res;
}

/** 小さく分けて入れた値を読む（なければ undefined） */
function cacheGetChunked_(cache, base) {
  try {
    const n = Number(cache.get(base + ':n'));
    if (!(n > 0)) return undefined;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(base + ':' + i);
    const got = cache.getAll(keys);
    if (!keys.every(function (k) { return typeof got[k] === 'string'; })) return undefined;
    return JSON.parse(keys.map(function (k) { return got[k]; }).join(''));
  } catch (e) {
    return undefined; // 読めなければ作り直す
  }
}

/** 値を小さく分けて入れる（parts に足すだけ。入れるのは呼ぶ側の putAll） */
function cacheChunkParts_(base, value, parts) {
  const text = JSON.stringify(value);
  let n = 0;
  for (let i = 0; i < text.length; i += CACHE_CHUNK) parts[base + ':' + (n++)] = text.slice(i, i + CACHE_CHUNK);
  parts[base + ':n'] = String(n);
}

/** name のデータをキャッシュから読む。なければ（force なら必ず）builder() で作って入れる */
function cachedJson_(name, builder, force) {
  const cache = CacheService.getScriptCache();
  const base = name + ':' + dataVersion_();
  if (!force) {
    const hit = cacheGetChunked_(cache, base);
    if (hit !== undefined) return hit;
  }
  const value = builder();
  try {
    const parts = {};
    cacheChunkParts_(base, value, parts);
    cache.putAll(parts, CACHE_TTL_SEC);
  } catch (e) { /* 入れられなくても、そのまま返す */ }
  return value;
}

/**
 * レベルごとに分けてためる（N4 の受講生は N4 の分だけ取り出す）
 * builderAll() は全レベルの一覧（level を持つもの）を返す。どれか1つのレベルがなければ、
 * シートを1回だけ読んで、全レベルの分をまとめて入れ直す
 */
function cachedByLevel_(name, levels, builderAll) {
  levels = (Array.isArray(levels) ? levels : LEVEL_LIST).filter(function (lv) { return LEVEL_LIST.indexOf(lv) >= 0; });
  const cache = CacheService.getScriptCache();
  const ver = dataVersion_();
  const out = [];
  let miss = false;
  for (let i = 0; i < levels.length && !miss; i++) {
    const hit = cacheGetChunked_(cache, name + ':' + levels[i] + ':' + ver);
    if (hit === undefined) miss = true; else Array.prototype.push.apply(out, hit);
  }
  if (!miss || !levels.length) return out;
  const all = builderAll();
  const by = {};
  LEVEL_LIST.forEach(function (lv) { by[lv] = []; });
  all.forEach(function (x) { if (by[x.level]) by[x.level].push(x); });
  try {
    const parts = {};
    LEVEL_LIST.forEach(function (lv) { cacheChunkParts_(name + ':' + lv + ':' + ver, by[lv], parts); });
    cache.putAll(parts, CACHE_TTL_SEC);
  } catch (e) { /* 入れられなくても、そのまま返す */ }
  const res = [];
  levels.forEach(function (lv) { Array.prototype.push.apply(res, by[lv]); });
  return res;
}

/** 【必要なときだけ実行】スプレッドシートを直接書きかえたあと、すぐに受講生の画面に反映する */
function refreshCache() {
  bumpDataVersion_();
  Logger.log('キャッシュを作り直します（次に開いたときに新しい内容を読みます）');
}

/** 【調べるときだけ実行】読み込みの時間とキャッシュのようすを、実行ログに出す（データは変えない） */
function diagnoseSpeed() {
  function step(label, fn) {
    const t0 = Date.now();
    try {
      const v = fn();
      Logger.log(label + '：' + (Date.now() - t0) + 'ms' + (v !== undefined ? '（' + v + '）' : ''));
    } catch (e) {
      Logger.log(label + '：エラー ' + (Date.now() - t0) + 'ms ' + e + (e && e.stack ? '\n' + e.stack : ''));
    }
  }
  Logger.log('DATA_VER：' + dataVersion_());
  step('問題シートを全部読む', function () { return readQuestions_().length + '行'; });
  step('単語カードシートを全部読む', function () { return readCards_().length + '行'; });
  step('採点用の一覧', function () { return Object.keys(questionIndex_()).length + '問'; });
  step('公開中の問題（全レベル）', function () { return readPublicQuestions_().length + '問'; });
  step('公開中のカード（全レベル）', function () { return readPublicCards_().length + '枚'; });
  LEVEL_LIST.forEach(function (lv) {
    step('公開中の問題 ' + lv + ' だけ', function () { return readPublicQuestions_([lv]).length + '問'; });
    step('公開中のカード ' + lv + ' だけ', function () { return readPublicCards_([lv]).length + '枚'; });
  });
  step('キャッシュに入れるテスト', function () {
    const cache = CacheService.getScriptCache();
    cache.putAll({ 'diag:a': 'x'.repeat(30000), 'diag:b': 'あ'.repeat(30000) }, 60);
    const got = cache.getAll(['diag:a', 'diag:b']);
    return '英字 ' + (got['diag:a'] ? 'OK' : 'NG') + '・日本語 ' + (got['diag:b'] ? 'OK' : 'NG');
  });
}
