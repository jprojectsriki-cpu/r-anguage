/* R-ANGUAGE 受講生の画面
 * - ページ：ホーム（#home）／問題（#practice）／単語（#vocab）／模試（#mock）／マイページ（#mypage）
 * - 下のメニュー：下にスクロールすると隠れ、上にスクロールしたとき・いちばん下に着いたときに出る
 * - ログインしていなければ login.html へ。別の端末でログインされたら、理由を付けて login.html へ
 * - ふりがなは {漢字|よみ} の形で書いた文字を <ruby> にして表示する（fg 関数）
 * - 問題・単語・模試の中身は R-10b〜d で作る（いまは「準備中」）
 */
(function () {
    'use strict';

    var CONFIG = window.RANGUAGE_CONFIG || {};
    var TOKEN_KEY = 'ranguage_token';
    var FURIGANA_KEY = 'ranguage_furigana';
    var FONT_KEY = 'ranguage_fontsize';
    var Loader = window.RLoading || { show: function () {}, hide: function () { return Promise.resolve(); } };
    var LEVELS = ['N4', 'N3', 'N2', 'N1'];
    var PAGES = {
        home: { title: 'ホーム' },
        practice: { title: '{問題|もんだい}' },
        vocab: { title: '{単語|たんご}カード' },
        mock: { title: '{模擬|もぎ}{試験|しけん}' },
        mypage: { title: 'マイページ' }
    };
    var state = { profile: null, page: '' };

    /* ===================== 共通 ===================== */
    function $(id) { return document.getElementById(id); }
    function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
    function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 無視 */ } }
    function store(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* 保存できなくても表示は変わる */ } }

    function apiPost(data) {
        data.token = getToken();
        return fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(data)
        }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        });
    }
    function withLoading(html, promise) {
        Loader.show(html);
        return promise.then(
            function (res) { return Loader.hide().then(function () { return res; }); },
            function (err) { return Loader.hide().then(function () { throw err; }); }
        );
    }
    /** ログインが切れたときは、ログイン画面へ（理由を付ける） */
    function authFailed(res) {
        if (!res || res.ok) return false;
        if (res.reason === 'expired' || res.reason === 'replaced' || res.reason === 'suspended') {
            setToken('');
            location.replace('login.html' + (res.reason === 'suspended' ? '' : '?reason=' + res.reason));
            return true;
        }
        return false;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    /** {漢字|よみ} をふりがなにして、HTML にする（ほかの文字はそのまま表示する） */
    function fg(text) {
        return esc(text).replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '<ruby>$1<rt>$2</rt></ruby>').replace(/\n/g, '<br>');
    }
    /** 要素を作る。html に {漢字|よみ} を書くと、ふりがなが付く */
    function h(tag, attrs, children) {
        var n = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            var v = attrs[k];
            if (v === null || v === undefined || v === false) return;
            if (k === 'class') n.className = v;
            else if (k === 'html') n.innerHTML = '<span class="fg">' + fg(v) + '</span>'; // ひとまとまりにする（ボタン・見出しの中でも、ふりがなの高さがそろう）
            else if (k === 'text') n.textContent = v;
            else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), v);
            else n.setAttribute(k, v === true ? '' : v);
        });
        (children || []).forEach(function (c) { if (c) n.append(c); });
        return n;
    }
    function icon(id) {
        var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        s.setAttribute('class', 'icon');
        s.setAttribute('aria-hidden', 'true');
        var u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        u.setAttribute('href', '#' + id);
        s.append(u);
        return s;
    }
    /** 色つきのステッカーアイコン（app.html の st-…） */
    function sticker(id, cls) {
        var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        s.setAttribute('class', 'sticker' + (cls ? ' ' + cls : ''));
        s.setAttribute('aria-hidden', 'true');
        var u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        u.setAttribute('href', '#' + id);
        s.append(u);
        return s;
    }
    function toast(text, isError) {
        var t = $('toast');
        t.innerHTML = fg(text);
        t.classList.toggle('is-error', !!isError);
        t.hidden = false;
        window.clearTimeout(toast.timer);
        toast.timer = window.setTimeout(function () { t.hidden = true; }, 3200);
    }
    function confirmBox(opts) {
        var d = $('confirmDialog');
        $('confirmTitle').innerHTML = fg(opts.title);
        $('confirmBody').replaceChildren(opts.body);
        $('confirmOk').innerHTML = '<span class="fg">' + fg(opts.ok) + '</span>';
        return new Promise(function (resolve) {
            d.addEventListener('close', function done() {
                d.removeEventListener('close', done);
                resolve(d.returnValue === 'ok');
            });
            d.returnValue = '';
            d.showModal();
        });
    }
    function ymd(s) {
        var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? Number(m[1]) + '年' + Number(m[2]) + '月' + Number(m[3]) + '日' : '';
    }
    function dateText(v) {
        var d = new Date(v);
        if (isNaN(d)) return '';
        return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }
    function daysBetween(from, to) {
        var a = Date.UTC.apply(null, from.split('-').map(function (x, i) { return i === 1 ? Number(x) - 1 : Number(x); }));
        var b = Date.UTC.apply(null, to.split('-').map(function (x, i) { return i === 1 ? Number(x) - 1 : Number(x); }));
        return Math.round((b - a) / 86400000);
    }

    /* ===================== 表示の設定（ふりがな・文字の大きさ） ===================== */
    function applySettings(s) {
        var root = document.documentElement;
        root.classList.toggle('furigana-off', !s.furigana);
        root.classList.remove('fs-s', 'fs-l');
        if (s.fontSize === 's' || s.fontSize === 'l') root.classList.add('fs-' + s.fontSize);
        store(FURIGANA_KEY, s.furigana ? 'on' : 'off');
        store(FONT_KEY, s.fontSize);
    }

    /* ===================== 下のメニュー ===================== */
    function initTabbar() {
        var bar = $('tabbar');
        var lastY = window.scrollY;
        var ticking = false;
        function update() {
            ticking = false;
            var y = window.scrollY;
            var atBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 8;
            if (y < 24 || atBottom || y < lastY - 4) bar.classList.remove('is-hidden');       // 上にスクロール・いちばん上・いちばん下
            else if (y > lastY + 4) bar.classList.add('is-hidden');                          // 下にスクロール
            lastY = y;
        }
        window.addEventListener('scroll', function () {
            if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
        }, { passive: true });
    }

    /* ===================== ページの切り替え ===================== */
    function route() {
        var key = (location.hash || '#home').slice(1).split('?')[0];
        if (!PAGES[key]) key = 'home';
        state.page = key;
        document.querySelectorAll('.tab').forEach(function (t) {
            var on = t.getAttribute('data-page') === key;
            if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
        });
        $('topTitle').innerHTML = fg(PAGES[key].title);
        $('tabbar').classList.remove('is-hidden');
        var main = $('main');
        main.replaceChildren();
        if (key === 'home') renderHome(main);
        else if (key === 'mypage') renderMyPage(main);
        else if (window.RPages && window.RPages[key]) window.RPages[key](main);
        else renderSoon(main, key);
        window.scrollTo(0, 0);
    }

    /* ===================== ホーム ===================== */
    function renderHome(main) {
        var p = state.profile;
        var u = p.user;

        var hour = Number(new Date().getHours());
        var greet = hour < 11 ? 'おはよう' : hour < 18 ? 'こんにちは' : 'こんばんは';
        main.append(h('section', { class: 'card hello' }, [
            h('span', { class: 'deco deco-1', 'aria-hidden': 'true' }), h('span', { class: 'deco deco-2', 'aria-hidden': 'true' }), h('span', { class: 'deco deco-3', 'aria-hidden': 'true' }),
            h('p', { class: 'hello-sub', text: greet + '！' }),
            h('p', { class: 'hello-name', html: u.name + 'さん' }),
            h('p', { class: 'hello-msg', html: '{今日|きょう}も{少|すこ}しずつ、がんばろう！' }),
            h('div', { class: 'lv-row' }, u.levels.length ? u.levels.map(function (lv) { return h('span', { class: 'lv lv-' + lv, text: lv }); }) : [h('span', { class: 'muted', html: '{使|つか}えるレベルはまだありません' })])
        ]));

        // すぐ始めるボタン
        main.append(h('nav', { class: 'quick', 'aria-label': 'すぐ始める' }, [
            ['practice', 'st-practice', '{問題|もんだい}を{解|と}く'],
            ['vocab', 'st-vocab', '{単語|たんご}カード'],
            ['mock', 'st-mock', '{模擬|もぎ}{試験|しけん}']
        ].map(function (x) {
            return h('a', { class: 'quick-tile quick-' + x[0], href: '#' + x[0] }, [sticker(x[1]), h('span', { html: x[2] })]);
        })));

        // 続きから（あとで読み込む）
        main.append(h('div', { id: 'continueSlot' }));

        // 試験日までのカウントダウン
        var exam = p.exams.filter(function (e) { return e.examId === u.examId; })[0];
        if (exam) {
            var left = daysBetween(p.today, exam.date);
            main.append(h('section', { class: 'card count' }, [
                sticker('st-cal', 'count-st'),
                h('p', { class: 'count-label' }, [h('span', { text: exam.name })]),
                left > 0 ? h('p', { class: 'count-num' }, [document.createTextNode('あと'), h('b', { text: String(left) }), h('span', { html: '{日|にち}' })])
                    : h('p', { class: 'count-num', html: left === 0 ? '{今日|きょう}が{試験|しけん}の{日|ひ}です。がんばって！' : 'この{試験|しけん}は{終|お}わりました' }),
                h('p', { class: 'count-date', html: '{試験日|しけんび}：' + ymd(exam.date) })
            ]));
        } else {
            main.append(h('a', { class: 'card count count-empty', href: '#mypage?exam' }, [
                sticker('st-cal', 'count-st'),
                h('p', { class: 'count-label' }, [h('span', { html: '{試験日|しけんび}を{選|えら}びましょう' })]),
                h('p', { class: 'count-sub', html: 'マイページで{試験日|しけんび}を{選|えら}ぶと、{残|のこ}りの{日数|にっすう}が{出|で}ます。' }),
                icon('i-chev')
            ]));
        }

        // 学習の記録（あとで読み込む）
        main.append(h('div', { id: 'statsSlot', class: 'stats-slot' }, [h('section', { class: 'card stats-loading' }, [h('p', { class: 'muted', html: '{学習|がくしゅう}の{記録|きろく}を{読|よ}み{込|こ}んでいます…' })])]));

        // お支払い待ちの申込
        p.pending.forEach(function (a) {
            main.append(h('section', { class: 'card pending' }, [
                h('p', { class: 'pending-title', html: a.level + '：お{支払|しはら}い{待|ま}ち（{申込番号|もうしこみばんごう} ' + a.applicationId + '）' }),
                h('p', { class: 'pending-text', html: '{支払期限|しはらいきげん}：' + dateText(a.expiresAt) + '。{振込先|ふりこみさき}は、{受付|うけつけ}メールを{見|み}てください。{入金|にゅうきん}を{確認|かくにん}したら、メールでお{知|し}らせします。' })
            ]));
        });

        // お知らせ
        var box = h('section', { class: 'card notices' }, [h('h2', { class: 'card-title' }, [sticker('st-news', 'title-st'), h('span', { html: 'お{知|し}らせ' })])]);
        if (!p.notices.length) {
            box.append(h('p', { class: 'muted', html: 'いまはお{知|し}らせはありません。' }));
        } else {
            p.notices.forEach(function (n, i) {
                box.append(h('details', { class: 'notice' + (n.important ? ' is-important' : ''), open: i === 0 && n.important }, [
                    h('summary', {}, [
                        n.important ? h('span', { class: 'badge', html: '{重要|じゅうよう}' }) : null,
                        h('span', { class: 'notice-title', html: n.title }),
                        h('span', { class: 'notice-date', text: n.startDate.replace(/-/g, '/') })
                    ]),
                    h('div', { class: 'notice-body', html: n.body })
                ]));
            });
        }
        main.append(box);

        loadStats(main);
    }

    /* ===================== 学習の記録（R-10e） ===================== */
    var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
    var SECTION_ST = { '文字・語彙': 'moji', '文法': 'bunpo', '読解': 'dokkai', '聴解': 'choukai' };
    var SECTION_RUBY = { '文字・語彙': '{文字|もじ}・{語彙|ごい}', '文法': '{文法|ぶんぽう}', '読解': '{読解|どっかい}', '聴解': '{聴解|ちょうかい}' };

    function loadStats(main) {
        apiPost({ action: 'me.stats' }).then(function (res) {
            if (authFailed(res)) return;
            if (state.page !== 'home') return;
            if (!res || !res.ok) throw new Error('stats');
            drawContinue(res);
            drawStats(res);
        }).catch(function (err) {
            console.error(err);
            var slot = $('statsSlot');
            if (slot) slot.replaceChildren(h('section', { class: 'card' }, [h('p', { class: 'muted', html: '{学習|がくしゅう}の{記録|きろく}を{読|よ}み{込|こ}めませんでした。' })]));
        });
    }

    /** 問題のページを開いて、すぐに始める */
    function startPractice(params) {
        window.RPendingPractice = params;
        location.hash = '#practice';
    }

    function mockInProgress() {
        try {
            var raw = localStorage.getItem('ranguage_mock_' + state.profile.user.email);
            var e = raw ? JSON.parse(raw) : null;
            return e && e.papers ? e : null;
        } catch (err) { return null; }
    }

    function drawContinue(st) {
        var slot = $('continueSlot');
        if (!slot) return;
        var mk = mockInProgress();
        var item = null;
        if (mk) {
            item = { st: 'st-mock', cls: 'cont-mock', title: mk.level + ' {模試|もし}の{続|つづ}き', sub: '{時間|じかん}は{止|と}まっています', go: function () { location.hash = '#mock'; } };
        } else if (st.mistakes.count) {
            item = { st: 'st-redo', cls: 'cont-redo', title: 'まちがい{復習|ふくしゅう} ' + st.mistakes.count + '{問|もん}', sub: 'まちがえた{問題|もんだい}を、もう{一度|いちど}', go: function () { startPractice({ mode: 'mistakes', level: st.mistakes.level }); } };
        } else if (st.lastPractice) {
            var lp = st.lastPractice;
            item = { st: 'st-' + (SECTION_ST[lp.section] || 'practice'), cls: 'cont-last', title: '{前回|ぜんかい}の{続|つづ}き', sub: lp.level + ' ' + (SECTION_RUBY[lp.section] || lp.section) + (lp.mode === 'form' ? '・' + lp.form : ''),
                go: function () { startPractice(lp.mode === 'form' ? { mode: 'form', level: lp.level, section: lp.section, form: lp.form } : { mode: 'set', level: lp.level, section: lp.section }); } };
        }
        if (!item) { slot.replaceChildren(); return; }
        slot.replaceChildren(h('button', { type: 'button', class: 'card cont ' + item.cls, onclick: item.go }, [
            sticker(item.st, 'cont-st'),
            h('span', { class: 'cont-text' }, [
                h('span', { class: 'cont-label', html: '{続|つづ}きから' }),
                h('span', { class: 'cont-title', html: item.title }),
                h('span', { class: 'cont-sub', html: item.sub })
            ]),
            h('span', { class: 'cont-go' }, [icon('i-chev')])
        ]));
    }

    function drawStats(st) {
        var slot = $('statsSlot');
        if (!slot) return;
        var msg = st.doneToday ? '{今日|きょう}も{学習|がくしゅう}しました。すごい！' : st.streak ? '{今日|きょう}も{続|つづ}けよう！' : '{今日|きょう}から{始|はじ}めよう！';
        var week = h('ol', { class: 'week' }, st.week.map(function (d) {
            var p = d.date.split('-');
            var wd = WEEKDAYS[new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()];
            return h('li', { class: (d.count ? 'is-done' : '') + (d.date === st.today ? ' is-today' : '') }, [
                h('span', { class: 'week-dot' }, d.count ? [icon('i-check')] : []),
                h('span', { class: 'week-day', html: d.date === st.today ? '{今日|きょう}' : wd })
            ]);
        }));
        var streakCard = h('section', { class: 'card streak' }, [
            h('div', { class: 'streak-top' }, [
                sticker('st-fire', 'streak-st'),
                h('div', {}, [
                    h('p', { class: 'streak-num' }, [h('b', { text: String(st.streak) }), h('span', { html: '{日|にち}{連続|れんぞく}' })]),
                    h('p', { class: 'streak-msg', html: msg })
                ])
            ]),
            week
        ]);

        var rate = st.total.rate;
        var ring = h('div', { class: 'ring', style: '--p:' + (rate || 0) }, [
            h('span', { class: 'ring-num' }, rate === null ? [h('span', { text: '—' })] : [h('b', { text: String(rate) }), document.createTextNode('%')])
        ]);
        var rateCard = h('section', { class: 'card rate' }, [
            h('h2', { class: 'card-title' }, [sticker('st-target', 'title-st'), h('span', { html: '{正答率|せいとうりつ}' })]),
            h('div', { class: 'rate-body' }, [
                ring,
                h('ul', { class: 'rate-list' }, st.sections.map(function (s) {
                    return h('li', {}, [
                        sticker('st-' + SECTION_ST[s.section], 'rate-st'),
                        h('span', { class: 'rate-name', html: SECTION_RUBY[s.section] }),
                        h('span', { class: 'rate-bar' }, [h('span', { style: 'width:' + (s.rate || 0) + '%' })]),
                        h('span', { class: 'rate-pct', text: s.rate === null ? '—' : s.rate + '%' })
                    ]);
                }))
            ]),
            h('p', { class: 'rate-foot', html: '{答|こた}えた{問題|もんだい} ' + st.total.answered + '{問|もん}・{覚|おぼ}えた{単語|たんご} ' + st.vocab.known + ' / ' + st.vocab.total +
                (st.lastMock ? '・{最後|さいご}の{模試|もし} ' + st.lastMock.level + ' ' + st.lastMock.total + '{点|てん}' : '') })
        ]);
        slot.replaceChildren(streakCard, rateCard);
    }

    /* ===================== 準備中のページ ===================== */
    function renderSoon(main, key) {
        main.append(h('section', { class: 'card soon' }, [
            h('p', { class: 'soon-icon' }, [sticker('st-' + key)]),
            h('h2', { class: 'soon-title', html: PAGES[key].title }),
            h('p', { class: 'muted', html: 'ただいま{準備中|じゅんびちゅう}です。もうしばらくお{待|ま}ちください。' })
        ]));
    }

    /* ===================== マイページ ===================== */
    function renderMyPage(main) {
        var p = state.profile;
        var u = p.user;

        // アカウント
        main.append(h('section', { class: 'card' }, [
            h('h2', { class: 'card-title', html: 'アカウント' }),
            h('dl', { class: 'info' }, [
                h('dt', { html: 'お{名前|なまえ}' }), h('dd', { text: u.name }),
                h('dt', { text: 'メール' }), h('dd', { class: 'break', text: u.email })
            ])
        ]));

        // レベル
        var lvList = h('ul', { class: 'lv-list' });
        LEVELS.forEach(function (lv) {
            var owned = u.levels.indexOf(lv) >= 0;
            var pend = p.pending.filter(function (a) { return a.level === lv; })[0];
            var right;
            if (owned) right = h('span', { class: 'state state-on', html: '{利用中|りようちゅう}' });
            else if (pend) right = h('span', { class: 'state state-wait', html: 'お{支払|しはら}い{待|ま}ち' });
            else right = h('button', { type: 'button', class: 'pop-btn btn-pink btn-sm', html: '{追加|ついか}する', onclick: function () { applyLevel(lv); } });
            lvList.append(h('li', {}, [
                h('span', { class: 'lv lv-' + lv, text: lv }),
                h('span', { class: 'lv-price', text: '¥' + Number(p.prices[lv]).toLocaleString('ja-JP') }),
                right
            ]));
        });
        main.append(h('section', { class: 'card' }, [
            h('h2', { class: 'card-title', html: '{使|つか}えるレベル' }),
            lvList,
            h('p', { class: 'note', html: '{追加|ついか}は、{新|あたら}しいお{申|もう}し{込|こ}みと{同|おな}じです。{振込先|ふりこみさき}をメールでお{送|おく}りします。{入金|にゅうきん}を{確認|かくにん}したら、そのレベルが{使|つか}えるようになります。' })
        ]));

        // 試験日
        var sel = h('select', { id: 'examSelect', 'aria-label': '試験日' }, [h('option', { value: '', text: '選ばない' })]);
        p.exams.forEach(function (e) {
            var o = h('option', { value: e.examId, text: e.name + '（' + ymd(e.date) + '）' });
            if (e.examId === u.examId) o.selected = true;
            sel.append(o);
        });
        sel.addEventListener('change', function () { saveSettings({ examId: sel.value }); });
        var examCard = h('section', { class: 'card', id: 'examCard' }, [
            h('h2', { class: 'card-title', html: '{受|う}ける{試験|しけん}' }),
            h('label', { class: 'field' }, [h('span', { html: '{試験日|しけんび}' }), sel]),
            h('p', { class: 'note', html: '{選|えら}ぶと、ホームに{試験|しけん}までの{日数|にっすう}が{出|で}ます。' })
        ]);
        main.append(examCard);

        // 表示の設定
        var s = u.settings;
        function seg(name, label, options, value, onPick) {
            var wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
            options.forEach(function (o) {
                wrap.append(h('button', {
                    type: 'button', role: 'radio', class: 'seg-btn', 'aria-checked': String(o.value === value), html: o.label,
                    onclick: function () {
                        wrap.querySelectorAll('.seg-btn').forEach(function (b) { b.setAttribute('aria-checked', 'false'); });
                        this.setAttribute('aria-checked', 'true');
                        onPick(o.value);
                    }
                }));
            });
            return h('div', { class: 'set-row' }, [h('span', { class: 'set-label', html: label }), wrap]);
        }
        var fSwitch = h('button', {
            type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(s.furigana), 'aria-label': 'ふりがな',
            onclick: function () {
                var on = this.getAttribute('aria-checked') !== 'true';
                this.setAttribute('aria-checked', String(on));
                saveSettings({ settings: { furigana: on } });
            }
        }, [h('span', { class: 'switch-knob' }), h('span', { class: 'switch-on', text: 'ON' }), h('span', { class: 'switch-off', text: 'OFF' })]);
        main.append(h('section', { class: 'card' }, [
            h('h2', { class: 'card-title', html: '{表示|ひょうじ}の{設定|せってい}' }),
            h('div', { class: 'set-row' }, [h('span', { class: 'set-label', text: 'ふりがな' }), fSwitch]),
            seg('fontSize', '{文字|もじ}の{大|おお}きさ', [{ value: 's', label: '{小|しょう}' }, { value: 'm', label: '{中|ちゅう}' }, { value: 'l', label: '{大|だい}' }], s.fontSize,
                function (v) { saveSettings({ settings: { fontSize: v } }); }),
            seg('speed', '{聴解|ちょうかい}の{速|はや}さ', [{ value: 0.75, label: 'ゆっくり' }, { value: 1, label: 'ふつう' }, { value: 1.25, label: 'はやい' }], s.speed,
                function (v) { saveSettings({ settings: { speed: v } }); })
        ]));

        // パスワード変更
        var form = h('form', { class: 'pw-form', novalidate: true }, [
            h('label', { class: 'field' }, [h('span', { html: 'いまのパスワード' }), h('input', { type: 'password', name: 'current', autocomplete: 'current-password', required: true })]),
            h('label', { class: 'field' }, [h('span', { html: '{新|あたら}しいパスワード（8{文字|もじ}{以上|いじょう}）' }), h('input', { type: 'password', name: 'next', autocomplete: 'new-password', minlength: '8', maxlength: '64', required: true })]),
            h('label', { class: 'field' }, [h('span', { html: '{新|あたら}しいパスワード（{確認|かくにん}）' }), h('input', { type: 'password', name: 'again', autocomplete: 'new-password', required: true })]),
            h('p', { class: 'form-msg', id: 'pwMsg', role: 'status' }),
            h('button', { type: 'submit', class: 'pop-btn btn-purple btn-block', html: '{変更|へんこう}する' })
        ]);
        form.addEventListener('submit', function (e) { e.preventDefault(); changePassword(form); });
        main.append(h('section', { class: 'card' }, [h('h2', { class: 'card-title', html: 'パスワードの{変更|へんこう}' }), form]));

        // ログアウト・リンク
        main.append(h('section', { class: 'card links' }, [
            h('button', { type: 'button', class: 'pop-btn btn-white btn-block', onclick: logout }, [icon('i-out'), h('span', { text: 'ログアウト' })]),
            h('p', { class: 'note' }, [
                h('a', { href: 'https://jprojectsriki-cpu.github.io/rikis_collection/#contact', target: '_blank', rel: 'noopener', html: 'お{問|と}い{合|あ}わせ' }),
                document.createTextNode('　'),
                h('a', { href: 'index.html', html: 'トップページ' })
            ])
        ]));

        if (/\?exam/.test(location.hash)) window.setTimeout(function () { examCard.scrollIntoView({ block: 'center' }); examCard.classList.add('is-flash'); }, 50);
    }

    /* ---------- マイページの操作 ---------- */
    /* 設定の保存
     * - 押した内容は、すぐ画面に当てる（want に入れる）
     * - 続けて押したときは、最後の内容だけを送る（0.4秒待ってから送る・同時に2つは送らない）
     * - 保存が終わる前に画面を閉じようとしたら、ブラウザが確認を出す
     */
    var save = { want: null, timer: 0, busy: false };
    function saveSettings(change) {
        var u = state.profile.user;
        var base = save.want || { examId: u.examId, settings: u.settings };
        save.want = {
            examId: change.examId !== undefined ? change.examId : base.examId,
            settings: Object.assign({}, base.settings, change.settings || {})
        };
        applySettings(save.want.settings);
        window.clearTimeout(save.timer);
        save.timer = window.setTimeout(sendSettings, 400);
    }
    function sendSettings() {
        if (save.busy || !save.want) return;
        var u = state.profile.user;
        var sending = save.want;
        save.busy = true;
        apiPost({ action: 'me.saveSettings', examId: sending.examId, settings: sending.settings }).then(function (res) {
            save.busy = false;
            if (authFailed(res)) return;
            if (!res || !res.ok) return failed((res && res.message) || '{保存|ほぞん}できませんでした。');
            u.examId = res.examId;
            u.settings = res.settings;
            if (save.want === sending) {          // 送っているあいだに、ほかの変更がなかった
                save.want = null;
                toast('{保存|ほぞん}しました');
            } else {
                sendSettings();                    // あとから押した内容を続けて送る
            }
        }).catch(function () {
            save.busy = false;
            failed('{通信|つうしん}に{失敗|しっぱい}しました。もう{一度|いちど}お{試|ため}しください。');
        });
        function failed(text) {
            save.want = null;
            applySettings(u.settings);             // 最後に保存できた設定にもどす
            toast(text, true);
            if (state.page === 'mypage') route();
        }
    }
    window.addEventListener('beforeunload', function (e) {
        if (save.want) { e.preventDefault(); e.returnValue = ''; }
    });

    function applyLevel(lv) {
        var price = '¥' + Number(state.profile.prices[lv]).toLocaleString('ja-JP');
        var body = h('div', {}, [
            h('p', { html: lv + '（' + price + '・{買|か}い{切|き}り）を{追加|ついか}で{申|もう}し{込|こ}みます。' }),
            h('p', { class: 'note', html: 'お{支払|しはら}いは{銀行|ぎんこう}{振込|ふりこみ}です。{振込先|ふりこみさき}とATMでの{振|ふ}り{込|こ}み{方|かた}を、メールでお{送|おく}りします。{支払期限|しはらいきげん}は7{日|か}です。' })
        ]);
        confirmBox({ title: lv + 'を{追加|ついか}する', body: body, ok: '{申|もう}し{込|こ}む' }).then(function (yes) {
            if (!yes) return;
            withLoading('お<ruby>申<rt>もう</rt></ruby>し<ruby>込<rt>こ</rt></ruby>みを<ruby>送信<rt>そうしん</rt></ruby>しています', apiPost({ action: 'me.applyLevel', level: lv }))
                .then(function (res) {
                    if (authFailed(res)) return;
                    if (!res || !res.ok) { toast((res && res.message) || 'お申し込みできませんでした。', true); return; }
                    toast('{受|う}け{付|つ}けました。メールを{確|たし}かめてください。');
                    return loadProfile().then(route);
                })
                .catch(function () { toast('{通信|つうしん}に{失敗|しっぱい}しました。もう{一度|いちど}お{試|ため}しください。', true); });
        });
    }

    function changePassword(form) {
        var msg = $('pwMsg');
        var cur = form.elements.current.value;
        var next = form.elements.next.value;
        function say(t, err) { msg.innerHTML = fg(t); msg.classList.toggle('is-error', !!err); }
        if (!cur || !next) return say('パスワードを{入力|にゅうりょく}してください。', true);
        if (next.length < 8) return say('{新|あたら}しいパスワードは8{文字|もじ}{以上|いじょう}にしてください。', true);
        if (next !== form.elements.again.value) return say('{新|あたら}しいパスワード（{確認|かくにん}）が{同|おな}じではありません。', true);
        withLoading('パスワードを<ruby>変更<rt>へんこう</rt></ruby>しています', apiPost({ action: 'me.changePassword', currentPassword: cur, newPassword: next }))
            .then(function (res) {
                if (authFailed(res)) return;
                if (!res || !res.ok) { say((res && res.message) || '{変更|へんこう}できませんでした。', true); return; }
                form.reset();
                say('パスワードを{変更|へんこう}しました。');
            })
            .catch(function () { say('{通信|つうしん}に{失敗|しっぱい}しました。もう{一度|いちど}お{試|ため}しください。', true); });
    }

    function logout() {
        apiPost({ action: 'logout' }).catch(function () {});
        setToken('');
        location.replace('login.html');
    }

    /* ===================== 開いたとき ===================== */
    function loadProfile() {
        return apiPost({ action: 'me.profile' }).then(function (res) {
            if (authFailed(res)) return Promise.reject('auth');
            if (!res || !res.ok) throw new Error((res && res.message) || 'load failed');
            state.profile = res;
            applySettings(res.user.settings);
        });
    }

    function start() {
        if (!getToken() || !/^https:\/\//.test(CONFIG.API_URL || '')) { location.replace('login.html'); return; }
        initTabbar();
        withLoading('<ruby>読<rt>よ</rt></ruby>み<ruby>込<rt>こ</rt></ruby>んでいます', loadProfile())
            .then(function () {
                window.addEventListener('hashchange', route);
                route();
            })
            .catch(function (err) {
                if (err === 'auth') return;
                console.error(err);
                $('main').replaceChildren(h('section', { class: 'card soon' }, [
                    h('p', { html: '{読|よ}み{込|こ}めませんでした。{時間|じかん}をおいて、もう{一度|いちど}{開|ひら}いてください。' })
                ]));
            });
    }

    /* ほかのページ（js/practice.js など）から使う道具 */
    window.RApp = {
        state: state, h: h, fg: fg, icon: icon, sticker: sticker, toast: toast, confirmBox: confirmBox,
        apiPost: apiPost, withLoading: withLoading, authFailed: authFailed, setTitle: function (t) { $('topTitle').innerHTML = fg(t); }
    };

    document.addEventListener('DOMContentLoaded', start);
})();
