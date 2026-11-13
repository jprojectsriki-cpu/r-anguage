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
    function load(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }

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
        return esc(text).replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '<ruby>$1<rt>$2</rt></ruby>')
            .replace(/__(.+?)__/g, '<u class="ul">$1</u>') // __ことば__ は下線（本番の問題と同じ）
            .replace(/［\s*([0-9０-９]{1,2})\s*］/g, '<span class="blank" data-n="$1">$1</span>') // 文章の文法の空欄［１］
            .replace(/\n/g, '<br>');
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
        // ほかのページから来たときだけ、レベルを選ぶ画面を出す（同じページの中で戻ったときは出さない）
        state.askLevel = state.page !== key;
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
    /** ホーム：学習の記録を読み込み終わるまで、ローディングの画面を出す */
    function renderHome(main) {
        if (state.statsReady) { state.statsReady = false; buildHome(main); return; }
        withLoading('<ruby>読<rt>よ</rt></ruby>み<ruby>込<rt>こ</rt></ruby>んでいます', fetchStats()).then(function () {
            if (state.page !== 'home') return;
            main.replaceChildren();
            buildHome(main);
        }).catch(function (err) { if (err !== 'auth') console.error(err); });
    }

    function buildHome(main) {
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
        main.append(h('div', { id: 'statsSlot', class: 'stats-slot' }));

        // 利用期限が近い・切れたレベル（マイページから更新できる）
        var pendLv = {};
        p.pending.forEach(function (a) { (a.level === 'ALL' ? LEVELS : [a.level]).forEach(function (x) { pendLv[x] = true; }); });
        (p.validity || []).forEach(function (v) {
            if (pendLv[v.level] || !(v.renewable || !v.active)) return;
            main.append(h('a', { class: 'card pending renew-card', href: '#mypage' }, [
                h('p', { class: 'pending-title', html: v.active
                    ? v.level + '：{利用期限|りようきげん}まであと' + v.daysLeft + '{日|にち}'
                    : v.level + '：{利用期限|りようきげん}が{過|す}ぎました' }),
                h('p', { class: 'pending-text', html: v.active
                    ? '{期限|きげん}は' + dateText(v.expiresAt) + 'までです。マイページから{更新|こうしん}できます（いまの{期限|きげん}から1{年|ねん}のびます）。'
                    : '{成績|せいせき}は{残|のこ}っています。マイページから{更新|こうしん}すると、また{使|つか}えるようになります。' })
            ]));
        });

        // お支払い待ちの申込
        p.pending.forEach(function (a) {
            main.append(h('section', { class: 'card pending' }, [
                h('p', { class: 'pending-title', html: (a.level === 'ALL' ? 'N4〜N1 まとめて' : a.level) + '：お{支払|しはら}い{待|ま}ち（{申込番号|もうしこみばんごう} ' + a.applicationId + '）' }),
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

        if (state.stats) {
            drawContinue(state.stats);
            drawStats(state.stats);
        } else {
            $('statsSlot').replaceChildren(h('section', { class: 'card' }, [h('p', { class: 'muted', html: '{学習|がくしゅう}の{記録|きろく}を{読|よ}み{込|こ}めませんでした。' })]));
        }
    }

    /* ===================== 学習の記録（R-10e） ===================== */
    var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
    var SECTION_ST = { '文字・語彙': 'moji', '文法': 'bunpo', '読解': 'dokkai', '聴解': 'choukai' };
    var SECTION_RUBY = { '文字・語彙': '{文字|もじ}・{語彙|ごい}', '文法': '{文法|ぶんぽう}', '読解': '{読解|どっかい}', '聴解': '{聴解|ちょうかい}' };

    /*
     * 送っている途中の記録（答え・覚えた単語）があれば、送り終わるのを待つ
     * （待たずに数を読むと、押したばかりの分がまだ入っていないことがある）
     */
    var drains = [];
    function registerDrain(fn) { drains.push(fn); }
    function afterSaves() {
        var all = Promise.all(drains.map(function (fn) {
            try { return Promise.resolve(fn()).catch(function () {}); } catch (e) { return Promise.resolve(); }
        }));
        return Promise.race([all, new Promise(function (r) { setTimeout(r, 32000); })]);
    }
    /** outbox（{ list, busy }）が空になるまで待つ関数を作る */
    function makeDrain(outbox, flush) {
        return function () {
            return new Promise(function (resolve) {
                var t0 = Date.now();
                var tries = 0, idleSince = 0;
                (function tick() {
                    if (!outbox.list.length && !outbox.busy) return resolve();
                    if (Date.now() - t0 > 30000) return resolve(); // 30秒待っても終わらないときは進む
                    if (outbox.busy) { idleSince = 0; }
                    else if (!idleSince) { idleSince = Date.now(); }
                    else if (Date.now() - idleSince > 1200) { // 送っていない答えが残っている（前の送信が失敗した）
                        if (tries >= 2) return resolve(); // 2回送り直してもだめなら、待たずに進む
                        tries++; idleSince = 0;
                        flush();
                    }
                    setTimeout(tick, 150);
                })();
            });
        };
    }

    /** 学習の記録を読み込む（失敗しても、ホームは出す） */
    function fetchStats() {
        return afterSaves().then(function () { return apiPost({ action: 'me.stats' }); }).then(function (res) {
            if (authFailed(res)) return Promise.reject('auth');
            state.stats = res && res.ok ? res : null;
        }, function (err) {
            console.error(err);
            state.stats = null;
        });
    }

    /* ===================== STAGE（EASY → NORMAL → HARD） ===================== */
    // info: { stage, rate, need, next, goal }（GAS の stageInfo_）
    function goalBadge() {
        return h('span', { class: 'goal-badge', html: '★ {合格|ごうかく}ライン{到達|とうたつ}' });
    }
    function stageNote(info) {
        if (!info) return '';
        if (info.all) return '{管理者|かんりしゃ}アカウントなので、すべての STAGE を{使|つか}えます（{確認用|かくにんよう}）。{受講生|じゅこうせい}は、{模試|もし}の{結果|けっか}で{次|つぎ}の STAGE に{進|すす}みます。';
        var cond = '{模試|もし}で ' + info.need + '{点|てん}（' + info.rate + '%）{以上|いじょう}、かつ、どの{区分|くぶん}も{基準点|きじゅんてん}{以上|いじょう}';
        if (info.next) return cond + 'で、' + info.next + ' が{解放|かいほう}されます。';
        if (info.goal) return 'HARD の{模試|もし}で 90%{以上|いじょう}をとり、{合格|ごうかく}ラインに{到達|とうたつ}しました。';
        return cond + 'で、「{合格|ごうかく}ライン{到達|とうたつ}」です。';
    }
    function stagePill(stage) {
        return h('span', { class: 'stage-pill stage-' + String(stage || 'EASY').toLowerCase(), text: stage || 'EASY' });
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

    /* =====================================================================
     * 勉強するレベル（ホーム・問題・単語・模試で共通。選んだレベルは覚えておく）
     * 複数のレベルを使える受講生は、問題・単語・模試のページを開いたとき、大きなボタンで選んでもらう
     * ===================================================================== */
    var STUDY_KEY = 'ranguage_study_level';
    function studyLevel(levels, legacyKey) {
        var saved = load(STUDY_KEY) || (legacyKey ? load(legacyKey) : '') || state.homeLevel || '';
        return levels.indexOf(saved) >= 0 ? saved : levels[0];
    }
    function setStudyLevel(lv) {
        state.homeLevel = lv;
        store(STUDY_KEY, lv);
    }
    function takeAskLevel() { var a = !!state.askLevel; state.askLevel = false; return a; }

    var LEVEL_NOTE = { N4: '{基本|きほん}', N3: '{中級|ちゅうきゅう}', N2: '{中上級|ちゅうじょうきゅう}', N1: '{上級|じょうきゅう}' };
    /** レベルを選ぶ画面（大きなボタン）。選んだレベルを返す（閉じたら null） */
    function chooseLevel(levels, current) {
        var d = $('levelDialog');
        if (!d) {
            d = h('dialog', { class: 'modal lv-modal', id: 'levelDialog', 'aria-labelledby': 'levelDialogTitle' });
            document.body.append(d);
        }
        return new Promise(function (resolve) {
            var picked = null;
            var grid = h('div', { class: 'lv-pick' }, levels.map(function (lv) {
                return h('button', {
                    type: 'button', class: 'lv-pick-btn lv-' + lv + (lv === current ? ' is-last' : ''),
                    onclick: function () { picked = lv; d.close(); }
                }, [h('b', { text: lv }), h('span', { html: LEVEL_NOTE[lv] || '' }), lv === current ? h('small', { html: '{前回|ぜんかい}' }) : null]);
            }));
            d.replaceChildren(h('div', { class: 'modal-box' }, [
                h('h2', { class: 'modal-title', id: 'levelDialogTitle', html: 'どのレベルを{勉強|べんきょう}しますか？' }),
                h('p', { class: 'lv-pick-note', html: 'ボタンを{押|お}してください。あとから「レベルを{変|か}える」で{変|か}えられます。' }),
                grid
            ]));
            d.addEventListener('close', function done() {
                d.removeEventListener('close', done);
                resolve(picked);
            });
            d.showModal();
            var first = d.querySelector('.is-last') || d.querySelector('.lv-pick-btn');
            if (first) first.focus();
        });
    }
    /**
     * ページの上の「いま勉強しているレベル」（複数あるときは「レベルを変える」ボタン）
     * opts: { isAdmin, onChange(lv) }
     */
    function levelBar(levels, current, opts) {
        opts = opts || {};
        var kids = [
            h('span', { class: 'lv-now-label', html: 'いま{勉強|べんきょう}しているレベル' }),
            h('span', { class: 'lv lv-' + current + ' lv-now-pill', text: current })
        ];
        if (levels.length > 1) {
            kids.push(h('button', {
                type: 'button', class: 'pop-btn btn-white btn-sm lv-change', html: 'レベルを{変|か}える',
                onclick: function () {
                    chooseLevel(levels, current).then(function (lv) {
                        if (lv && lv !== current) { setStudyLevel(lv); if (opts.onChange) opts.onChange(lv); }
                    });
                }
            }));
        } else if (!opts.isAdmin) {
            kids.push(h('a', { class: 'lv-add', href: '#mypage', html: '＋レベルを{追加|ついか}' }));
        }
        return h('div', { class: 'lv-now' }, kids);
    }
    /** ページを開いたとき、レベルが2つ以上なら選んでもらう */
    function askLevelIfNeeded(levels, current, onChange) {
        if (!takeAskLevel() || levels.length < 2) return;
        chooseLevel(levels, current).then(function (lv) {
            if (!lv) return;
            setStudyLevel(lv);
            if (lv !== current && onChange) onChange(lv);
        });
    }

    var HOME_LV_KEY = 'ranguage_home_level';
    function homeLevelView(st) {
        var list = st.byLevel || [];
        if (!list.length) return null;
        var saved = load(STUDY_KEY) || load(HOME_LV_KEY) || '';
        var hit = list.filter(function (x) { return x.level === (state.homeLevel || saved); })[0];
        if (!hit) {
            // 答えた数がいちばん多いレベル（まだなければ最初のレベル）
            hit = list.slice().sort(function (a, b) { return b.total.answered - a.total.answered; })[0];
        }
        state.homeLevel = hit.level;
        return hit;
    }
    function setHomeLevel(lv) {
        setStudyLevel(lv);
        drawContinue(state.stats);
        drawStats(state.stats);
    }

    function drawContinue(st) {
        var slot = $('continueSlot');
        if (!slot) return;
        var mk = mockInProgress();
        var item = null;
        var lvView = homeLevelView(st);
        var multi = (st.byLevel || []).length > 1;
        if (mk) {
            item = { st: 'st-mock', cls: 'cont-mock', title: mk.level + ' {模試|もし}の{続|つづ}き', sub: '{時間|じかん}は{止|と}まっています', go: function () { location.hash = '#mock'; } };
        } else if ((lvView ? lvView.mistakes : st.mistakes.count)) {
            var mkCount = lvView ? lvView.mistakes : st.mistakes.count;
            var mkLevel = lvView ? lvView.level : st.mistakes.level;
            item = { st: 'st-redo', cls: 'cont-redo', title: (multi ? mkLevel + ' ' : '') + 'まちがい{復習|ふくしゅう} ' + mkCount + '{問|もん}', sub: 'まちがえた{問題|もんだい}を、もう{一度|いちど}', go: function () { startPractice({ mode: 'mistakes', level: mkLevel }); } };
        } else if (st.lastPractice) {
            var lp = st.lastPractice;
            item = { st: 'st-' + (SECTION_ST[lp.section] || 'practice'), cls: 'cont-last', title: '{前回|ぜんかい}の{続|つづ}き', sub: lp.level + ' ' + (lp.stage ? lp.stage + ' ' : '') + (SECTION_RUBY[lp.section] || lp.section) + (lp.mode === 'form' ? '・' + lp.form : ''),
                go: function () { startPractice(lp.mode === 'form' ? { mode: 'form', level: lp.level, section: lp.section, form: lp.form, stage: lp.stage || 'EASY' } : { mode: 'set', level: lp.level, section: lp.section, stage: lp.stage || 'EASY' }); } };
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

        var view = homeLevelView(st);
        var multi = (st.byLevel || []).length > 1;
        var total = view ? view.total : st.total;
        var sections = view ? view.sections : st.sections;
        var vocab = view ? view.vocab : st.vocab;
        var lastMock = view ? view.lastMock : st.lastMock;
        var rate = total.rate;
        var ring = h('div', { class: 'ring', style: '--p:' + (rate || 0) }, [
            h('span', { class: 'ring-num' }, [h('span', { class: 'ring-val' }, rate === null ? [h('span', { text: '—' })] : [h('b', { text: String(rate) }), h('small', { text: '%' })])])
        ]);
        var lvTabs = multi ? h('div', { class: 'lv-tabs', role: 'tablist', 'aria-label': 'レベル' }, st.byLevel.map(function (x) {
            var on = x.level === view.level;
            return h('button', { type: 'button', role: 'tab', class: 'lv-tab' + (on ? ' is-on' : ''), 'aria-selected': on ? 'true' : 'false',
                onclick: function () { if (!on) setHomeLevel(x.level); } }, [h('span', { text: x.level })]);
        })) : null;
        var rateCard = h('section', { class: 'card rate' }, [
            h('h2', { class: 'card-title' }, [sticker('st-target', 'title-st'), h('span', { html: (multi ? view.level + ' の' : '') + '{正答率|せいとうりつ}' })]),
            lvTabs,
            h('div', { class: 'rate-body' }, [
                ring,
                h('ul', { class: 'rate-list' }, sections.map(function (s) {
                    return h('li', {}, [
                        sticker('st-' + SECTION_ST[s.section], 'rate-st'),
                        h('span', { class: 'rate-name', html: SECTION_RUBY[s.section] }),
                        h('span', { class: 'rate-bar' }, [h('span', { style: 'width:' + (s.rate || 0) + '%' })]),
                        h('span', { class: 'rate-pct', text: s.rate === null ? '—' : s.rate + '%' })
                    ]);
                }))
            ]),
            h('ul', { class: 'rate-foot' }, [
                h('li', {}, [h('span', { class: 'rf-label', html: '{答|こた}えた{問題|もんだい}' }), h('span', { class: 'rf-val', html: total.answered + ' {問|もん}' })]),
                h('li', {}, [h('span', { class: 'rf-label', html: '{覚|おぼ}えた{単語|たんご}' }), h('span', { class: 'rf-val', html: vocab.known + ' / ' + vocab.total + ' {枚|まい}' })]),
                view && view.stage ? h('li', {}, [h('span', { class: 'rf-label', text: 'STAGE' }), h('span', { class: 'rf-val' }, view.stage.all ? [h('span', { html: 'すべて（{管理者|かんりしゃ}）' })] : [stagePill(view.stage.stage), view.stage.goal ? goalBadge() : null])]) : null,
                h('li', {}, [h('span', { class: 'rf-label', html: '{最後|さいご}の{模試|もし}' }), h('span', { class: 'rf-val', html: lastMock ? lastMock.level + '　' + lastMock.total + ' / 180 {点|てん}' : 'まだ{受|う}けていません' })])
            ])
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

        // レベル（利用期限は、レベルごとに1年）
        var vmap = {};
        (p.validity || []).forEach(function (v) { vmap[v.level] = v; });
        var lvList = h('ul', { class: 'lv-list' });
        LEVELS.forEach(function (lv) {
            var v = vmap[lv];
            var owned = !!v || u.levels.indexOf(lv) >= 0;
            var pend = p.pending.filter(function (a) { return a.level === lv || a.level === 'ALL'; })[0];
            var right, sub = null;
            if (pend) right = h('span', { class: 'state state-wait', html: 'お{支払|しはら}い{待|ま}ち' });
            else if (owned && (!v || (v.active && !v.renewable))) right = h('span', { class: 'state state-on', html: '{利用中|りようちゅう}' });
            else if (owned) right = h('button', { type: 'button', class: 'pop-btn btn-pink btn-sm', html: '{更新|こうしん}する', onclick: function () { applyLevel(lv, true); } });
            else right = h('button', { type: 'button', class: 'pop-btn btn-pink btn-sm', html: '{追加|ついか}する', onclick: function () { applyLevel(lv, false); } });
            if (v && v.expiresAt) {
                sub = h('span', { class: 'lv-exp' + (v.active ? '' : ' is-expired'), html: v.active
                    ? '{利用期限|りようきげん}：' + dateText(v.expiresAt) + 'まで'
                    : '{期限切|きげんぎ}れ（' + dateText(v.expiresAt) + '）' });
            }
            lvList.append(h('li', {}, [
                h('span', { class: 'lv lv-' + lv, text: lv }),
                h('span', { class: 'lv-mid' }, [h('span', { class: 'lv-price', text: '¥' + Number(p.prices[lv]).toLocaleString('ja-JP') + ' / 1年' }), sub]),
                right
            ]));
        });
        // N4〜N1 をすべて持っている人は、まとめて更新できる
        var bundle = p.bundle;
        if (bundle && bundle.levels.every(function (lv) { return vmap[lv]; }) &&
            bundle.levels.some(function (lv) { return vmap[lv].renewable; }) &&
            !p.pending.some(function (a) { return a.level === 'ALL' || bundle.levels.indexOf(a.level) >= 0; })) {
            lvList.append(h('li', {}, [
                h('span', { class: 'lv lv-ALL', text: 'N4〜N1' }),
                h('span', { class: 'lv-mid' }, [h('span', { class: 'lv-price', text: '¥' + Number(bundle.price).toLocaleString('ja-JP') + ' / 1年' }),
                    h('span', { class: 'lv-exp', html: 'まとめて{更新|こうしん}（4つのレベル）' })]),
                h('button', { type: 'button', class: 'pop-btn btn-pink btn-sm', html: '{更新|こうしん}する', onclick: function () { applyLevel('ALL', true); } })
            ]));
        }
        main.append(h('section', { class: 'card' }, [
            h('h2', { class: 'card-title', html: '{使|つか}えるレベル' }),
            lvList,
            h('p', { class: 'note', html: '{利用期限|りようきげん}は、レベルごとにお{支払|しはら}いを{確認|かくにん}した{日|ひ}から1{年|ねん}です。{期限|きげん}の' + (p.renewDays || 30) + '{日前|にちまえ}から{更新|こうしん}できます（{新規|しんき}と{同|おな}じ{料金|りょうきん}で、いまの{期限|きげん}から1{年|ねん}のびます）。{期限|きげん}が{切|き}れても、{成績|せいせき}は{残|のこ}ります。' }),
            h('p', { class: 'note', html: '{追加|ついか}・{更新|こうしん}は、{振込先|ふりこみさき}をメールでお{送|おく}りします。{入金|にゅうきん}を{確認|かくにん}したら、そのレベルが{使|つか}えるようになります。' })
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

        // 成績のリセット（ホームの正答率を、その科目だけ 0 からにする）
        var rLevels = (p.studyLevels || u.levels).filter(function (lv) { return LEVELS.indexOf(lv) >= 0; });
        if (rLevels.length) {
            var rLv = h('select', { id: 'resetLevel', 'aria-label': 'レベル' });
            rLevels.forEach(function (lv) { rLv.append(h('option', { value: lv, text: lv })); });
            var rSec = h('select', { id: 'resetSection', 'aria-label': '科目' }, [h('option', { value: 'ALL', text: 'ぜんぶの科目' })]);
            ['文字・語彙', '文法', '読解', '聴解'].forEach(function (sec) { rSec.append(h('option', { value: sec, text: sec })); });
            var rBtn = h('button', { type: 'button', class: 'pop-btn btn-white btn-block', id: 'resetBtn', html: '{成績|せいせき}をリセットする' });
            rBtn.addEventListener('click', function () { resetStats(rLv.value, rSec.value, rBtn); });
            main.append(h('section', { class: 'card', id: 'resetCard' }, [
                h('h2', { class: 'card-title', html: '{成績|せいせき}のリセット' }),
                h('p', { class: 'note', html: 'ホームの{正答率|せいとうりつ}は、1{問|もん}ごとに{最後|さいご}の{答|こた}えで{計算|けいさん}します。まちがえた{問題|もんだい}も、{解|と}き{直|なお}して{正解|せいかい}すれば{上|あ}がります。{最初|さいしょ}からやり{直|なお}したいときは、リセットすると、その{科目|かもく}の{正答率|せいとうりつ}が 0 からになります。' }),
                h('label', { class: 'field' }, [h('span', { text: 'レベル' }), rLv]),
                h('label', { class: 'field' }, [h('span', { html: '{科目|かもく}' }), rSec]),
                rBtn,
                h('p', { class: 'note', html: 'まちがい{復習|ふくしゅう}・お{気|き}に{入|い}り・{単語|たんご}カード・{連続|れんぞく}{日数|にっすう}は、そのままです。' })
            ]));
        }

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
    /** 成績のリセット（確認してから送る） */
    function resetStats(level, section, btn) {
        var SEC_RUBY = { '文字・語彙': '{文字|もじ}・{語彙|ごい}', '文法': '{文法|ぶんぽう}', '読解': '{読解|どっかい}', '聴解': '{聴解|ちょうかい}' };
        var secText = section === 'ALL' ? 'ぜんぶの{科目|かもく}' : (SEC_RUBY[section] || section);
        confirmBox({
            title: '{成績|せいせき}をリセットしますか？',
            body: h('p', { html: level + ' の' + secText + 'の{正答率|せいとうりつ}を、0 からにします。{元|もと}にはもどせません。' }),
            ok: 'リセットする'
        }).then(function (yes) {
            if (!yes) return;
            btn.disabled = true;
            return withLoading('リセットしています', afterSaves().then(function () {
                return apiPost({ action: 'me.resetStats', level: level, section: section });
            })).then(function (res) {
                if (authFailed(res)) return;
                if (!res || !res.ok) { toast((res && res.message) || 'リセットできませんでした。', true); return; }
                toast(level + ' の' + secText + 'の{成績|せいせき}をリセットしました。');
            }, function () {
                toast('{通信|つうしん}できませんでした。もう{一度|いちど}{試|ため}してください。', true);
            }).then(function () { btn.disabled = false; });
        });
    }

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

    function applyLevel(lv, renew) {
        var isAll = lv === 'ALL';
        var name = isAll ? 'N4〜N1 まとめて' : lv;
        var price = '¥' + Number(isAll ? state.profile.bundle.price : state.profile.prices[lv]).toLocaleString('ja-JP');
        var verb = renew ? '{更新|こうしん}' : '{追加|ついか}';
        var body = h('div', {}, [
            h('p', { html: name + '（' + price + '・1{年間|ねんかん}）を' + verb + 'で{申|もう}し{込|こ}みます。' + (renew ? '{入金|にゅうきん}を{確認|かくにん}したら、いまの{期限|きげん}から1{年|ねん}のびます（{期限切|きげんぎ}れのときは、その{日|ひ}から1{年|ねん}）。' : '') }),
            h('p', { class: 'note', html: 'お{支払|しはら}いは{銀行|ぎんこう}{振込|ふりこみ}です。{振込先|ふりこみさき}とATMでの{振|ふ}り{込|こ}み{方|かた}を、メールでお{送|おく}りします。{支払期限|しはらいきげん}は7{日|か}です。' })
        ]);
        confirmBox({ title: name + 'を' + verb + 'する', body: body, ok: '{申|もう}し{込|こ}む' }).then(function (yes) {
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
        // 最初にホームを開くときは、学習の記録もいっしょに読み込む（ローディングの画面は1回だけ）
        var firstKey = (location.hash || '#home').slice(1).split('?')[0];
        var first = loadProfile().then(function () {
            if (firstKey === 'home' || !PAGES[firstKey]) return fetchStats().then(function () { state.statsReady = true; });
        });
        var booting = withLoading('<ruby>読<rt>よ</rt></ruby>み<ruby>込<rt>こ</rt></ruby>んでいます', first);
        document.documentElement.classList.remove('booting'); // ローディングの画面が出たので、中身を見せてよい
        booting
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

    /* 大問ごとの指示文（本番の問題用紙と同じ言い方）。問題の上に出す */
    var FORM_GUIDE = {
        '漢字読み': '＿＿＿のことばの{読|よ}み{方|かた}として{最|もっと}もよいものを、１・２・３・４から{一|ひと}つえらびなさい。',
        '表記': '＿＿＿のことばを{漢字|かんじ}で{書|か}くとき、{最|もっと}もよいものを、１・２・３・４から{一|ひと}つえらびなさい。',
        '語形成': '（　　）に{入|い}れるのに{最|もっと}もよいものを、１・２・３・４から{一|ひと}つえらびなさい。',
        '文脈規定': '（　　）に{入|い}れるのに{最|もっと}もよいものを、１・２・３・４から{一|ひと}つえらびなさい。',
        '言い換え類義': '＿＿＿に{意味|いみ}が{最|もっと}も{近|ちか}いものを、１・２・３・４から{一|ひと}つえらびなさい。',
        '用法': 'つぎのことばの{使|つか}い{方|かた}として{最|もっと}もよいものを、１・２・３・４から{一|ひと}つえらびなさい。',
        '文法形式の判断': 'つぎの{文|ぶん}の（　　）に{入|い}れるのに{最|もっと}もよいものを、１・２・３・４から{一|ひと}つえらびなさい。',
        '文の組み立て': 'つぎの{文|ぶん}の★に{入|はい}る{最|もっと}もよいものを、１・２・３・４から{一|ひと}つえらびなさい。',
        '文章の文法': 'つぎの{文章|ぶんしょう}を{読|よ}んで、{文章|ぶんしょう}{全体|ぜんたい}の{内容|ないよう}を{考|かんが}えて、［　］の{中|なか}に{入|はい}る{最|もっと}もよいものを、１・２・３・４から{一|ひと}つえらびなさい。',
        '内容理解（短文）': 'つぎの{文章|ぶんしょう}を{読|よ}んで、{質問|しつもん}に{答|こた}えなさい。{答|こた}えは、１・２・３・４から{最|もっと}もよいものを{一|ひと}つえらびなさい。',
        '内容理解（中文）': 'つぎの{文章|ぶんしょう}を{読|よ}んで、{質問|しつもん}に{答|こた}えなさい。{答|こた}えは、１・２・３・４から{最|もっと}もよいものを{一|ひと}つえらびなさい。',
        '内容理解（長文）': 'つぎの{文章|ぶんしょう}を{読|よ}んで、{質問|しつもん}に{答|こた}えなさい。{答|こた}えは、１・２・３・４から{最|もっと}もよいものを{一|ひと}つえらびなさい。',
        '統合理解': 'つぎのAとBの{文章|ぶんしょう}を{読|よ}んで、{質問|しつもん}に{答|こた}えなさい。{答|こた}えは、１・２・３・４から{最|もっと}もよいものを{一|ひと}つえらびなさい。',
        '主張理解（長文）': 'つぎの{文章|ぶんしょう}を{読|よ}んで、{質問|しつもん}に{答|こた}えなさい。{答|こた}えは、１・２・３・４から{最|もっと}もよいものを{一|ひと}つえらびなさい。',
        '情報検索': 'つぎの{案内|あんない}を{読|よ}んで、{質問|しつもん}に{答|こた}えなさい。{答|こた}えは、１・２・３・４から{最|もっと}もよいものを{一|ひと}つえらびなさい。',
        '課題理解': 'まず{質問|しつもん}を{聞|き}いてください。それから{話|はなし}を{聞|き}いて、１から４の{中|なか}から、{最|もっと}もよいものを{一|ひと}つえらんでください。',
        'ポイント理解': 'まず{質問|しつもん}を{聞|き}いてください。そのあと、せんたくしを{読|よ}んでください。それから{話|はなし}を{聞|き}いて、１から４の{中|なか}から、{最|もっと}もよいものを{一|ひと}つえらんでください。',
        '概要理解': '{話|はなし}の{前|まえ}に{質問|しつもん}はありません。まず{話|はなし}を{聞|き}いてください。それから、{質問|しつもん}とせんたくしを{聞|き}いて、１から４の{中|なか}から、{最|もっと}もよいものを{一|ひと}つえらんでください。',
        '発話表現': '{場面|ばめん}の{文|ぶん}を{読|よ}みながら{質問|しつもん}を{聞|き}いてください。その{人|ひと}は{何|なん}と{言|い}いますか。１から３の{中|なか}から、{最|もっと}もよいものを{一|ひと}つえらんでください。（{本番|ほんばん}では{絵|え}を{見|み}ます）',
        '即時応答': 'まず{文|ぶん}を{聞|き}いてください。それから、その{返事|へんじ}を{聞|き}いて、１から３の{中|なか}から、{最|もっと}もよいものを{一|ひと}つえらんでください。'
    };

    /* 聴解：何回でも聞ける再生ボタン（練習・模試の見直しで使う。速さはマイページの設定） */
    function userSpeed() {
        var s = ((state.profile || {}).user || {}).settings || {};
        return Number(s.speed) || 1;
    }
    function listenBox(q) {
        var speed = userSpeed();
        if (q.audio) {
            var audio = h('audio', { controls: true, preload: 'auto', src: 'audio/' + encodeURIComponent(q.audio), class: 'quiz-audio' });
            var setRate = function () { try { audio.playbackRate = speed; } catch (e) { /* 対応していないブラウザ */ } };
            audio.addEventListener('loadedmetadata', setRate);
            audio.addEventListener('play', setRate);
            var miss = h('p', { class: 'note', hidden: true, html: '{音声|おんせい}を{読|よ}み{込|こ}めませんでした。' });
            audio.addEventListener('error', function () { miss.hidden = false; });
            return h('div', { class: 'quiz-audio-box' }, [audio, miss]);
        }
        var L = window.RListen;
        var box = h('div', { class: 'listen-box' });
        if (!L || !L.can) {
            box.append(h('p', { class: 'note', html: 'この{端末|たんまつ}では{音声|おんせい}の{読|よ}み{上|あ}げが{使|つか}えません。Chrome や Safari で{開|ひら}いてください。' }));
            return box;
        }
        var ctl = null;
        function draw(playing) {
            box.replaceChildren(
                h('button', {
                    type: 'button', class: 'pop-btn ' + (playing ? 'btn-white' : 'btn-pink') + ' btn-block listen-btn',
                    onclick: playing ? stopIt : startIt
                }, [icon('i-sound'), h('span', { html: playing ? '{止|と}める' : '{音声|おんせい}を{聞|き}く' })]),
                playing
                    ? h('div', { class: 'quiz-bar listen-bar' }, [h('span', { style: 'width:0%' })])
                    : h('p', { class: 'note', html: '{何回|なんかい}でも{聞|き}けます（{速|はや}さ ' + speed + '{倍|ばい}・マイページで{変|か}えられます）' })
            );
        }
        function startIt() {
            draw(true);
            var bar = box.querySelector('.listen-bar span');
            ctl = L.playQuestion(q, {
                rate: speed,
                onProgress: function (f) { if (bar) bar.style.width = Math.round(f * 100) + '%'; },
                onEnd: function () { ctl = null; if (box.isConnected) draw(false); }
            });
        }
        function stopIt() { if (ctl) ctl.stop(); ctl = null; draw(false); }
        draw(false);
        return box;
    }

    /* ほかのページ（js/practice.js など）から使う道具 */
    window.RApp = {
        studyLevel: studyLevel, setStudyLevel: setStudyLevel, chooseLevel: chooseLevel, levelBar: levelBar, askLevelIfNeeded: askLevelIfNeeded,
        goalBadge: goalBadge, stageNote: stageNote, stagePill: stagePill,
        listenBox: listenBox, registerDrain: registerDrain, afterSaves: afterSaves, makeDrain: makeDrain,
        state: state, h: h, fg: fg, icon: icon, sticker: sticker, FORM_GUIDE: FORM_GUIDE, toast: toast, confirmBox: confirmBox,
        apiPost: apiPost, withLoading: withLoading, authFailed: authFailed, setTitle: function (t) { $('topTitle').innerHTML = fg(t); }
    };

    document.addEventListener('DOMContentLoaded', start);
})();
