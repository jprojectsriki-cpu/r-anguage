/* R-anguage LP
 * - ふりがな ON/OFF・スマホメニュー・スクロール表示
 * - 体験デモ（単語カード・クイズ・聴解プレーヤー）
 * - モーダル（お申し込み・ログイン・規約など）
 *   ※ お申し込み・ログインはバックエンド接続前のため「準備中」を表示する
 */
(function () {
    'use strict';

    var FURIGANA_KEY = 'ranguage_furigana';
    var CONFIG = window.RANGUAGE_CONFIG || {};

    // ふりがな付きの文字列を作る小さなヘルパー（データは固定の文字列のみ）
    function r(kanji, yomi) { return '<ruby>' + kanji + '<rt>' + yomi + '</rt></ruby>'; }

    /* ---------- ふりがな ---------- */
    function initFurigana() {
        var root = document.documentElement;
        var sw = document.getElementById('furiganaSwitch');
        if (!sw) return;
        function apply(on) {
            root.classList.toggle('furigana-off', !on);
            sw.setAttribute('aria-checked', String(on));
        }
        apply(!root.classList.contains('furigana-off'));
        sw.addEventListener('click', function () {
            var on = sw.getAttribute('aria-checked') !== 'true';
            apply(on);
            try { localStorage.setItem(FURIGANA_KEY, on ? 'on' : 'off'); } catch (e) { /* 保存できなくても表示は切り替わる */ }
        });
    }

    /* ---------- スマホメニュー ---------- */
    function initMenu() {
        var btn = document.getElementById('menuBtn');
        var menu = document.getElementById('mobileMenu');
        if (!btn || !menu) return;
        function setOpen(open) {
            menu.hidden = !open;
            btn.setAttribute('aria-expanded', String(open));
            btn.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
        }
        btn.addEventListener('click', function () { setOpen(menu.hidden); });
        menu.addEventListener('click', function (e) { if (e.target.closest('a, button')) setOpen(false); });
        window.addEventListener('resize', function () { if (window.innerWidth > 1100) setOpen(false); });
    }

    /* ---------- スクロール表示 ---------- */
    function initReveal() {
        var items = document.querySelectorAll('.reveal');
        if (!('IntersectionObserver' in window)) {
            items.forEach(function (el) { el.classList.add('active'); });
            return;
        }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
        items.forEach(function (el) { io.observe(el); });
    }

    /* ---------- 料金プラン：横並び・スライド ---------- */
    function initPlanSlider() {
        var grid = document.querySelector('.pricing-grid');
        if (!grid) return;
        var cards = Array.prototype.slice.call(grid.querySelectorAll('.plan'));
        if (!cards.length) return;
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var behavior = reduce ? 'auto' : 'smooth';

        // 横並びのスライダーに組み替える（HTMLは変更不要）
        var wrap = document.createElement('div');
        wrap.className = 'plan-slider reveal';
        grid.parentNode.insertBefore(wrap, grid);
        wrap.appendChild(grid);
        grid.classList.remove('grid-4');
        grid.classList.add('plan-track');
        grid.setAttribute('tabindex', '0');
        grid.setAttribute('role', 'region');
        grid.setAttribute('aria-label', '料金プラン（左右にスライドできます）');
        cards.forEach(function (card) { card.classList.remove('reveal', 'reveal-flip'); });

        // 矢印ボタンとドット
        function makeNav(cls, label, icon) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'plan-nav ' + cls;
            b.setAttribute('aria-label', label);
            b.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#' + icon + '"/></svg>';
            return b;
        }
        var prev = makeNav('plan-prev', '前のプラン', 'i-arrow-left');
        var next = makeNav('plan-next', '次のプラン', 'i-arrow-right');
        var dotsBox = document.createElement('div');
        dotsBox.className = 'plan-dots';
        var dots = cards.map(function (card, i) {
            var d = document.createElement('button');
            d.type = 'button';
            d.className = 'plan-dot';
            d.setAttribute('aria-label', (card.getAttribute('data-level') || ('プラン' + (i + 1))) + 'プランを表示');
            d.addEventListener('click', function () { goTo(i); });
            dotsBox.appendChild(d);
            return d;
        });
        var controls = document.createElement('div');
        controls.className = 'plan-controls';
        controls.appendChild(prev);
        controls.appendChild(dotsBox);
        controls.appendChild(next);
        wrap.appendChild(controls);

        function padLeft() { return parseFloat(window.getComputedStyle(grid).paddingLeft) || 0; }
        function step() { return cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : grid.clientWidth; }
        function maxScroll() { return grid.scrollWidth - grid.clientWidth; }
        function goTo(i) {
            grid.scrollTo({ left: Math.max(0, cards[i].offsetLeft - padLeft()), behavior: behavior });
        }
        prev.addEventListener('click', function () { grid.scrollBy({ left: -step(), behavior: behavior }); });
        next.addEventListener('click', function () { grid.scrollBy({ left: step(), behavior: behavior }); });

        // 表示中のカードに合わせて、ドットと矢印の状態を更新する
        function update() {
            var t = grid.getBoundingClientRect();
            cards.forEach(function (card, i) {
                var r = card.getBoundingClientRect();
                var overlap = Math.min(r.right, t.right) - Math.max(r.left, t.left);
                var on = overlap >= r.width * 0.6;
                dots[i].classList.toggle('is-active', on);
                if (on) dots[i].setAttribute('aria-current', 'true'); else dots[i].removeAttribute('aria-current');
            });
            prev.disabled = grid.scrollLeft <= 2;
            next.disabled = grid.scrollLeft >= maxScroll() - 2;
        }
        var queued = false;
        function queue() { if (!queued) { queued = true; window.requestAnimationFrame(function () { queued = false; update(); }); } }
        grid.addEventListener('scroll', queue, { passive: true });
        window.addEventListener('resize', queue);
        update();
    }

    /* ---------- スマホ：3つのバッジを横に流す ---------- */
    function initBadgeMarquee() {
        var list = document.querySelector('.trust-badges');
        if (!list || !window.matchMedia) return;
        var mq = window.matchMedia('(max-width: 600px)');
        var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var SPEED = 40; // 1秒あたりに流れる距離(px)
        var originals = Array.prototype.slice.call(list.children);
        var clones = [];
        var raf = null, last = 0, pos = 0, holding = false, resumeTimer = null;
        var dragX = null, startLeft = 0;

        // 途切れず繰り返すため、同じ内容を2セット後ろに足す
        function setup() {
            for (var n = 0; n < 2; n++) {
                originals.forEach(function (li) {
                    var c = li.cloneNode(true);
                    c.setAttribute('aria-hidden', 'true');
                    list.appendChild(c);
                    clones.push(c);
                });
            }
        }
        function teardown() {
            clones.forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
            clones = [];
        }
        function oneSet() { return clones.length ? clones[0].offsetLeft - originals[0].offsetLeft : 0; }
        function wrap() {
            var w = oneSet();
            if (w <= 0) return;
            while (pos >= w) pos -= w;
            while (pos < 0) pos += w;
        }
        function hold() { holding = true; window.clearTimeout(resumeTimer); }
        function release() {
            window.clearTimeout(resumeTimer);
            resumeTimer = window.setTimeout(function () { pos = list.scrollLeft; holding = false; }, 1500);
        }
        function frame(t) {
            raf = window.requestAnimationFrame(frame);
            var dt = last ? Math.min(t - last, 100) : 0;
            last = t;
            if (holding || dragX !== null) return;
            pos += SPEED * dt / 1000;
            wrap();
            list.scrollLeft = pos;
        }
        function start() {
            if (raf) return;
            setup();
            list.scrollLeft = 0;
            pos = 0;
            holding = false;
            last = 0;
            raf = window.requestAnimationFrame(frame);
        }
        function stop() {
            if (raf) window.cancelAnimationFrame(raf);
            raf = null;
            window.clearTimeout(resumeTimer);
            teardown();
            list.scrollLeft = 0;
        }
        function sync() { if (mq.matches && !reduce) start(); else stop(); }

        // 触れている間は止め、離して少し経ったら再開する
        list.addEventListener('touchstart', hold, { passive: true });
        list.addEventListener('touchend', release, { passive: true });
        list.addEventListener('touchcancel', release, { passive: true });
        list.addEventListener('wheel', function () { hold(); release(); }, { passive: true });
        // マウスのドラッグでも動かせる
        list.addEventListener('mousedown', function (e) { dragX = e.clientX; startLeft = list.scrollLeft; hold(); });
        window.addEventListener('mousemove', function (e) {
            if (dragX === null) return;
            list.scrollLeft = startLeft - (e.clientX - dragX);
        });
        window.addEventListener('mouseup', function () {
            if (dragX === null) return;
            dragX = null;
            release();
        });

        if (mq.addEventListener) mq.addEventListener('change', sync); else mq.addListener(sync);
        sync();
    }

    /* ---------- 背景の3Dオブジェクト（大きなキューブ1つ） ---------- */
    function initBg3d() {
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var SIZE = 340; // キューブの大きさ(px)。位置は lp.css の .o3 の --x / --y で調整

        var layer = document.createElement('div');
        layer.className = 'bg3d';
        layer.setAttribute('aria-hidden', 'true');

        var cube = document.createElement('div');
        cube.className = 'o3';
        cube.style.setProperty('--sz', SIZE + 'px');
        var spin = document.createElement('div');
        spin.className = 'o3-spin';
        spin.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i>';
        cube.appendChild(spin);
        layer.appendChild(cube);
        document.body.insertBefore(layer, document.body.firstChild);
        if (reduce) return;

        // スクロールで回り、マウスでゆるく傾く
        var mx = 0, my = 0, sy = window.pageYOffset || 0, queued = false;
        function update() {
            queued = false;
            var x = mx * 50;
            var y = my * 50 + Math.sin(sy / 500) * 40;
            cube.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)' +
                ' rotateX(' + (my * -20).toFixed(1) + 'deg) rotateY(' + (sy * 0.12).toFixed(1) + 'deg)';
        }
        function queue() { if (!queued) { queued = true; window.requestAnimationFrame(update); } }
        window.addEventListener('scroll', function () { sy = window.pageYOffset; queue(); }, { passive: true });
        window.addEventListener('mousemove', function (e) {
            mx = e.clientX / window.innerWidth - 0.5;
            my = e.clientY / window.innerHeight - 0.5;
            queue();
        }, { passive: true });
        update();
    }

    /* ---------- 単語カード ---------- */
    var POS = '［ ' + r('名詞', 'めいし') + '／する' + r('動詞', 'どうし') + ' ］';
    var CARDS = [
        { kanji: '約束', reading: 'やくそく（yakusoku）', level: 'N4', eng: 'Promise',
          ex: r('友達', 'ともだち') + 'との<u>' + r('約束', 'やくそく') + '</u>を' + r('守', 'まも') + 'る。',
          exPlain: '友達との約束を守る。', exEn: 'Keep a promise with a friend.' },
        { kanji: '感謝', reading: 'かんしゃ（kansha）', level: 'N3', eng: 'Gratitude',
          ex: r('先生', 'せんせい') + 'に' + r('心', 'こころ') + 'から<u>' + r('感謝', 'かんしゃ') + '</u>します。',
          exPlain: '先生に心から感謝します。', exEn: 'I sincerely thank my teacher.' },
        { kanji: '挑戦', reading: 'ちょうせん（chōsen）', level: 'N2', eng: 'Challenge',
          ex: r('新', 'あたら') + 'しい' + r('仕事', 'しごと') + 'に<u>' + r('挑戦', 'ちょうせん') + '</u>する。',
          exPlain: '新しい仕事に挑戦する。', exEn: 'Take on a new job challenge.' },
        { kanji: '把握', reading: 'はあく（haaku）', level: 'N1', eng: 'Grasp',
          ex: r('状況', 'じょうきょう') + 'を' + r('正確', 'せいかく') + 'に<u>' + r('把握', 'はあく') + '</u>する。',
          exPlain: '状況を正確に把握する。', exEn: 'Accurately grasp the situation.' }
    ];

    function initFlashcards() {
        var card = document.getElementById('flashcard');
        var wrap = document.getElementById('flashWrap');
        if (!card || !wrap) return;
        var index = 0;
        var el = function (id) { return document.getElementById(id); };

        function render() {
            var c = CARDS[index];
            card.classList.remove('is-flipped');
            window.setTimeout(function () {
                el('fcId').textContent = 'No.' + (1080 + index);
                el('fcLevel').textContent = 'JLPT ' + c.level;
                el('fcKanji').textContent = c.kanji;
                el('fcReading').textContent = c.reading;
                el('fcPos').innerHTML = POS;
                el('fcEng').textContent = c.eng;
                el('fcEx').innerHTML = c.ex;
                el('fcExEn').textContent = c.exEn;
            }, 150);
        }
        function flip() { card.classList.toggle('is-flipped'); }

        wrap.addEventListener('click', function (e) { if (!e.target.closest('#fcSpeak')) flip(); });
        wrap.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
        });
        el('fcFlip').addEventListener('click', flip);
        el('fcNext').addEventListener('click', function () { index = (index + 1) % CARDS.length; render(); });
        el('fcPrev').addEventListener('click', function () { index = (index - 1 + CARDS.length) % CARDS.length; render(); });
        el('fcSpeak').addEventListener('click', function (e) {
            e.stopPropagation();
            if (!('speechSynthesis' in window)) return;
            var u = new SpeechSynthesisUtterance(CARDS[index].exPlain);
            u.lang = 'ja-JP';
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(u);
        });
        render();
    }

    /* ---------- クイズ ---------- */
    function initQuiz() {
        var box = document.getElementById('quizOptions');
        var fb = document.getElementById('quizFeedback');
        if (!box || !fb) return;
        box.addEventListener('click', function (e) {
            var btn = e.target.closest('.quiz-btn');
            if (!btn) return;
            box.querySelectorAll('.quiz-btn').forEach(function (b) { b.classList.remove('is-correct', 'is-wrong'); });
            var ok = btn.getAttribute('data-correct') === 'true';
            btn.classList.add(ok ? 'is-correct' : 'is-wrong');
            fb.className = 'quiz-feedback ' + (ok ? 'is-correct' : 'is-wrong');
            fb.innerHTML = ok
                ? r('正解', 'せいかい') + '！「〜からには」は「〜のだから、' + r('当然', 'とうぜん') + '」という' + r('意味', 'いみ') + 'です。'
                : r('残念', 'ざんねん') + '！' + r('正解', 'せいかい') + 'は2' + r('番', 'ばん') + 'の「からには」です。';
            fb.hidden = false;
            if (ok && typeof window.confetti === 'function' &&
                !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
                window.confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
            }
        });
    }

    /* ---------- 聴解プレーヤー（見た目だけの再現） ---------- */
    function initPlayer() {
        var play = document.getElementById('audioPlay');
        var bar = document.getElementById('audioBar');
        var timer = document.getElementById('audioTimer');
        var eq = document.getElementById('eq');
        if (!play) return;
        var TOTAL = 35;
        var pos = 8;
        var tick = null;

        function draw() {
            bar.style.width = (pos / TOTAL * 100) + '%';
            timer.textContent = '00:' + String(Math.round(pos)).padStart(2, '0');
        }
        function stop() {
            window.clearInterval(tick);
            tick = null;
            play.classList.remove('is-playing');
            play.setAttribute('aria-label', '再生');
            eq.classList.remove('is-playing');
        }
        play.addEventListener('click', function () {
            if (tick) { stop(); return; }
            if (pos >= TOTAL) pos = 0;
            play.classList.add('is-playing');
            play.setAttribute('aria-label', '一時停止');
            eq.classList.add('is-playing');
            tick = window.setInterval(function () {
                pos = Math.min(TOTAL, pos + 1);
                draw();
                if (pos >= TOTAL) stop();
            }, 1000);
        });
        document.getElementById('audioBack').addEventListener('click', function () { pos = Math.max(0, pos - 5); draw(); });
        document.getElementById('audioFwd').addEventListener('click', function () { pos = Math.min(TOTAL, pos + 5); draw(); });
        draw();
    }

    /* ---------- モーダル ---------- */
    function openDialog(id) {
        var dlg = document.getElementById(id);
        if (!dlg) return;
        if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); }
        else dlg.setAttribute('open', '');
    }
    function closeDialog(dlg) {
        if (!dlg) return;
        if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
    }
    function setMsg(el, text, isError) {
        el.textContent = text;
        el.classList.toggle('is-error', !!isError);
    }

    function initDialogs() {
        document.addEventListener('click', function (e) {
            var apply = e.target.closest('[data-apply]');
            if (apply) {
                var level = apply.getAttribute('data-apply');
                var radio = document.querySelector('#applyForm input[name="level"][value="' + level + '"]');
                if (radio) radio.checked = true;
                setMsg(document.getElementById('applyMsg'), '');
                openDialog('applyDialog');
                return;
            }
            var opener = e.target.closest('[data-open]');
            if (opener) { e.preventDefault(); openDialog(opener.getAttribute('data-open')); return; }
            var closer = e.target.closest('[data-close]');
            if (closer) { closeDialog(closer.closest('dialog')); return; }
            if (e.target.tagName === 'DIALOG') closeDialog(e.target);
        });
    }

    function apiReady() { return /^https:\/\//.test(CONFIG.API_URL || ''); }

    function initForms() {
        var apply = document.getElementById('applyForm');
        if (apply) {
            var msg = document.getElementById('applyMsg');
            apply.addEventListener('submit', function (e) {
                e.preventDefault();
                var fd = new FormData(apply);
                var pw = String(fd.get('password') || '');
                if (!String(fd.get('name') || '').trim()) return setMsg(msg, 'お名前を入力してください。', true);
                if (!apply.elements.email.value || !apply.elements.email.checkValidity()) return setMsg(msg, 'メールアドレスを確認してください。', true);
                if (pw.length < 8) return setMsg(msg, 'パスワードは8文字以上で入力してください。', true);
                if (pw !== String(fd.get('passwordConfirm') || '')) return setMsg(msg, 'パスワード（確認）が一致しません。', true);
                if (!fd.get('agree')) return setMsg(msg, '利用規約とプライバシーポリシーへの同意が必要です。', true);
                if (!apiReady()) return setMsg(msg, '現在、お申し込みの受付を準備中です。公開まで今しばらくお待ちください。');
                // TODO: バックエンド(GAS)へ送信し、Stripe の支払い画面へ移動する
                setMsg(msg, 'お申し込み機能は準備中です。');
            });
        }
        var login = document.getElementById('loginForm');
        if (login) {
            login.addEventListener('submit', function (e) {
                e.preventDefault();
                setMsg(document.getElementById('loginMsg'), 'ログイン機能は準備中です。公開まで今しばらくお待ちください。');
            });
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        initBg3d();
        initFurigana();
        initMenu();
        initPlanSlider(); // initReveal より前に実行する
        initReveal();
        initBadgeMarquee();
        initFlashcards();
        initQuiz();
        initPlayer();
        initDialogs();
        initForms();
    });
})();