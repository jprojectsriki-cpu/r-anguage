/* R-ANGUAGE 受講生の画面：単語カード（R-10c）
 * - メニュー：レベル → まだ覚えていない／すべて／覚えた（見直し）。1回 30枚
 * - カード：おもて＝単語、うら＝読み・英語の意味・例文（押すとうらがえる）
 * - うらを見たら「覚えた」「まだ」を押して次へ（左右にスワイプしてもよい）
 * - 「覚えた／まだ」はまとめて GAS に送る（送るのを待たずに次へ進める）
 * - 読み上げはブラウザの機能（speechSynthesis）。速さはマイページの「聴解の速さ」
 * ※ app.js のあとに読み込むこと（window.RApp を使う）
 */
(function () {
    'use strict';

    var A = window.RApp;
    var h = function (t, a, c) { return A.h(t, a, c); };
    var LEVEL_KEY = 'ranguage_vlevel';
    var MODE_TITLE = {
        new: 'まだ{覚|おぼ}えていない',
        all: 'すべてのカード',
        known: '{覚|おぼ}えた{単語|たんご}の{見直|みなお}し',
        retry: '「まだ」のカードをもう{一度|いちど}'
    };
    var V = { menu: null, round: null };

    function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 無視 */ } }
    function load(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }

    /* ===================== 読み上げ ===================== */
    var canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    /** {漢字|よみ} は「よみ」にして読む（読みまちがいをふせぐ） */
    function speakText(text) {
        return String(text || '').replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '$2').replace(/__/g, '');
    }
    function speak(text) {
        if (!canSpeak) return;
        var s = (((A.state.profile || {}).user || {}).settings || {});
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(speakText(text));
        u.lang = 'ja-JP';
        u.rate = Number(s.speed) || 1;
        var ja = window.speechSynthesis.getVoices().filter(function (v) { return /^ja/i.test(v.lang); })[0];
        if (ja) u.voice = ja;
        window.speechSynthesis.speak(u);
    }
    function speakButton(text, label) {
        if (!canSpeak || !String(text || '').trim()) return null;
        return h('button', {
            type: 'button', class: 'say-btn', 'aria-label': label,
            onclick: function (e) { e.stopPropagation(); speak(text); }
        }, [A.icon('i-sound')]);
    }

    /* ===================== 送る（まとめて・順番に） ===================== */
    var outbox = { list: [], busy: false };
    function queueMark(m) { outbox.list.push(m); flush(); }
    function flush() {
        if (outbox.busy || !outbox.list.length) return;
        var batch = outbox.list.slice(0, 50);
        outbox.busy = true;
        A.apiPost({ action: 'me.vocabMark', marks: batch })
            .then(function (res) {
                outbox.busy = false;
                if (A.authFailed(res)) return;
                if (!res || !res.ok) throw new Error((res && res.message) || 'save failed');
                outbox.list = outbox.list.slice(batch.length);
                flush();
            })
            .catch(function (err) { outbox.busy = false; console.error(err); });
    }
    window.addEventListener('beforeunload', function (e) {
        if (outbox.list.length) { e.preventDefault(); e.returnValue = ''; }
    });
    A.registerDrain(A.makeDrain(outbox, flush)); // ホームの数を読む前に、送り終わるのを待つ

    /* ===================== メニュー ===================== */
    function renderMenu(main) {
        V.round = null;
        A.setTitle('{単語|たんご}カード');
        A.withLoading('カードを<ruby>読<rt>よ</rt></ruby>み<ruby>込<rt>こ</rt></ruby>んでいます', A.afterSaves().then(function () { return A.apiPost({ action: 'me.vocabMenu' }); }))
            .then(function (res) {
                if (A.authFailed(res)) return;
                if (!res || !res.ok) throw new Error((res && res.message) || 'menu failed');
                V.menu = res;
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
        var m = V.menu;
        main.replaceChildren();
        if (!m.levels.length) {
            main.append(h('section', { class: 'card soon' }, [
                h('p', { class: 'soon-icon' }, [A.sticker('st-vocab')]),
                h('p', { html: '{使|つか}えるレベルがまだありません。' }),
                h('p', { class: 'note', html: 'マイページからレベルを{追加|ついか}できます。' }),
                h('a', { class: 'pop-btn btn-pink', href: '#mypage', html: 'マイページへ' })
            ]));
            return;
        }
        var lvNames = m.levels.map(function (x) { return x.level; });
        var lv = m.levels.filter(function (x) { return x.level === A.studyLevel(lvNames, LEVEL_KEY); })[0] || m.levels[0];
        // いま勉強しているレベル（2つ以上なら「レベルを変える」。ページを開いたときは大きなボタンで選んでもらう）
        main.append(A.levelBar(lvNames, lv.level, { isAdmin: m.isAdmin, onChange: function () { drawMenu(main); } }));
        A.askLevelIfNeeded(lvNames, lv.level, function () { drawMenu(main); });
        if (m.isAdmin) main.append(h('p', { class: 'admin-note', text: '管理者アカウントなので、すべてのレベルを使えます（確認用）。「覚えた／まだ」の記録も残ります。' }));

        // 覚えた割合
        var pct = lv.total ? Math.round(lv.known / lv.total * 100) : 0;
        main.append(h('section', { class: 'card v-progress' }, [
            A.sticker('st-vocab', 'v-progress-st'),
            h('div', { class: 'v-progress-body' }, [
                h('p', { class: 'v-progress-title', html: lv.level + ' {覚|おぼ}えた{単語|たんご}' }),
                h('p', { class: 'v-progress-num' }, [h('b', { text: String(lv.known) }), document.createTextNode(' / ' + lv.total)]),
                h('div', { class: 'v-meter', 'aria-hidden': 'true' }, [h('span', { style: 'width:' + pct + '%' })])
            ])
        ]));

        if (!lv.total) {
            main.append(h('section', { class: 'card soon' }, [h('p', { class: 'muted', html: 'このレベルのカードは、まだありません。' })]));
            return;
        }
        var notYet = lv.still + lv.fresh;
        main.append(h('div', { class: 'v-modes' }, [
            modeButton('new', 'st-star', MODE_TITLE.new, notYet, lv.level, 'v-mode-new', lv.still ? '「まだ」' + lv.still + '{枚|まい}・はじめて ' + lv.fresh + '{枚|まい}' : ''),
            modeButton('all', 'st-vocab', MODE_TITLE.all, lv.total, lv.level, 'v-mode-all', 'ランダムに{出|で}ます'),
            modeButton('known', 'st-redo', MODE_TITLE.known, lv.known, lv.level, 'v-mode-known', '{覚|おぼ}えたのが{古|ふる}い{順|じゅん}')
        ]));
        main.append(h('p', { class: 'note center', html: '1{回|かい}に ' + m.perRound + '{枚|まい}ずつ{出|で}ます。' }));
    }

    function modeButton(mode, st, label, count, level, cls, sub) {
        return h('button', {
            type: 'button', class: 'card v-mode ' + cls, disabled: !count,
            onclick: function () { start({ mode: mode, level: level }); }
        }, [
            A.sticker(st, 'v-mode-st'),
            h('span', { class: 'v-mode-text' }, [
                h('span', { class: 'v-mode-label', html: label }),
                sub ? h('span', { class: 'v-mode-sub', html: sub }) : null
            ]),
            h('span', { class: 'v-mode-num', html: count + '{枚|まい}' })
        ]);
    }

    /* ===================== 始める ===================== */
    function start(params) {
        A.withLoading('カードを<ruby>用意<rt>ようい</rt></ruby>しています', A.apiPost(Object.assign({ action: 'me.vocabStart' }, params)))
            .then(function (res) {
                if (A.authFailed(res)) return;
                if (!res || !res.ok) { A.toast((res && res.message) || '{始|はじ}められませんでした。', true); return; }
                V.round = { params: params, cards: res.cards, i: 0, marks: [], flipped: false };
                drawCard();
            })
            .catch(function (err) {
                console.error(err);
                A.toast('{通信|つうしん}に{失敗|しっぱい}しました。もう{一度|いちど}お{試|ため}しください。', true);
            });
    }

    /* ===================== カード ===================== */
    function drawCard() {
        var r = V.round;
        var c = r.cards[r.i];
        r.flipped = false;
        var main = document.getElementById('main');
        main.replaceChildren();
        A.setTitle(r.params.level + ' ' + MODE_TITLE[r.params.mode]);

        main.append(h('div', { class: 'quiz-head' }, [
            h('span', { class: 'quiz-count' }, [h('b', { text: String(r.i + 1) }), document.createTextNode(' / ' + r.cards.length)]),
            h('div', { class: 'quiz-bar', 'aria-hidden': 'true' }, [h('span', { style: 'width:' + Math.round(r.i / r.cards.length * 100) + '%' })]),
            h('button', { type: 'button', class: 'quiz-quit', html: 'やめる', onclick: quit })
        ]));

        var badge = c.state === '覚えた' ? h('span', { class: 'v-badge v-badge-known', html: '{覚|おぼ}えた' })
            : c.state === 'まだ' ? h('span', { class: 'v-badge v-badge-still', text: 'まだ' })
                : h('span', { class: 'v-badge v-badge-new', text: 'NEW' });

        var meanings = String(c.meaning).split(/[;；]/).map(function (x) { return x.trim(); }).filter(Boolean);
        var back = h('div', { class: 'v-face v-back' }, [
            h('div', { class: 'v-back-head' }, [
                h('div', {}, [
                    h('p', { class: 'v-reading', text: c.reading }),
                    h('p', { class: 'v-word-sm', html: c.word })
                ]),
                speakButton(c.reading, '単語を読み上げる')
            ]),
            h('ul', { class: 'v-means' }, meanings.map(function (x) { return h('li', { text: x }); })),
            String(c.example || '').trim() ? h('div', { class: 'v-example' }, [
                h('div', { class: 'v-example-row' }, [h('p', { class: 'v-example-ja', html: c.example }), speakButton(c.example, '例文を読み上げる')]),
                String(c.exampleEn || '').trim() ? h('p', { class: 'v-example-en', text: c.exampleEn }) : null
            ]) : null
        ]);
        var front = h('div', { class: 'v-face v-front' }, [
            badge,
            h('p', { class: 'v-word', html: c.word }),
            h('p', { class: 'v-hint' }, [A.icon('i-flip'), h('span', { html: 'タップしてうらがえす' })])
        ]);
        var card = h('div', { class: 'v-card', role: 'button', tabindex: '0', 'aria-label': 'カードをうらがえす' }, [
            h('div', { class: 'v-inner' }, [front, back])
        ]);
        card.addEventListener('click', flip);
        card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
        addSwipe(card);
        main.append(h('div', { class: 'v-stage' }, [card]));

        var still = h('button', { type: 'button', class: 'pop-btn v-still', disabled: true, onclick: function () { mark(false); } }, [A.icon('i-redo'), h('span', { text: 'まだ' })]);
        var known = h('button', { type: 'button', class: 'pop-btn v-known', disabled: true, onclick: function () { mark(true); } }, [A.icon('i-check'), h('span', { html: '{覚|おぼ}えた！' })]);
        main.append(h('div', { class: 'v-actions' }, [still, known]));
        main.append(h('p', { class: 'note center v-swipe-note', html: 'うらを{見|み}たら、ボタンを{押|お}してください（{左右|さゆう}にスワイプしてもOK）' }));
        window.scrollTo(0, 0);

        function flip() {
            card.classList.toggle('is-flipped');
            if (!r.flipped) {
                r.flipped = true;
                still.disabled = false;
                known.disabled = false;
            }
        }
    }

    /** 左右にスワイプ：右＝覚えた、左＝まだ（うらを見たあとだけ） */
    function addSwipe(card) {
        var x0 = null, y0 = 0, dx = 0;
        card.addEventListener('pointerdown', function (e) { x0 = e.clientX; y0 = e.clientY; dx = 0; });
        card.addEventListener('pointermove', function (e) {
            if (x0 === null || !V.round.flipped) return;
            dx = e.clientX - x0;
            if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(e.clientY - y0)) {
                card.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx / 18) + 'deg)';
                card.classList.toggle('swipe-known', dx > 60);
                card.classList.toggle('swipe-still', dx < -60);
            }
        });
        function end() {
            if (x0 === null) return;
            x0 = null;
            card.style.transform = '';
            card.classList.remove('swipe-known', 'swipe-still');
            if (V.round.flipped && Math.abs(dx) > 90) {
                card.addEventListener('click', stop, { capture: true, once: true }); // スワイプのあとの「タップ」でうらがえらないように
                mark(dx > 0);
            }
        }
        function stop(e) { e.stopPropagation(); }
        card.addEventListener('pointerup', end);
        card.addEventListener('pointercancel', end);
    }

    function mark(known) {
        var r = V.round;
        if (!r || !r.flipped) return;
        var c = r.cards[r.i];
        r.marks[r.i] = { card: c, known: known };
        queueMark({ cardId: c.cardId, known: known });
        if (canSpeak) window.speechSynthesis.cancel();
        if (r.i < r.cards.length - 1) { r.i++; drawCard(); } else drawResult();
    }

    function quit() {
        var r = V.round;
        var done = r.marks.filter(Boolean).length;
        A.confirmBox({
            title: 'ここでやめますか？',
            body: h('p', { html: done ? '{終|お}わった ' + done + '{枚|まい}の{結果|けっか}を{見|み}ます。{記録|きろく}はされています。' : 'メニューにもどります。' }),
            ok: 'やめる'
        }).then(function (yes) {
            if (!yes) return;
            if (canSpeak) window.speechSynthesis.cancel();
            if (done) drawResult(); else renderMenu(document.getElementById('main'));
        });
    }

    /* ===================== 結果 ===================== */
    function drawResult() {
        var r = V.round;
        var ms = r.marks.filter(Boolean);
        var ok = ms.filter(function (m) { return m.known; }).length;
        var still = ms.filter(function (m) { return !m.known; });
        var main = document.getElementById('main');
        main.replaceChildren();
        A.setTitle('{結果|けっか}');
        flush();
        if (ms.length && ok / ms.length >= 0.7 && A.confetti) A.confetti();

        main.append(h('section', { class: 'card result-top v-result ' + (still.length ? '' : 'is-good') }, [
            h('p', { class: 'result-title', html: r.params.level + ' ' + MODE_TITLE[r.params.mode] }),
            h('div', { class: 'v-result-row' }, [
                h('div', { class: 'v-result-box v-rb-known' }, [h('span', { html: '{覚|おぼ}えた' }), h('b', { text: String(ok) })]),
                h('div', { class: 'v-result-box v-rb-still' }, [h('span', { text: 'まだ' }), h('b', { text: String(still.length) })])
            ]),
            h('p', { class: 'result-pct', html: still.length ? '「まだ」のカードは、{次|つぎ}の「まだ{覚|おぼ}えていない」で{先|さき}に{出|で}ます。' : 'ぜんぶ{覚|おぼ}えました！すごい！' })
        ]));

        if (still.length) {
            main.append(h('section', { class: 'card' }, [
                h('h2', { class: 'card-title', html: '「まだ」のカード' }),
                h('ul', { class: 'v-still-list' }, still.map(function (m) {
                    return h('li', {}, [h('span', { class: 'v-sl-word', html: m.card.word }), h('span', { class: 'v-sl-read', text: m.card.reading }), h('span', { class: 'v-sl-mean', text: m.card.meaning.split(/[;；]/)[0] })]);
                }))
            ]));
        }

        var acts = h('section', { class: 'card result-actions' });
        if (still.length) {
            acts.append(h('button', {
                type: 'button', class: 'pop-btn btn-pink btn-block', html: '「まだ」の ' + still.length + '{枚|まい}をもう{一度|いちど}',
                onclick: function () { start({ mode: 'retry', level: r.params.level, ids: still.map(function (m) { return m.card.cardId; }) }); }
            }));
        }
        if (r.params.mode !== 'retry') {
            acts.append(h('button', {
                type: 'button', class: 'pop-btn btn-purple btn-block', html: '{次|つぎ}のカードへ',
                onclick: function () { start(r.params); }
            }));
        }
        acts.append(h('button', { type: 'button', class: 'pop-btn btn-white btn-block', html: '{単語|たんご}カードのメニューへ', onclick: function () { renderMenu(main); } }));
        main.append(acts);
        window.scrollTo(0, 0);
    }

    window.RPages = window.RPages || {};
    window.RPages.vocab = renderMenu;
})();
