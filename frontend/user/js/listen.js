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
        return clean(String(text || '').replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '$1'));
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

    function est(sg, rate) { return sg.pause ? sg.pause : sg.text.length * 0.17 / rate + 0.4; }

    /**
     * 順番に読む。opts: { rate, onProgress(0〜1), onEnd() }
     * もどり値の stop()（pause() でも同じ）で止める
     */
    function play(segs, opts) {
        opts = opts || {};
        stop();
        var rate = Number(opts.rate) || 1;
        var total = segs.reduce(function (a, s) { return a + est(s, rate); }, 0) || 1;
        var i = -1, done = 0, timer = null, fb = null, stopped = false;
        var ctl = {
            stop: function () {
                if (stopped) return;
                stopped = true;
                window.clearTimeout(timer); window.clearTimeout(fb);
                try { window.speechSynthesis.cancel(); } catch (e) { /* 無視 */ }
                if (current === ctl) current = null;
            }
        };
        ctl.pause = ctl.stop;
        function progress() { if (opts.onProgress) opts.onProgress(Math.min(1, done / total)); }
        function nextSeg() {
            window.clearTimeout(timer); window.clearTimeout(fb);
            if (stopped) return;
            if (i >= 0) { done += est(segs[i], rate); progress(); }
            i++;
            if (i >= segs.length) {
                stopped = true;
                if (current === ctl) current = null;
                if (opts.onEnd) opts.onEnd();
                return;
            }
            var sg = segs[i];
            if (sg.pause) { timer = window.setTimeout(nextSeg, sg.pause * 1000); return; }
            var u = new SpeechSynthesisUtterance(sg.text);
            var vv = voiceFor(sg.g);
            u.lang = 'ja-JP';
            u.rate = rate;
            u.pitch = vv.pitch;
            if (vv.voice) u.voice = vv.voice;
            var my = i, fired = false;
            var fin = function () {
                if (fired || stopped || my !== i) return;
                fired = true;
                window.clearTimeout(fb);
                timer = window.setTimeout(nextSeg, 350);
            };
            u.onend = fin;
            u.onerror = fin;
            // 読み終わりの知らせが来ないブラウザのために、めやすの時間を過ぎたら次へ進む
            fb = window.setTimeout(fin, (est(sg, rate) * 2.5 + 5) * 1000);
            try { window.speechSynthesis.resume(); } catch (e) { /* 無視 */ }
            window.speechSynthesis.speak(u);
        }
        current = ctl;
        if (!can) { stopped = true; current = null; return ctl; }
        try { window.speechSynthesis.cancel(); } catch (e) { /* 無視 */ }
        progress();
        timer = window.setTimeout(nextSeg, 120);
        return ctl;
    }

    function stop() { if (current) current.stop(); }

    // ページを移ったら止める
    window.addEventListener('hashchange', stop);
    window.addEventListener('pagehide', stop);

    window.RListen = {
        can: can, plain: plain, speakable: speakable, parseScript: parseScript, segments: segments, play: play, stop: stop,
        isListening: isListening, hideChoices: hideChoices, showQuestion: showQuestion,
        playQuestion: function (q, opts) { return play(segments(q), opts); }
    };
})();
