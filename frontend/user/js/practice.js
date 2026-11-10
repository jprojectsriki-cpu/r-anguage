/* R-ANGUAGE 受講生の画面：問題（R-10b）
 * - メニュー：レベル → 科目ごと（本番と同じ数）／大問ごと、まちがい復習、お気に入り
 * - 問題数は GAS の QuestionCounts シート（JLPT の問題数の目安）で決まる
 * - 1問答えるごとに、正解・解説を出す。答えはまとめて GAS に送る（送るのを待たずに次へ進める）
 * - 本文・音声が同じ問題は、続けて出る（GAS 側でまとめてある）
 * ※ app.js のあとに読み込むこと（window.RApp を使う）
 */
(function () {
    'use strict';

    var A = window.RApp;
    var h = function (t, a, c) { return A.h(t, a, c); };
    var LEVEL_KEY = 'ranguage_plevel';
    var SECTION_ICON = { '文字・語彙': 'moji', '文法': 'bunpo', '読解': 'dokkai', '聴解': 'choukai' };
    var SECTION_RUBY = { '文字・語彙': '{文字|もじ}・{語彙|ごい}', '文法': '{文法|ぶんぽう}', '読解': '{読解|どっかい}', '聴解': '{聴解|ちょうかい}' };
    var MODE_TITLE = { mistakes: 'まちがい{復習|ふくしゅう}', favorites: 'お{気|き}に{入|い}り', retry: 'まちがえた{問題|もんだい}をもう{一度|いちど}' };

    var P = { menu: null, quiz: null };

    function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 無視 */ } }
    function load(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
    function sectionTitle(sec) { return SECTION_RUBY[sec] || sec; }

    /* ===================== 答えを送る（まとめて・順番に） ===================== */
    var outbox = { list: [], busy: false };
    function queueAnswer(a) {
        outbox.list.push(a);
        flush();
    }
    function flush() {
        if (outbox.busy || !outbox.list.length) return;
        var batch = outbox.list.slice(0, 50);
        var mode = batch[0].mode;
        batch = batch.filter(function (a) { return a.mode === mode; });
        outbox.busy = true;
        A.apiPost({ action: 'me.saveAnswers', mode: mode, answers: batch.map(function (a) { return { questionId: a.questionId, chosen: a.chosen }; }) })
            .then(function (res) {
                outbox.busy = false;
                if (A.authFailed(res)) return;
                if (!res || !res.ok) throw new Error((res && res.message) || 'save failed');
                outbox.list = outbox.list.filter(function (a) { return batch.indexOf(a) === -1; });
                flush();
            })
            .catch(function (err) {
                outbox.busy = false;
                console.error(err);
                // 次に答えたとき・結果の画面で、もう一度送る
            });
    }
    window.addEventListener('beforeunload', function (e) {
        if (outbox.list.length) { e.preventDefault(); e.returnValue = ''; }
    });
    A.registerDrain(A.makeDrain(outbox, flush)); // ホームの数を読む前に、送り終わるのを待つ

    /* ===================== メニュー ===================== */
    function renderMenu(main) {
        P.quiz = null;
        if (window.RPendingPractice) { // ホームの「続きから」
            var pending = window.RPendingPractice;
            window.RPendingPractice = null;
            A.setTitle('{問題|もんだい}');
            start(pending, function () { renderMenu(main); });
            return;
        }
        document.body.classList.remove('is-quiz');
        A.setTitle('{問題|もんだい}');
        A.withLoading('<ruby>問題<rt>もんだい</rt></ruby>を<ruby>読<rt>よ</rt></ruby>み<ruby>込<rt>こ</rt></ruby>んでいます', A.afterSaves().then(function () { return A.apiPost({ action: 'me.practiceMenu' }); }))
            .then(function (res) {
                if (A.authFailed(res)) return;
                if (!res || !res.ok) throw new Error((res && res.message) || 'menu failed');
                P.menu = res;
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
        var m = P.menu;
        main.replaceChildren();
        if (!m.levels.length) {
            main.append(h('section', { class: 'card soon' }, [
                h('p', { html: '{使|つか}えるレベルがまだありません。' }),
                h('p', { class: 'note', html: 'マイページからレベルを{追加|ついか}できます。{入金|にゅうきん}を{確認|かくにん}したら、{問題|もんだい}を{解|と}けるようになります。' }),
                h('a', { class: 'pop-btn btn-pink', href: '#mypage', html: 'マイページへ' })
            ]));
            return;
        }
        var saved = load(LEVEL_KEY);
        var lv = m.levels.filter(function (x) { return x.level === saved; })[0] || m.levels[0];

        // レベルの切り替え
        { // レベルは1つだけでも、いつも出す（どのレベルの画面かわかるように）
            var bar = h('div', { class: 'lv-tabs', role: 'tablist', 'aria-label': 'レベル' }, [h('span', { class: 'lv-tabs-label', text: 'レベル' })]);
            m.levels.forEach(function (x) {
                bar.append(h('button', {
                    type: 'button', role: 'tab', class: 'lv lv-' + x.level + ' lv-tab', 'aria-selected': String(x.level === lv.level), text: x.level,
                    onclick: function () { store(LEVEL_KEY, x.level); drawMenu(main); }
                }));
            });
            if (!m.isAdmin && m.levels.length < 4) bar.append(h('a', { class: 'lv-add', href: '#mypage', html: '＋レベルを{追加|ついか}' }));
            main.append(bar);
        }

        if (m.isAdmin) {
            main.append(h('p', { class: 'admin-note', text: '管理者アカウントなので、すべてのレベルを解けます（確認用）。答えの記録も残ります。' + (m.extra ? '「問題形式」が問題数の表（QuestionCounts）にない公開問題が ' + m.extra + '問あります。この問題は出題されません。' : '') }));
        }

        // まちがい復習・お気に入り
        main.append(h('div', { class: 'review-row' }, [
            reviewButton('mistakes', 'まちがい{復習|ふくしゅう}', lv.mistakes, 'st-redo', lv.level),
            reviewButton('favorites', 'お{気|き}に{入|い}り', lv.favorites, 'st-star', lv.level)
        ]));

        // 科目ごと
        lv.sections.forEach(function (s) {
            var card = h('section', { class: 'card sec-card sec-' + SECTION_ICON[s.section] }, [
                h('div', { class: 'sec-head' }, [
                    A.sticker('st-' + SECTION_ICON[s.section], 'sec-st'),
                    h('h2', { class: 'sec-title', html: sectionTitle(s.section) })
                ])
            ]);
            var startBtn = h('button', {
                type: 'button', class: 'pop-btn btn-purple btn-block', disabled: s.have === 0,
                onclick: function () { start({ mode: 'set', level: lv.level, section: s.section }); }
            }, [h('span', { html: '{本番|ほんばん}と{同|おな}じ ' + s.want + '{問|もん}' })]);
            card.append(startBtn);
            if (s.have < s.want) {
                card.append(h('p', { class: 'note', html: s.have === 0 ? 'この{科目|かもく}の{問題|もんだい}は、まだありません。' : 'いま{解|と}ける{問題|もんだい}は ' + s.have + '{問|もん}です（{問題|もんだい}をふやしています）。' }));
            }
            var list = h('ul', { class: 'form-list' });
            s.forms.forEach(function (f) {
                list.append(h('li', {}, [
                    h('button', {
                        type: 'button', class: 'form-btn', disabled: f.have === 0,
                        onclick: function () { start({ mode: 'form', level: lv.level, section: s.section, form: f.form }); }
                    }, [
                        h('span', { class: 'form-name', text: f.form }),
                        h('span', { class: 'form-num', html: f.have === 0 ? 'まだありません' : (Math.min(f.have, f.want) < f.want ? Math.min(f.have, f.want) + ' / ' : '') + f.want + '{問|もん}' }),
                        A.icon('i-chev')
                    ])
                ]));
            });
            card.append(h('details', { class: 'forms' }, [h('summary', { html: '{大問|だいもん}ごとに{解|と}く' }), list]));
            main.append(card);
        });
    }

    function reviewButton(mode, label, count, iconId, level) {
        return h('button', {
            type: 'button', class: 'card review-btn review-' + mode, disabled: !count,
            onclick: function () { start({ mode: mode, level: level }); }
        }, [
            A.sticker(iconId, 'review-st'),
            h('span', { class: 'review-label', html: label }),
            h('span', { class: 'review-num', html: count + '{問|もん}' })
        ]);
    }

    /* ===================== 始める ===================== */
    function start(params, onFail) {
        var req = Object.assign({ action: 'me.practiceStart' }, params);
        A.withLoading('<ruby>問題<rt>もんだい</rt></ruby>を<ruby>用意<rt>ようい</rt></ruby>しています', A.apiPost(req))
            .then(function (res) {
                if (A.authFailed(res)) return;
                if (!res || !res.ok) { A.toast((res && res.message) || '{始|はじ}められませんでした。', true); if (onFail) onFail(); return; }
                if (res.short && res.short.length && params.mode === 'set') {
                    var body = h('div', {}, [
                        h('p', { html: 'まだ{問題|もんだい}が{足|た}りない{大問|だいもん}があります。いまある{問題|もんだい}だけで{始|はじ}めます。' }),
                        h('ul', { class: 'short-list' }, res.short.map(function (s) {
                            return h('li', { html: s.form + '：' + s.got + ' / ' + s.want + '{問|もん}' });
                        }))
                    ]);
                    return A.confirmBox({ title: '{全部|ぜんぶ}で ' + res.questions.length + '{問|もん}です', body: body, ok: '{始|はじ}める' })
                        .then(function (yes) { if (yes) begin(res, params); });
                }
                begin(res, params);
            })
            .catch(function (err) {
                console.error(err);
                A.toast('{通信|つうしん}に{失敗|しっぱい}しました。もう{一度|いちど}お{試|ため}しください。', true);
                if (onFail) onFail();
            });
    }

    function begin(res, params) {
        P.quiz = {
            params: params,
            title: params.mode === 'set' || params.mode === 'form'
                ? params.level + ' ' + sectionTitle(params.section) + (params.mode === 'form' ? '・' + params.form : '')
                : params.level + ' ' + MODE_TITLE[params.mode],
            list: res.questions,
            i: 0,
            results: [] // { q, chosen, correct }
        };
        document.body.classList.add('is-quiz');
        drawQuestion();
    }

    /* ===================== 1問ずつ ===================== */
    function drawQuestion() {
        var z = P.quiz;
        var q = z.list[z.i];
        var main = document.getElementById('main');
        main.replaceChildren();
        A.setTitle(z.title);

        // 進み具合
        main.append(h('div', { class: 'quiz-head' }, [
            h('span', { class: 'quiz-count' }, [h('b', { text: String(z.i + 1) }), document.createTextNode(' / ' + z.list.length)]),
            h('div', { class: 'quiz-bar', 'aria-hidden': 'true' }, [h('span', { style: 'width:' + Math.round(z.i / z.list.length * 100) + '%' })]),
            h('button', { type: 'button', class: 'quiz-quit', html: 'やめる', onclick: quit })
        ]));

        var card = h('section', { class: 'card quiz-card' });
        card.append(h('p', { class: 'quiz-form' }, [
            A.sticker('st-' + SECTION_ICON[q.section], 'form-st'),
            h('span', { text: q.form || q.section })
        ]));

        if (A.FORM_GUIDE[q.form]) card.append(h('p', { class: 'form-guide', html: A.FORM_GUIDE[q.form] }));
        var L = window.RListen;
        if (L) L.stop();
        var isL = q.section === '聴解';
        var numOnly = isL && L && L.hideChoices(q);
        if (isL) card.append(A.listenBox(q));
        // 聴解は、答える前はスクリプトを見せない（本番と同じ）
        if (!isL && String(q.passage || '').trim()) card.append(h('div', { class: 'quiz-passage', html: q.passage }));
        if (!isL || (L && L.showQuestion(q))) card.append(h('p', { class: 'quiz-question' + (isL ? ' listen-scene' : ''), html: q.question }));
        if (numOnly) card.append(h('p', { class: 'note listen-hint', html: 'せんたくしは{音声|おんせい}で{流|なが}れます。{聞|き}いて、{番号|ばんごう}を{選|えら}んでください。' }));

        var choices = h('ol', { class: 'choices' + (numOnly ? ' is-num' : '') });
        q.choices.forEach(function (c, idx) {
            if (!String(c || '').trim()) return; // せんたくしが3つの問題
            choices.append(h('li', {}, [h('button', {
                type: 'button', class: 'choice', 'data-n': String(idx + 1),
                onclick: function () { answer(idx + 1); }
            }, [h('span', { class: 'choice-num', text: String(idx + 1) }), h('span', { class: 'choice-text', hidden: numOnly, html: c })])]));
        });
        card.append(choices);
        // 文章の文法：いま答えている空欄に色を付ける
        var bm = String(q.question || '').match(/［\s*([0-9０-９]{1,2})\s*］/);
        if (bm) card.querySelectorAll('.quiz-passage .blank[data-n="' + bm[1] + '"]').forEach(function (b) { b.classList.add('is-now'); });
        card.append(h('div', { id: 'quizAfter' }));
        main.append(card);
        window.scrollTo(0, 0);
    }

    function answer(n) {
        var z = P.quiz;
        var q = z.list[z.i];
        if (z.results[z.i]) return; // 2回押さない
        var correct = n === q.answer;
        z.results[z.i] = { q: q, chosen: n, correct: correct };
        queueAnswer({ questionId: q.questionId, chosen: String(n), mode: z.params.mode });

        document.querySelectorAll('.choice').forEach(function (b) {
            var k = Number(b.getAttribute('data-n'));
            b.disabled = true;
            if (k === q.answer) b.classList.add('is-correct');
            else if (k === n) b.classList.add('is-wrong');
        });

        var star = h('button', {
            type: 'button', class: 'star-btn', 'aria-pressed': String(!!q.favorite),
            onclick: function () { toggleFavorite(q, star); }
        }, [A.icon('i-star'), h('span', { html: q.favorite ? 'お{気|き}に{入|い}り{済|ず}み' : 'お{気|き}に{入|い}りに{入|い}れる' })]);

        var last = z.i === z.list.length - 1;
        var after = document.getElementById('quizAfter');
        // 聴解：答えたら、スクリプト・問題文・せんたくしを見せる
        var reveal = null;
        if (q.section === '聴解') {
            var list = document.querySelector('.choices.is-num');
            if (list) list.classList.remove('is-num');
            document.querySelectorAll('.choice .choice-text').forEach(function (t) { t.hidden = false; });
            var showQ = window.RListen && window.RListen.showQuestion(q);
            reveal = h('div', { class: 'listen-reveal' }, [
                h('p', { class: 'listen-reveal-title', html: 'スクリプト' }),
                String(q.passage || '').trim() ? h('div', { class: 'quiz-passage', html: q.passage }) : null,
                !showQ && String(q.question || '').trim() ? h('p', { class: 'quiz-question', html: q.question }) : null
            ]);
        }
        after.replaceChildren(
            reveal || '',
            h('div', { class: 'feedback ' + (correct ? 'is-correct' : 'is-wrong') }, [
                h('p', { class: 'feedback-title' }, [A.icon(correct ? 'i-check' : 'i-x'), h('span', { html: correct ? '{正解|せいかい}！' : '{不正解|ふせいかい}　{正解|せいかい}は ' + q.answer + ' です' })]),
                q.explanation ? h('div', { class: 'feedback-body', html: q.explanation }) : null
            ]),
            h('div', { class: 'quiz-actions' }, [
                star,
                h('button', { type: 'button', class: 'pop-btn btn-pink', html: last ? '{結果|けっか}を{見|み}る' : '{次|つぎ}へ', onclick: next })
            ])
        );
        after.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function next() {
        var z = P.quiz;
        if (window.RListen) window.RListen.stop();
        if (z.i < z.list.length - 1) { z.i++; drawQuestion(); } else drawResult();
    }

    function quit() {
        var z = P.quiz;
        var done = z.results.filter(Boolean).length;
        A.confirmBox({
            title: 'ここでやめますか？',
            body: h('p', { html: done ? '{答|こた}えた ' + done + '{問|もん}の{結果|けっか}を{見|み}ます。{答|こた}えは{記録|きろく}されています。' : 'まだ1{問|もん}も{答|こた}えていません。メニューにもどります。' }),
            ok: 'やめる'
        }).then(function (yes) {
            if (!yes) return;
            if (done) drawResult(); else renderMenu(document.getElementById('main'));
        });
    }

    function toggleFavorite(q, btn) {
        var on = !q.favorite;
        q.favorite = on;
        btn.setAttribute('aria-pressed', String(on));
        btn.lastChild.innerHTML = A.fg(on ? 'お{気|き}に{入|い}り{済|ず}み' : 'お{気|き}に{入|い}りに{入|い}れる');
        A.apiPost({ action: 'me.favorite', questionId: q.questionId, on: on }).then(function (res) {
            if (A.authFailed(res)) return;
            if (!res || !res.ok) throw new Error('fav');
            A.toast(on ? 'お{気|き}に{入|い}りに{入|い}れました' : 'お{気|き}に{入|い}りから{外|はず}しました');
        }).catch(function () {
            q.favorite = !on;
            btn.setAttribute('aria-pressed', String(!on));
            btn.lastChild.innerHTML = A.fg(!on ? 'お{気|き}に{入|い}り{済|ず}み' : 'お{気|き}に{入|い}りに{入|い}れる');
            A.toast('{保存|ほぞん}できませんでした。もう{一度|いちど}お{試|ため}しください。', true);
        });
    }

    /* ===================== 結果 ===================== */
    function drawResult() {
        if (window.RListen) window.RListen.stop();
        var z = P.quiz;
        var rs = z.results.filter(Boolean);
        var ok = rs.filter(function (r) { return r.correct; }).length;
        var pct = rs.length ? Math.round(ok / rs.length * 100) : 0;
        var main = document.getElementById('main');
        main.replaceChildren();
        A.setTitle('{結果|けっか}');
        document.body.classList.remove('is-quiz');
        flush();

        if (pct >= 60) confetti();
        main.append(h('section', { class: 'card result-top ' + (pct >= 60 ? 'is-good' : '') }, [
            h('p', { class: 'result-title', html: z.title }),
            h('p', { class: 'result-score' }, [h('b', { text: String(ok) }), document.createTextNode(' / ' + rs.length)]),
            h('p', { class: 'result-pct', html: '{正答率|せいとうりつ} ' + pct + '%' })
        ]));

        // 大問ごと
        var byForm = [];
        var idx = {};
        rs.forEach(function (r) {
            var k = r.q.section + '|' + r.q.form;
            if (idx[k] === undefined) { idx[k] = byForm.length; byForm.push({ name: r.q.form || r.q.section, ok: 0, n: 0 }); }
            byForm[idx[k]].n++;
            if (r.correct) byForm[idx[k]].ok++;
        });
        main.append(h('section', { class: 'card' }, [
            h('h2', { class: 'card-title', html: '{大問|だいもん}ごとの{結果|けっか}' }),
            h('ul', { class: 'by-form' }, byForm.map(function (f) {
                return h('li', {}, [
                    h('span', { class: 'bf-name', text: f.name }),
                    h('span', { class: 'bf-bar', 'aria-hidden': 'true' }, [h('span', { style: 'width:' + Math.round(f.ok / f.n * 100) + '%' })]),
                    h('span', { class: 'bf-num', text: f.ok + ' / ' + f.n })
                ]);
            }))
        ]));

        var wrongIds = rs.filter(function (r) { return !r.correct; }).map(function (r) { return r.q.questionId; });
        var acts = h('section', { class: 'card result-actions' });
        if (wrongIds.length) {
            acts.append(h('button', {
                type: 'button', class: 'pop-btn btn-pink btn-block', html: 'まちがえた ' + wrongIds.length + '{問|もん}をもう{一度|いちど}',
                onclick: function () { start({ mode: 'retry', level: z.params.level, ids: wrongIds }); }
            }));
        }
        if (z.params.mode === 'set' || z.params.mode === 'form') {
            acts.append(h('button', {
                type: 'button', class: 'pop-btn btn-purple btn-block', html: '{別|べつ}の{問題|もんだい}で、もう{一度|いちど}',
                onclick: function () { start(z.params); }
            }));
        }
        acts.append(h('button', { type: 'button', class: 'pop-btn btn-white btn-block', html: '{問題|もんだい}のメニューへ', onclick: function () { renderMenu(main); } }));
        acts.append(h('p', { class: 'note', html: 'まちがえた{問題|もんだい}は「まちがい{復習|ふくしゅう}」に{入|はい}ります。{次|つぎ}に{正解|せいかい}すると、{復習|ふくしゅう}から{外|はず}れます。' }));
        main.append(acts);
        window.scrollTo(0, 0);
    }

    /** 紙ふぶき（よくできたとき） */
    function confetti() {
        var box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
        var colors = ['#FFBE0B', '#FF006E', '#8338EC', '#06D6A0', '#4CC9F0'];
        for (var i = 0; i < 36; i++) {
            box.append(h('i', { style: 'left:' + (Math.random() * 100) + '%;background:' + colors[i % 5] + ';animation-delay:' + (Math.random() * 0.6).toFixed(2) + 's;animation-duration:' + (1.6 + Math.random() * 1.2).toFixed(2) + 's;transform:rotate(' + Math.round(Math.random() * 360) + 'deg)' }));
        }
        document.body.append(box);
        window.setTimeout(function () { box.remove(); }, 3600);
    }
    window.RApp.confetti = confetti;

    window.RPages = window.RPages || {};
    window.RPages.practice = renderMenu;
})();
