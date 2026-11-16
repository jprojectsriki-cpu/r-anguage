/**
 * R-ANGUAGE 聴解の読み上げ（ブラウザの音声合成。LP のサンプルと同じしくみ）
 *
 * 本文（スクリプト）の書き方：1行に1つのせりふ。
 *   男：すみません、この近くに郵便局はありますか。
 *   女：ええ、あの角を右に曲がったところですよ。
 * 「男」「女」が入った名前（男の人・女の学生など）は、その声で読みます。
 * 店員・先生など、どちらも入っていない名前には、男女の声を順に割り当てます。
 * 「：」がない行は、ナレーター（場面の説明）として読みます。
 *
 * 受講生の画面（app.html）と管理画面（admin/index.html）の両方で使います。
 */
(function () {
    'use strict';

    var can = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';

    /* 本番で、せんたくしが問題用紙に書かれていない形式（音声だけで聞く） */
    var HIDE_CHOICES = ['概要理解', '発話表現', '即時応答'];
    var NUM = ['いち', 'に', 'さん', 'よん'];
    var POINT_READ_SEC = 10;  // ポイント理解：せんたくしを読む時間

    /* ---------- 声 ---------- */
    // 上にあるほど優先する（iPhone・Mac・Windows・Android・Chrome の日本語の声）
    var FEMALE_RANK = [/kyoko/i, /o-?ren/i, /nanami/i, /haruka/i, /ayumi/i, /sayaka/i, /mizuki/i, /aoi/i, /mayu/i, /shiori/i,
        /google\s*日本語/i, /shelley/i, /sandy/i, /\bflo\b/i, /grandma/i, /female|女性/i];
    var MALE_RANK = [/otoya/i, /hattori/i, /keita/i, /ichiro/i, /daichi/i, /naoki/i, /kenji/i,
        /eddy/i, /reed/i, /rocko/i, /grandpa/i, /\bmale\b|男性/i];
    var V = { list: [], f: null, m: null, any: null };

    function pick(list, rank) {
        for (var k = 0; k < rank.length; k++) {
            var hit = list.filter(function (v) { return rank[k].test(v.name); });
            if (hit.length) {
                // 同じ名前なら、高音質（Enhanced・Premium・拡張）の声を選ぶ
                var hq = hit.filter(function (v) { return /enhanced|premium|拡張|高品質/i.test(v.name); });
                return hq[0] || hit[0];
            }
        }
        return null;
    }

    function loadVoices() {
        if (!can) return;
        var ja = window.speechSynthesis.getVoices().filter(function (v) { return /^ja(-|_|$)/i.test(v.lang); });
        V.list = ja;
        V.f = pick(ja, FEMALE_RANK);
        V.m = pick(ja.filter(function (v) { return v !== V.f; }), MALE_RANK);
        V.any = V.f || ja[0] || null;
    }
    if (can) {
        loadVoices();
        // 声の一覧は、あとから読みこまれることがある
        if (window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }

    /** g: 'm'（男）／'f'（女）／'n'（ナレーター） */
    function voiceFor(g) {
        if (!V.list.length) loadVoices();
        var two = V.f && V.m && V.f !== V.m;
        // 男女の声が両方あるときは、その声で読む。片方しかないときは、同じ声の高さを大きく変えて分ける
        if (g === 'm') return two ? { voice: V.m, pitch: 0.95 } : { voice: V.m || V.any, pitch: V.m ? 0.95 : 0.55 };
        if (g === 'f') return two ? { voice: V.f, pitch: 1.1 } : { voice: V.f || V.any, pitch: V.f ? 1.15 : 1.4 };
        return { voice: V.f || V.any, pitch: 1 };
    }

    /* ---------- 文字 ---------- */
    /** ふりがな {漢字|よみ} は「よみ」にする。下線や空欄の記号は消す（表示や確認用） */
    function plain(text) {
        return clean(String(text || '').replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '$2'));
    }
    /**
     * 読み上げ用：ふりがなは付けずに、漢字のまま音声合成に渡す。
     * ひらがなだけにすると、助詞の「は」を「ハ」、「話し（はなし）」を「わなし」のように読みまちがえるため
     */
    function speakable(text) {
        return clean(String(text || '').replace(/\{([^{}|]+)\|([^{}|]+)\}/g, function (all, base, yomi) {
            return needYomi(base) ? toKatakana(yomi) : base;
        }));
    }
    /**
     * 漢字のままだと読み方が決まらない語は、ふりがなの読みで読ませる。
     * 数字の入った語（一日＝いちにち／ついたち、五日、十分＝じゅっぷん／じゅうぶん、七＝しち／なな など）と、
     * 何（なに／なん）、間・後・方・日など読み方が場面で変わる語。
     * カタカナにして渡すのは、ひらがなだと「は」で始まる語（八時・二十日など）を助詞の「わ」と読むことがあるため
     */
    var YOMI_WORDS = ['間', '後', '方', '日', '中', '明日', '今日', '昨日', '人気', '上手', '下手', '大家', '一行', '生物', '金', '角', '風', '気', '色紙', '市場', '工場', '寒気', '大事', '最中'];
    function needYomi(base) {
        if (/[〇一二三四五六七八九十百千万億何半0-9０-９]/.test(base)) return true;
        return YOMI_WORDS.indexOf(base) >= 0;
    }
    function toKatakana(s) {
        return String(s).replace(/[\u3041-\u3096]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); });
    }
    function clean(text) {
        return String(text || '')
            .replace(/__/g, '')
            .replace(/［\s*[0-9０-９]{1,2}\s*］/g, '')
            .replace(/<[^>]*>/g, '')
            .replace(/[ \t　]+/g, ' ')
            .trim();
    }

    /** スクリプトを、せりふごとに分ける */
    function parseScript(text) {
        var rows = [];
        String(text || '').split(/\r?\n/).forEach(function (line) {
            var t = line.trim();
            if (!t) return;
            var m = t.match(/^([^：:「」。、\s]{1,10})\s*[：:]\s*(.+)$/);
            if (m) rows.push({ role: m[1], text: speakable(m[2]) });
            else rows.push({ role: '', text: speakable(t) });
        });
        // 声を決める：まず「男」「女」が入った名前、そのあとほかの名前
        var map = {}, hasM = false, hasF = false, last = '';
        rows.forEach(function (r) {
            if (!r.role || map[r.role]) return;
            if (/男/.test(r.role)) { map[r.role] = 'm'; hasM = true; }
            else if (/女/.test(r.role)) { map[r.role] = 'f'; hasF = true; }
        });
        rows.forEach(function (r) {
            if (!r.role || map[r.role]) return;
            var g = !hasM ? 'm' : !hasF ? 'f' : (last === 'm' ? 'f' : 'm');
            map[r.role] = g; last = g;
            if (g === 'm') hasM = true; else hasF = true;
        });
        return rows.filter(function (r) { return r.text; }).map(function (r) { return { text: r.text, g: r.role ? map[r.role] : 'n' }; });
    }

    function isListening(q) { return !!q && q.section === '聴解'; }
    function hideChoices(q) { return isListening(q) && HIDE_CHOICES.indexOf(q.form) !== -1; }
    /** 答える前に問題文を見せるか（発話表現は、絵のかわりに場面の文を見せる） */
    function showQuestion(q) { return !isListening(q) || q.form === '発話表現'; }

    /** 読み上げる順番（本番の流れと同じ） */
    function segments(q) {
        var gap = { pause: 1.2 };
        var script = parseScript(q.passage);
        var Q = speakable(q.question) ? [{ text: speakable(q.question), g: 'n' }] : [];
        var chG = 'n';
        if (q.form === '即時応答' && script.length) chG = script[script.length - 1].g === 'm' ? 'f' : 'm'; // 返事は、もう一人が言う
        var ch = [];
        (q.choices || []).forEach(function (c, i) {
            var t = speakable(c);
            if (!t) return;
            if (ch.length) ch.push({ pause: 0.8 });
            ch.push({ text: NUM[i] + '、' + t, g: chG });
        });
        switch (q.form) {
            case '課題理解': return [].concat(Q, [gap], script, [gap], Q);
            case 'ポイント理解': return [].concat(Q, [{ pause: POINT_READ_SEC }], script, [gap], Q);
            case '概要理解': return [].concat(script, [gap], Q, [gap], ch);
            case '発話表現': return [].concat(Q, [gap], ch);
            case '即時応答': return [].concat(script, [gap], ch);
            default:
                return hideChoices(q) ? [].concat(script, [gap], Q, [gap], ch) : [].concat(Q, [gap], script, [gap], Q);
        }
    }

    /* ---------- 再生 ---------- */
    var current = null;
    var CHUNK = 45; // 1回に読ませる文字数のめやす（長いと Android の Chrome などで途中で止まるため）

    function est(sg, rate) { return sg.pause ? sg.pause : sg.text.length * 0.17 / rate + 0.4; }

    /** 長いせりふを「。」「！」「？」、それでも長ければ「、」で区切る */
    function chunkText(text) {
        if (text.length <= CHUNK) return [text];
        var out = [];
        (text.match(/[^。！？!?]+[。！？!?」』）]*|[。！？!?」』）]+/g) || [text]).forEach(function (sent) {
            if (!sent) return;
            if (sent.length <= CHUNK) { out.push(sent); return; }
            var buf = '';
            (sent.match(/[^、，,]+[、，,]*|[、，,]+/g) || [sent]).forEach(function (part) {
                if (buf && (buf + part).length > CHUNK) { out.push(buf); buf = ''; }
                buf += part;
            });
            if (buf) out.push(buf);
        });
        // 短すぎるかけらは前とつなぐ
        var merged = [];
        out.forEach(function (t) {
            if (merged.length && (t.length < 6 || merged[merged.length - 1].length < 6) && (merged[merged.length - 1] + t).length <= CHUNK + 10) merged[merged.length - 1] += t;
            else merged.push(t);
        });
        return merged;
    }
    function expand(segs) {
        var out = [];
        segs.forEach(function (sg) {
            if (sg.pause || !sg.text) { out.push(sg); return; }
            chunkText(sg.text).forEach(function (t) { out.push({ text: t, g: sg.g }); });
        });
        return out;
    }

    /* 再生中は、画面が自動で消えないようにする（対応しているブラウザだけ） */
    var wakeLock = null;
    function holdScreen() {
        try {
            if (navigator.wakeLock && !wakeLock) navigator.wakeLock.request('screen').then(function (w) { wakeLock = w; }).catch(function () { /* 無視 */ });
        } catch (e) { /* 無視 */ }
    }
    function releaseScreen() {
        try { if (wakeLock) wakeLock.release(); } catch (e) { /* 無視 */ }
        wakeLock = null;
    }

    /**
     * 順番に読む。opts: { rate, onProgress(0〜1), onEnd(info) }
     * info.stalled が true のとき：音声が途中で止まって、最後まで読めなかった
     * もどり値の stop()（pause() でも同じ）で止める（このときは onEnd を呼ばない）
     */
    function play(segs, opts) {
        opts = opts || {};
        stop();
        segs = expand(segs);
        var rate = Number(opts.rate) || 1;
        var total = segs.reduce(function (a, s) { return a + est(s, rate); }, 0) || 1;
        var i = -1, done = 0, timer = null, wd = null, stopped = false, stalled = false;
        var keep = []; // iPhone で、読んでいる途中の文が消えて「読み終わり」の知らせが来なくなるのを防ぐ
        var ctl = {
            stop: function () {
                if (stopped) return;
                stopped = true;
                window.clearTimeout(timer); window.clearTimeout(wd);
                try { window.speechSynthesis.cancel(); } catch (e) { /* 無視 */ }
                releaseScreen();
                if (current === ctl) current = null;
            },
            /** 画面を離れたときなど：止めて、途中で止まったことを知らせる */
            abort: function () {
                if (stopped) return;
                stalled = true;
                ctl.stop();
                if (opts.onEnd) opts.onEnd({ stalled: true });
            }
        };
        ctl.pause = ctl.stop;
        function progress() { if (opts.onProgress) opts.onProgress(Math.min(1, done / total)); }
        function finish() {
            stopped = true;
            releaseScreen();
            if (current === ctl) current = null;
            if (opts.onEnd) opts.onEnd({ stalled: stalled });
        }
        function nextSeg() {
            window.clearTimeout(timer); window.clearTimeout(wd);
            if (stopped) return;
            if (i >= 0) { done += est(segs[i], rate); progress(); }
            i++;
            if (i >= segs.length) { finish(); return; }
            var sg = segs[i];
            if (sg.pause) { timer = window.setTimeout(nextSeg, sg.pause * 1000); return; }
            speakSeg(sg, 0);
        }
        function speakSeg(sg, retry) {
            var u = new SpeechSynthesisUtterance(sg.text);
            var vv = voiceFor(sg.g);
            u.lang = 'ja-JP';
            u.rate = rate;
            u.pitch = vv.pitch;
            if (vv.voice) u.voice = vv.voice;
            keep = [u];
            var my = i, fired = false, waited = 0, started = false;
            var fin = function () {
                if (fired || stopped || my !== i) return;
                fired = true;
                window.clearTimeout(wd);
                timer = window.setTimeout(nextSeg, 350);
            };
            u.onstart = function () { started = true; };
            u.onend = fin;
            u.onerror = function (ev) {
                if (fired || stopped || my !== i) return;
                if (ev && (ev.error === 'interrupted' || ev.error === 'canceled')) return; // こちらで止めたとき
                again();
            };
            // 止まったときの見張り：めやすの時間を過ぎても読み終わらないとき
            function watch() {
                if (fired || stopped || my !== i) return;
                var ss = window.speechSynthesis;
                if (ss.speaking && !ss.paused && waited < 2) { waited++; wd = window.setTimeout(watch, (est(sg, rate) + 2) * 1000); return; } // まだ読んでいる
                again();
            }
            // 同じ文をもう一度読む（1回まで）。それでもだめなら、途中で止まったことを知らせる
            function again() {
                if (fired || stopped || my !== i) return;
                fired = true;
                window.clearTimeout(wd);
                try { window.speechSynthesis.cancel(); } catch (e) { /* 無視 */ }
                if (retry < 1) { timer = window.setTimeout(function () { if (!stopped && my === i) speakSeg(sg, retry + 1); }, 300); return; }
                // 2回ともだめなときは、無音のまま待たせないように、ここで止めて知らせる
                ctl.abort();
            }
            wd = window.setTimeout(watch, (est(sg, rate) * 1.6 + 3) * 1000);
            try { window.speechSynthesis.resume(); } catch (e) { /* 無視 */ }
            window.speechSynthesis.speak(u);
        }
        current = ctl;
        if (!can) { stopped = true; current = null; if (opts.onEnd) window.setTimeout(function () { opts.onEnd({ stalled: true }); }, 0); return ctl; }
        try { window.speechSynthesis.cancel(); } catch (e) { /* 無視 */ }
        holdScreen();
        progress();
        timer = window.setTimeout(nextSeg, 120);
        return ctl;
    }

    function stop() { if (current) current.stop(); }

    // ページを移ったら止める
    window.addEventListener('hashchange', stop);
    window.addEventListener('pagehide', stop);
    // ほかのアプリに切りかえる・画面が消えると、読み上げが止まる。止まったことを画面に知らせる
    document.addEventListener('visibilitychange', function () { if (document.hidden && current) current.abort(); });

    window.RListen = {
        can: can, plain: plain, speakable: speakable, parseScript: parseScript, segments: segments, play: play, stop: stop,
        isListening: isListening, hideChoices: hideChoices, showQuestion: showQuestion,
        playQuestion: function (q, opts) { return play(segments(q), opts); },
        /** マイページの音声テスト */
        playTest: function (opts) {
            return play([
                { text: 'これは、音声のテストです。', g: 'n' }, { pause: 0.6 },
                { text: '男の人の声です。', g: 'm' }, { pause: 0.6 },
                { text: '女の人の声です。', g: 'f' }
            ], opts);
        }
    };
})();
