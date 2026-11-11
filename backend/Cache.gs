/**
 * R-ANGUAGE API - 公開中の問題・単語カードの一覧のキャッシュ
 *
 * - 受講生の画面は、問題や単語カードの一覧を何度も読む。毎回シートを全部読むと遅いので、
 *   読んだ結果を CacheService に 10分間ためておく（1つの値は 100KB までなので、小さく分けて入れる）
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

/** name のデータをキャッシュから読む。なければ（force なら必ず）builder() で作って入れる */
function cachedJson_(name, builder, force) {
  const cache = CacheService.getScriptCache();
  const base = name + ':' + dataVersion_();
  if (!force) try {
    const n = Number(cache.get(base + ':n'));
    if (n > 0) {
      const keys = [];
      for (let i = 0; i < n; i++) keys.push(base + ':' + i);
      const got = cache.getAll(keys);
      if (keys.every(function (k) { return typeof got[k] === 'string'; })) {
        return JSON.parse(keys.map(function (k) { return got[k]; }).join(''));
      }
    }
  } catch (e) { /* 読めなければ作り直す */ }
  const value = builder();
  try {
    const text = JSON.stringify(value);
    const parts = {};
    let n = 0;
    for (let i = 0; i < text.length; i += CACHE_CHUNK) parts[base + ':' + (n++)] = text.slice(i, i + CACHE_CHUNK);
    parts[base + ':n'] = String(n);
    cache.putAll(parts, CACHE_TTL_SEC);
  } catch (e) { /* 入れられなくても、そのまま返す */ }
  return value;
}

/** 【必要なときだけ実行】スプレッドシートを直接書きかえたあと、すぐに受講生の画面に反映する */
function refreshCache() {
  bumpDataVersion_();
  Logger.log('キャッシュを作り直します（次に開いたときに新しい内容を読みます）');
}
