/* R-ANGUAGE 受講生の画面：模擬試験（R-10d）
 * - 科目（N1・N2 は2科目、N3・N4 は3科目）ごとにタイマー。時間になると自動で次の科目へ
 * - 科目の中では、問題を行ったり来たりできる（問題の一覧・あとで見直す印）。答えはさいごにまとめて出る
 * - 聴解の音声は本番と同じで1回だけ（再生ボタンを押すと最後まで流れ、もう一度は押せない）
 * - とちゅうの状態はこのブラウザ（localStorage）に残す。閉じている・ほかのページにいるあいだ、時間は止まる
 * - 模試の最中は、下のメニューを隠す（body.is-exam）
 * ※ app.js のあとに読み込むこと（window.RApp を使う）
 */
(function () {
    'use strict';

    var A = window.RApp;
    var h = function (t, a, c) { return A.h(t, a, c); };
    var LEVEL_KEY = 'ranguage_mlevel';
    var SECTION_ST = { '文字・語彙': 'moji', '文法': 'bunpo', '読解': 'dokkai', '聴解': 'choukai' };
    var M = { menu: null, exam: null, timer: 0, playing: false };

    function $(id) { return document.getElementById(id); }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても続ける */ } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 無視 */ } }
    function saveKey() { return 'ranguage_mock_' + (((A.state.profile || {}).user || {}).email || ''); }
    function save() { if (M.exam) { M.exam.savedAt = Date.now(); lsSet(saveKey(), JSON.stringify(M.exam)); } }
    function loadSaved() {
        var raw = lsGet(saveKey());
        if (!raw) return null;
        try { var e = JSON.parse(raw); return e && e.papers ? e : null; } catch (err) { return null; }
    }
    function clearSaved() { lsDel(saveKey()); }
    function mmss(sec) {
        sec = Math.max(0, Math.floor(sec));
        var m = Math.floor(sec / 60), s = sec % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
    }
    function dateText(iso) {
        var d = new Date(iso);
        if (isNaN(d)) return '';
        return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    }
    function resultClass(r) { return r === '合格' ? 'is-pass' : r === '不合格' ? 'is-fail' : 'is-none'; }
    function resultLabel(r) { return r === '合格' ? '{合格|ごうかく}の{目安|めやす}' : r === '不合格' ? 'もう{少|すこ}し！' : '{判定|はんてい}なし'; }

    /* ===================== ページを離れたら止める ===================== */
    function stopExamView() {
        window.clearInterval(M.timer);
        M.timer = 0;
        document.body.classList.remove('is-exam');
        if (M.audioEl) { try { M.audioEl.pause(); } catch (e) { /* 無視 */ } M.audioEl = null; }
        M.playing = false;
        save();
    }
    window.addEventListener('hashchange', function () { if (M.timer || document.body.classList.contains('is-exam')) stopExamView(); });
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') save(); });

    /* ===================== メニュー ===================== */
    function renderMenu(main) {
        stopExamView();
        M.exam = null;
        A.setTitle('{模擬|もぎ}{試験|しけん}');
        A.withLoading('<ruby>模試<rt>もし</rt></ruby>を<ruby>読<rt>よ</rt></ruby>み<ruby>込<rt>こ</rt></ruby>んでいます', A.apiPost({ action: 'me.mockMenu' }))
            .then(function (res) {
                if (A.authFailed(res)) return;
                if (!res || !res.ok) throw new Error((res && res.message) || 'menu failed');
                M.menu = res;
                drawMenu(main);
            })
            .catch(function (err) {
                console.error(err);
                main.replaceChildren(h('section', { class: 'card soon' }, [
                    h('p', { html: '{読|よ}み{込|こ}めませんでした。{時間|じかん}をおいて、もう{一度|いちど}{開|ひら}いてください。' })
                ]));
            });
    }

    function drawMenu(main) {
        var m = M.menu;
        main.replaceChildren();

        // 続きから
        var saved = loadSaved();
        if (saved && m.levels.some(function (x) { return x.level === saved.level; })) {
            var sp = saved.papers[saved.p];
            main.append(h('section', { class: 'card m-resume' }, [
                A.sticker('st-mock', 'm-resume-st'),
                h('div', { class: 'm-resume-body' }, [
                    h('p', { class: 'm-resume-title', html: saved.level + ' {模試|もし}のとちゅうです' }),
                    h('p', { class: 'm-resume-sub', html: sp.name + '・{残|のこ}り ' + mmss(sp.left) }),
                    h('div', { class: 'm-resume-btns' }, [
                        h('button', { type: 'button', class: 'pop-btn btn-pink btn-sm', html: '{続|つづ}きから', onclick: function () { resume(saved); } }),
                        h('button', { type: 'button', class: 'pop-btn btn-white btn-sm', html: 'やめる', onclick: function () { discard(main); } })
                    ])
                ])
            ]));
        }

        if (!m.levels.length) {
            main.append(h('section', { class: 'card soon' }, [
                h('p', { class: 'soon-icon' }, [A.sticker('st-mock')]),
                h('p', { html: '{使|つか}えるレベルがまだありません。' }),
                h('a', { class: 'pop-btn btn-pink', href: '#mypage', html: 'マイページへ' })
            ]));
            return;
        }
        var lvKey = lsGet(LEVEL_KEY) || '';
        var lv = m.levels.filter(function (x) { return x.level === lvKey; })[0] || m.levels[0];
        { // レベルは1つだけでも、いつも出す（どのレベルの画面かわかるように）
            var bar = h('div', { class: 'lv-tabs', role: 'tablist', 'aria-label': 'レベル' }, [h('span', { class: 'lv-tabs-label', text: 'レベル' })]);
            m.levels.forEach(function (x) {
                bar.append(h('button', {
                    type: 'button', role: 'tab', class: 'lv lv-' + x.level + ' lv-tab', 'aria-selected': String(x.level === lv.level), text: x.level,
                    onclick: function () { lsSet(LEVEL_KEY, x.level); drawMenu(main); }
                }));
            });
            if (!m.isAdmin && m.levels.length < 4) bar.append(h('a', { class: 'lv-add', href: '#mypage', html: '＋レベルを{追加|ついか}' }));
            main.append(bar);
        }
        if (m.isAdmin) main.append(h('p', { class: 'admin-note', text: '管理者アカウントなので、すべてのレベルを受けられます（確認用）。結果も記録されます。' }));

        // 試験の形
        var want = 0, have = 0, minutes = 0;
        lv.papers.forEach(function (p) { want += p.want; have += p.have; minutes += p.minutes; });
        main.append(h('section', { class: 'card m-plan' }, [
            h('div', { class: 'm-plan-head' }, [
                A.sticker('st-mock', 'sec-st'),
                h('div', {}, [
                    h('h2', { class: 'sec-title', html: lv.level + ' {模擬|もぎ}{試験|しけん}' }),
                    h('p', { class: 'm-plan-sub', html: '{全部|ぜんぶ}で ' + minutes + '{分|ふん}・' + want + '{問|もん}　{合格点|ごうかくてん} ' + lv.pass + ' / 180' })
                ])
            ]),
            h('ol', { class: 'm-papers' }, lv.papers.map(function (p, i) {
                return h('li', {}, [
                    h('span', { class: 'm-paper-no', text: String(i + 1) }),
                    h('span', { class: 'm-paper-name', html: p.name }),
                    h('span', { class: 'm-paper-time', html: p.minutes + '{分|ふん}' }),
                    h('span', { class: 'm-paper-num', html: (p.have < p.want ? p.have + ' / ' : '') + p.want + '{問|もん}' })
                ]);
            })),
            have < want ? h('p', { class: 'note', html: have === 0 ? 'このレベルの{問題|もんだい}は、まだありません。' : 'いまは ' + have + '{問|もん}だけです（{問題|もんだい}をふやしています）。いまある{問題|もんだい}だけで{受|う}けられます。' }) : null,
            h('button', { type: 'button', class: 'pop-btn btn-pink btn-block', disabled: have === 0, html: '{模試|もし}を{始|はじ}める', onclick: function () { confirmStart(lv, saved); } })
        ]));

        // きまり
        main.append(h('section', { class: 'card m-rules' }, [
            h('h2', { class: 'card-title', html: '{模試|もし}のきまり' }),
            h('ul', {}, [
                ['i-check', '{科目|かもく}ごとに{時間|じかん}があります。{時間|じかん}になると、{自動|じどう}で{次|つぎ}の{科目|かもく}に{進|すす}みます。'],
                ['i-check', '{科目|かもく}の{中|なか}では、{問題|もんだい}を{自由|じゆう}に{行|い}ったり{来|き}たりできます。'],
                ['i-check', '{答|こた}えと{解説|かいせつ}は、さいごにまとめて{出|で}ます。'],
                ['i-sound', '{聴解|ちょうかい}の{音声|おんせい}は、{本番|ほんばん}と{同|おな}じで「1{回|かい}だけ」です。{再生|さいせい}ボタンを{押|お}すと{最後|さいご}まで{流|なが}れて、もう{一度|いちど}は{聞|き}けません。'],
                ['i-redo', 'とちゅうで{画面|がめん}を{閉|と}じても、このブラウザで{開|ひら}けば{続|つづ}きから{始|はじ}められます。{閉|と}じているあいだ、{時間|じかん}は{止|と}まります。']
            ].map(function (x) {
                var li = h('li', {}, [A.icon(x[0]), h('span', { html: x[1] })]);
                return li;
            }))
        ]));

        // 今までの結果
        var hist = m.history.filter(function (x) { return x.level === lv.level; });
        var box = h('section', { class: 'card' }, [h('h2', { class: 'card-title', html: '{今|いま}までの{結果|けっか}' })]);
        if (!hist.length) box.append(h('p', { class: 'muted', html: 'まだ{受|う}けていません。' }));
        else {
            box.append(h('ul', { class: 'm-history' }, hist.map(function (r) {
                return h('li', {}, [h('button', { type: 'button', class: 'm-hist-btn', onclick: function () { openResult(r.resultId); } }, [
                    h('span', { class: 'm-hist-date', text: dateText(r.at) }),
                    h('span', { class: 'm-hist-score' }, [h('b', { text: String(r.total) }), document.createTextNode(' / 180')]),
                    h('span', { class: 'm-badge ' + resultClass(r.result), html: resultLabel(r.result) }),
                    A.icon('i-chev')
                ])]);
            })));
        }
        main.append(box);
    }

    function discard(main) {
        A.confirmBox({ title: 'とちゅうの{模試|もし}をやめますか？', body: h('p', { html: 'とちゅうの{答|こた}えは{消|き}えます。{結果|けっか}は{残|のこ}りません。' }), ok: 'やめる' })
            .then(function (yes) { if (yes) { clearSaved(); drawMenu(main); } });
    }

    function confirmStart(lv, saved) {
        var body = h('div', {}, [
            h('p', { html: lv.level + 'の{模試|もし}を{始|はじ}めます。{最初|さいしょ}の{科目|かもく}は「' + lv.papers[0].name + '」（' + lv.papers[0].minutes + '{分|ふん}）です。' }),
            saved ? h('p', { class: 'note', html: 'とちゅうの{模試|もし}は{消|き}えます。' }) : null,
            h('p', { class: 'note', html: '{聴解|ちょうかい}の{音声|おんせい}は1{回|かい}だけです。イヤホンを{用意|ようい}しておきましょう。' })
        ]);
        A.confirmBox({ title: '{模試|もし}を{始|はじ}めますか？', body: body, ok: '{始|はじ}める' }).then(function (yes) {
            if (!yes) return;
            A.withLoading('<ruby>問題<rt>もんだい</rt></ruby>を<ruby>用意<rt>ようい</rt></ruby>しています', A.apiPost({ action: 'me.mockStart', level: lv.level }))
                .then(function (res) {
                    if (A.authFailed(res)) return;
                    if (!res || !res.ok) { A.toast((res && res.message) || '{始|はじ}められませんでした。', true); return; }
                    M.exam = {
                        level: res.level,
                        papers: res.papers.map(function (p) { return { key: p.key, name: p.name, minutes: p.minutes, left: p.minutes * 60, questions: p.questions, done: false }; }),
                        p: 0, i: 0, phase: 'before', answers: {}, flags: {}, played: {}, startedAt: Date.now()
                    };
                    skipEmpty();
                    save();
                    drawExam();
                })
                .catch(function (err) {
                    console.error(err);
                    A.toast('{通信|つうしん}に{失敗|しっぱい}しました。もう{一度|いちど}お{試|ため}しください。', true);
                });
        });
    }

    function resume(saved) {
        M.exam = saved;
        if (M.exam.phase === 'paper') M.exam.phase = 'resume';
        drawExam();
    }

    /** 問題が0問の科目はとばす */
    function skipEmpty() {
        var e = M.exam;
        while (e.p < e.papers.length && !e.papers[e.p].questions.length) { e.papers[e.p].done = true; e.p++; }
    }

    /* ===================== 試験の画面 ===================== */
    function drawExam() {
        var e = M.exam;
        if (e.p >= e.papers.length) { submit(); return; }
        document.body.classList.add('is-exam');
        if (e.phase === 'before' || e.phase === 'resume') drawBefore();
        else drawQuestion();
    }

    /** 科目の始まり（または、続きから） */
    function drawBefore() {
        var e = M.exam;
        var pp = e.papers[e.p];
        var main = $('main');
        window.clearInterval(M.timer);
        main.replaceChildren();
        A.setTitle(e.level + ' {模試|もし}');
        var isListening = pp.questions.some(function (q) { return q.section === '聴解'; });
        main.append(h('section', { class: 'card m-before' }, [
            h('p', { class: 'm-step', html: '{科目|かもく} ' + (e.p + 1) + ' / ' + e.papers.length }),
            A.sticker('st-' + (SECTION_ST[pp.questions[0].section] || 'mock'), 'm-before-st'),
            h('h2', { class: 'm-before-title', html: pp.name }),
            h('p', { class: 'm-before-time' }, [h('b', { text: e.phase === 'resume' ? mmss(pp.left) : String(pp.minutes) }), h('span', { html: e.phase === 'resume' ? '{残|のこ}り' : '{分|ふん}' })]),
            h('p', { class: 'm-before-sub', html: pp.questions.length + '{問|もん}' + (e.phase === 'resume' ? '・{答|こた}えた{問題|もんだい} ' + answeredCount(pp) + '{問|もん}' : '') }),
            isListening ? h('p', { class: 'm-listen-note' }, [A.icon('i-sound'), h('span', { html: '{音声|おんせい}は1{問|もん}につき1{回|かい}だけ{流|なが}せます。{再生|さいせい}ボタンを{押|お}すと{最後|さいご}まで{流|なが}れて、もう{一度|いちど}は{聞|き}けません。{音|おと}が{出|で}る{準備|じゅんび}をしてから{始|はじ}めてください。' })]) : null,
            e.notice ? h('p', { class: 'm-notice', html: e.notice }) : null,
            h('button', {
                type: 'button', class: 'pop-btn btn-pink btn-block', html: e.phase === 'resume' ? '{続|つづ}きから{始|はじ}める' : '{始|はじ}める',
                onclick: function () { e.notice = ''; e.phase = 'paper'; save(); drawQuestion(); }
            }),
            h('button', { type: 'button', class: 'm-link', html: '{中断|ちゅうだん}してメニューへ（{続|つづ}きはあとで）', onclick: pauseToMenu })
        ]));
        window.scrollTo(0, 0);
    }

    function answeredCount(pp) {
        return pp.questions.filter(function (q) { return M.exam.answers[q.questionId]; }).length;
    }

    function startTimer() {
        window.clearInterval(M.timer);
        M.timer = window.setInterval(function () {
            var e = M.exam;
            if (!e || e.phase !== 'paper') return;
            if (document.visibilityState !== 'visible') return; // 見ていないあいだは止まる
            var pp = e.papers[e.p];
            pp.left -= 1;
            var t = $('mTimer');
            if (t) {
                t.textContent = mmss(pp.left);
                t.parentNode.classList.toggle('is-low', pp.left <= 300);
            }
            if (pp.left % 5 === 0) save();
            if (pp.left <= 0) timeUp();
        }, 1000);
    }

    function drawQuestion() {
        var e = M.exam;
        var pp = e.papers[e.p];
        var q = pp.questions[e.i];
        var main = $('main');
        main.replaceChildren();
        A.setTitle(pp.name);
        startTimer();

        main.append(h('div', { class: 'm-head' }, [
            h('span', { class: 'm-timer' + (pp.left <= 300 ? ' is-low' : '') }, [A.sticker('st-mock', 'm-timer-st'), h('b', { id: 'mTimer', text: mmss(pp.left) })]),
            h('span', { class: 'm-pos' }, [h('b', { text: String(e.i + 1) }), document.createTextNode(' / ' + pp.questions.length)]),
            h('button', { type: 'button', class: 'm-list-btn', html: '{問題|もんだい}の{一覧|いちらん}', onclick: openList })
        ]));

        var card = h('section', { class: 'card quiz-card' });
        card.append(h('p', { class: 'quiz-form' }, [A.sticker('st-' + (SECTION_ST[q.section] || 'mock'), 'form-st'), h('span', { text: q.form || q.section })]));
        if (q.audio) card.append(audioBlock(q));
        if (String(q.passage || '').trim()) card.append(h('div', { class: 'quiz-passage', html: q.passage }));
        card.append(h('p', { class: 'quiz-question', html: q.question }));
        var choices = h('ol', { class: 'choices' });
        q.choices.forEach(function (c, idx) {
            var n = idx + 1;
            choices.append(h('li', {}, [h('button', {
                type: 'button', class: 'choice', 'aria-pressed': String(e.answers[q.questionId] === n),
                onclick: function () {
                    e.answers[q.questionId] = n;
                    save();
                    choices.querySelectorAll('.choice').forEach(function (b, k) { b.setAttribute('aria-pressed', String(k + 1 === n)); });
                }
            }, [h('span', { class: 'choice-num', text: String(n) }), h('span', { class: 'choice-text', html: c })])]));
        });
        card.append(choices);
        main.append(card);

        var flag = h('button', {
            type: 'button', class: 'm-flag', 'aria-pressed': String(!!e.flags[q.questionId]),
            onclick: function () {
                e.flags[q.questionId] = !e.flags[q.questionId];
                this.setAttribute('aria-pressed', String(e.flags[q.questionId]));
                save();
            }
        }, [A.icon('i-flag'), h('span', { html: 'あとで{見直|みなお}す' })]);
        var last = e.i === pp.questions.length - 1;
        main.append(h('div', { class: 'm-nav' }, [
            h('button', { type: 'button', class: 'pop-btn btn-white m-prev', disabled: e.i === 0, html: '{前|まえ}へ', onclick: function () { go(e.i - 1); } }),
            flag,
            h('button', { type: 'button', class: 'pop-btn btn-purple m-next', html: last ? '{一覧|いちらん}へ' : '{次|つぎ}へ', onclick: function () { if (last) openList(); else go(e.i + 1); } })
        ]));
        window.scrollTo(0, 0);
    }

    function go(i) {
        if (M.playing) { A.toast('{音声|おんせい}が{終|お}わるまで{待|ま}ってください'); return; }
        M.exam.i = i;
        save();
        drawQuestion();
    }

    /** 聴解の音声（1回だけ） */
    function audioBlock(q) {
        var e = M.exam;
        var key = q.audio;
        var box = h('div', { class: 'm-audio' });
        function drawState(state) {
            box.replaceChildren();
            if (state === 'played') {
                box.append(h('p', { class: 'm-audio-done' }, [A.icon('i-check'), h('span', { html: '{音声|おんせい}は{再生|さいせい}しました（1{回|かい}だけ）' })]));
                return;
            }
            if (state === 'playing') {
                box.append(h('p', { class: 'm-audio-playing' }, [A.icon('i-sound'), h('span', { html: '{再生中|さいせいちゅう}…{最後|さいご}まで{聞|き}いてください' })]),
                    h('div', { class: 'quiz-bar m-audio-bar' }, [h('span', { id: 'mAudioBar', style: 'width:0%' })]));
                return;
            }
            box.append(
                h('button', { type: 'button', class: 'pop-btn btn-pink btn-block m-play', onclick: play }, [A.icon('i-sound'), h('span', { html: '{音声|おんせい}を{流|なが}す（1{回|かい}だけ）' })]),
                h('p', { class: 'note', html: '{押|お}すと{最後|さいご}まで{流|なが}れます。とちゅうで{止|と}めたり、もう{一度|いちど}{聞|き}いたりはできません。' })
            );
        }
        function play() {
            var audio = new Audio('audio/' + encodeURIComponent(key));
            audio.playbackRate = 1;
            M.audioEl = audio;
            audio.addEventListener('timeupdate', function () {
                var bar = $('mAudioBar');
                if (bar && audio.duration) bar.style.width = Math.round(audio.currentTime / audio.duration * 100) + '%';
            });
            audio.addEventListener('ended', function () { M.playing = false; M.audioEl = null; drawState('played'); });
            audio.addEventListener('error', function () {
                // 読み込めなかったときは、回数に数えない
                M.playing = false; M.audioEl = null;
                delete e.played[key]; save();
                drawState('ready');
                A.toast('{音声|おんせい}を{読|よ}み{込|こ}めませんでした。もう{一度|いちど}{押|お}してください。', true);
            });
            e.played[key] = true;
            save();
            M.playing = true;
            drawState('playing');
            var pr = audio.play();
            if (pr && pr.catch) pr.catch(function () { audio.dispatchEvent(new Event('error')); });
        }
        drawState(e.played[key] ? 'played' : 'ready');
        return box;
    }

    /* ---------- 問題の一覧 ---------- */
    function openList() {
        if (M.playing) { A.toast('{音声|おんせい}が{終|お}わるまで{待|ま}ってください'); return; }
        var e = M.exam;
        var pp = e.papers[e.p];
        var left = pp.questions.length - answeredCount(pp);
        var grid = h('div', { class: 'm-grid' }, pp.questions.map(function (q, i) {
            var cls = 'm-cell' + (e.answers[q.questionId] ? ' is-done' : '') + (e.flags[q.questionId] ? ' is-flag' : '') + (i === e.i ? ' is-now' : '');
            return h('button', { type: 'button', class: cls, value: 'cancel', text: String(i + 1), onclick: function () { closeList(); go(i); } });
        }));
        var body = h('div', {}, [
            h('p', { class: 'm-legend' }, [
                h('span', { class: 'm-cell is-done m-cell-sm' }), h('span', { html: '{答|こた}えた' }),
                h('span', { class: 'm-cell is-flag m-cell-sm' }), h('span', { html: 'あとで{見直|みなお}す' }),
                h('span', { class: 'm-cell m-cell-sm' }), h('span', { html: 'まだ' })
            ]),
            grid,
            h('p', { class: 'note', html: left ? 'まだ{答|こた}えていない{問題|もんだい}が ' + left + '{問|もん}あります。' : '{全部|ぜんぶ}の{問題|もんだい}に{答|こた}えました。' }),
            h('button', { type: 'button', class: 'm-link', html: '{中断|ちゅうだん}してメニューへ（{続|つづ}きはあとで）', onclick: function () { closeList(); pauseToMenu(); } })
        ]);
        A.confirmBox({ title: pp.name + '（{残|のこ}り ' + mmss(pp.left) + '）', body: body, ok: 'この{科目|かもく}を{終|お}える' }).then(function (yes) {
            if (yes) endPaper(false);
        });
    }
    function closeList() {
        var d = $('confirmDialog');
        if (d.open) d.close('cancel');
    }

    function pauseToMenu() {
        stopExamView();
        A.toast('{続|つづ}きは「{模試|もし}」から{始|はじ}められます');
        M.exam = null;
        renderMenu($('main'));
    }

    function timeUp() {
        window.clearInterval(M.timer);
        closeList();
        endPaper(true);
    }

    function endPaper(byTime) {
        var e = M.exam;
        if (M.audioEl) { try { M.audioEl.pause(); } catch (err) { /* 無視 */ } M.audioEl = null; M.playing = false; }
        window.clearInterval(M.timer);
        e.papers[e.p].done = true;
        e.p++;
        e.i = 0;
        skipEmpty();
        e.phase = 'before';
        e.notice = byTime ? '{時間|じかん}になったので、{前|まえ}の{科目|かもく}は{終|お}わりました。' : '';
        save();
        if (e.p >= e.papers.length) submit();
        else drawBefore();
    }

    /* ===================== 採点 ===================== */
    function submit() {
        var e = M.exam;
        window.clearInterval(M.timer);
        var answers = [];
        e.papers.forEach(function (pp) {
            pp.questions.forEach(function (q) { answers.push({ questionId: q.questionId, chosen: e.answers[q.questionId] ? String(e.answers[q.questionId]) : '' }); });
        });
        $('main').replaceChildren(h('section', { class: 'card soon' }, [h('p', { html: '{採点|さいてん}しています…' })]));
        A.withLoading('<ruby>採点<rt>さいてん</rt></ruby>しています', A.apiPost({ action: 'me.mockSubmit', level: e.level, answers: answers }))
            .then(function (res) {
                if (A.authFailed(res)) return;
                if (!res || !res.ok) throw new Error((res && res.message) || 'submit failed');
                clearSaved();
                M.exam = null;
                document.body.classList.remove('is-exam');
                drawResult(res, true);
            })
            .catch(function (err) {
                console.error(err);
                // 答えはブラウザに残っているので、もう一度送れる
                $('main').replaceChildren(h('section', { class: 'card soon' }, [
                    h('p', { html: '{採点|さいてん}できませんでした。{通信|つうしん}を{確|たし}かめて、もう{一度|いちど}{押|お}してください。' }),
                    h('button', { type: 'button', class: 'pop-btn btn-pink', html: 'もう{一度|いちど}{送|おく}る', onclick: submit })
                ]));
            });
    }

    /* ===================== 結果 ===================== */
    function openResult(resultId) {
        A.withLoading('<ruby>結果<rt>けっか</rt></ruby>を<ruby>読<rt>よ</rt></ruby>み<ruby>込<rt>こ</rt></ruby>んでいます', A.apiPost({ action: 'me.mockResult', resultId: resultId }))
            .then(function (res) {
                if (A.authFailed(res)) return;
                if (!res || !res.ok) { A.toast((res && res.message) || '{読|よ}み{込|こ}めませんでした。', true); return; }
                drawResult(res, false);
            })
            .catch(function () { A.toast('{通信|つうしん}に{失敗|しっぱい}しました。', true); });
    }

    function drawResult(r, fresh) {
        var main = $('main');
        main.replaceChildren();
        A.setTitle('{模試|もし}の{結果|けっか}');
        if (fresh && r.result === '合格' && A.confetti) A.confetti();

        main.append(h('section', { class: 'card m-result ' + resultClass(r.result) }, [
            h('p', { class: 'result-title', html: r.level + ' {模擬|もぎ}{試験|しけん}・' + dateText(r.at) }),
            h('p', { class: 'result-score' }, [h('b', { text: String(r.total) }), document.createTextNode(' / 180')]),
            h('p', { class: 'm-badge m-badge-lg ' + resultClass(r.result), html: resultLabel(r.result) }),
            h('p', { class: 'm-result-sub', html: '{合格点|ごうかくてん} ' + r.pass + '{点|てん}・{正解|せいかい} ' + r.correct + ' / ' + r.count + '{問|もん}' })
        ]));

        main.append(h('section', { class: 'card' }, [
            h('h2', { class: 'card-title', html: '{区分|くぶん}ごとの{点数|てんすう}' }),
            h('ul', { class: 'm-divs' }, r.divisions.map(function (d) {
                var pct = d.score === null ? 0 : Math.round(d.score / d.max * 100);
                var basePct = Math.round(d.base / d.max * 100);
                var low = d.score !== null && d.score < d.base;
                return h('li', { class: low ? 'is-low' : '' }, [
                    h('div', { class: 'm-div-top' }, [
                        h('span', { class: 'm-div-name', html: d.name }),
                        h('span', { class: 'm-div-score' }, d.score === null ? [h('span', { html: '{問題|もんだい}なし' })] : [h('b', { text: String(d.score) }), document.createTextNode(' / ' + d.max)])
                    ]),
                    h('div', { class: 'm-div-bar' }, [h('span', { class: 'm-div-fill', style: 'width:' + pct + '%' }), h('span', { class: 'm-div-base', style: 'left:' + basePct + '%' })]),
                    h('p', { class: 'm-div-note', html: '{基準点|きじゅんてん} ' + d.base + '{点|てん}' + (low ? '　★{基準点|きじゅんてん}に{足|た}りません' : '') + (d.count ? '・{正解|せいかい} ' + d.correct + ' / ' + d.count : '') })
                ]);
            })),
            h('p', { class: 'note', html: '{点数|てんすう}は{正答率|せいとうりつ}から{出|だ}した「{目安|めやす}」です。{本番|ほんばん}は{尺度得点|しゃくどとくてん}という{計算|けいさん}で{決|き}まります。{合格|ごうかく}には、{合計|ごうけい}が{合格点|ごうかくてん}{以上|いじょう}で、どの{区分|くぶん}も{基準点|きじゅんてん}{以上|いじょう}であることが{必要|ひつよう}です。' }),
            r.result === '判定なし' ? h('p', { class: 'note', html: '{問題|もんだい}がない{区分|くぶん}があるので、{合否|ごうひ}の{目安|めやす}は{出|だ}していません。' }) : null
        ]));

        main.append(h('section', { class: 'card result-actions' }, [
            h('button', { type: 'button', class: 'pop-btn btn-purple btn-block', html: '{答|こた}えと{解説|かいせつ}を{見|み}る', onclick: function () { drawReview(r, 'all'); } }),
            h('button', { type: 'button', class: 'pop-btn btn-white btn-block', html: '{模試|もし}のメニューへ', onclick: function () { renderMenu(main); } }),
            h('p', { class: 'note', html: 'まちがえた{問題|もんだい}は、「{問題|もんだい}」の「まちがい{復習|ふくしゅう}」にも{入|はい}ります。' })
        ]));
        M.lastResult = r;
        window.scrollTo(0, 0);
    }

    function drawReview(r, filter) {
        var main = $('main');
        main.replaceChildren();
        A.setTitle('{答|こた}えと{解説|かいせつ}');
        var wrong = r.review.filter(function (x) { return !x.correct; }).length;
        main.append(h('div', { class: 'm-review-tabs', role: 'tablist' }, [
            h('button', { type: 'button', role: 'tab', class: 'seg-btn', 'aria-selected': String(filter === 'all'), html: 'すべて（' + r.review.length + '）', onclick: function () { drawReview(r, 'all'); } }),
            h('button', { type: 'button', role: 'tab', class: 'seg-btn', 'aria-selected': String(filter === 'wrong'), html: 'まちがい（' + wrong + '）', onclick: function () { drawReview(r, 'wrong'); } })
        ]));
        r.review.forEach(function (x, i) {
            if (filter === 'wrong' && x.correct) return;
            var card = h('section', { class: 'card m-rv ' + (x.correct ? 'is-correct' : 'is-wrong') });
            card.append(h('p', { class: 'm-rv-head' }, [
                h('span', { class: 'm-rv-no', text: String(i + 1) }),
                A.sticker('st-' + (SECTION_ST[x.section] || 'mock'), 'form-st'),
                h('span', { class: 'm-rv-form', text: x.form || x.section }),
                h('span', { class: 'm-rv-mark', html: x.correct ? '{正解|せいかい}' : x.chosen ? '{不正解|ふせいかい}' : '{答|こた}えなし' })
            ]));
            if (x.audio) card.append(h('audio', { controls: true, preload: 'none', src: 'audio/' + encodeURIComponent(x.audio), class: 'quiz-audio' }));
            if (String(x.passage || '').trim()) card.append(h('details', { class: 'm-rv-passage' }, [h('summary', { html: '{本文|ほんぶん}を{見|み}る' }), h('div', { class: 'quiz-passage', html: x.passage })]));
            card.append(h('p', { class: 'quiz-question', html: x.question }));
            card.append(h('ol', { class: 'm-rv-choices' }, x.choices.map(function (c, k) {
                var n = k + 1;
                var cls = n === x.answer ? 'is-answer' : n === x.chosen ? 'is-chosen' : '';
                return h('li', { class: cls }, [h('span', { class: 'choice-num', text: String(n) }), h('span', { html: c }),
                    n === x.answer ? h('span', { class: 'm-rv-tag', html: '{正解|せいかい}' }) : n === x.chosen ? h('span', { class: 'm-rv-tag', html: 'あなた' }) : null]);
            })));
            if (x.explanation) card.append(h('div', { class: 'feedback-body m-rv-exp', html: x.explanation }));
            main.append(card);
        });
        main.append(h('section', { class: 'card result-actions' }, [
            h('button', { type: 'button', class: 'pop-btn btn-white btn-block', html: '{結果|けっか}にもどる', onclick: function () { drawResult(r, false); } })
        ]));
        window.scrollTo(0, 0);
    }

    window.RPages = window.RPages || {};
    window.RPages.mock = renderMenu;
})();
