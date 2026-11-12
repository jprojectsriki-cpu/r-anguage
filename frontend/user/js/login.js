/* R-ANGUAGE ログインページ
 * - ふりがな ON/OFF（LPと同じ設定を共有）
 * - ログイン（成功したらトークンを保存）
 * - すでにログイン中なら、その状態を表示
 * - 「?reason=replaced」「?reason=expired」付きで開かれたら、理由を表示
 */
(function () {
    'use strict';

    var CONFIG = window.RANGUAGE_CONFIG || {};
    var TOKEN_KEY = 'ranguage_token';
    var FURIGANA_KEY = 'ranguage_furigana';
    var Loader = window.RLoading || { show: function () {}, hide: function () { return Promise.resolve(); } };

    function $(id) { return document.getElementById(id); }
    function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
    function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 無視 */ } }

    function apiPost(data) {
        return fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(data)
        }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        });
    }
    function setMsg(text, isError) {
        var el = $('loginMsg');
        el.textContent = text;
        el.classList.toggle('is-error', !!isError);
    }
    function alertBox(text) {
        var el = $('loginAlert');
        el.textContent = text || '';
        el.hidden = !text;
    }

    /* ---------- ふりがな ---------- */
    function initFurigana() {
        var root = document.documentElement;
        var sw = $('furiganaSwitch');
        function apply(on) {
            root.classList.toggle('furigana-off', !on);
            sw.setAttribute('aria-checked', String(on));
        }
        apply(!root.classList.contains('furigana-off'));
        sw.addEventListener('click', function () {
            var on = sw.getAttribute('aria-checked') !== 'true';
            apply(on);
            try { localStorage.setItem(FURIGANA_KEY, on ? 'on' : 'off'); } catch (e) { /* 無視 */ }
        });
    }

    /* ---------- 表示の切り替え ---------- */
    function showLogin() {
        $('doneCard').hidden = true;
        $('loginCard').hidden = false;
    }
    /** ログインできたら、学習の画面（app.html）へ移動する */
    function showDone() {
        location.replace('app.html');
    }

    /* ---------- ログイン ---------- */
    function initForm() {
        var form = $('loginForm');
        var pw = form.elements.password;

        $('pwToggle').addEventListener('click', function () {
            var show = pw.type === 'password';
            pw.type = show ? 'text' : 'password';
            this.setAttribute('aria-pressed', String(show));
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            alertBox('');
            var email = form.elements.email.value.trim();
            var password = pw.value;
            if (!email || !password) return setMsg('メールアドレスとパスワードを入力してください。', true);
            if (!/^https:\/\//.test(CONFIG.API_URL || '')) return setMsg('ただいまログインできません。時間をおいてお試しください。', true);

            var btn = form.querySelector('button[type="submit"]');
            btn.disabled = true;
            setMsg('');
            // ログインできたときは、ローディングの画面を消さずに学習の画面へ移る（ログイン画面が一瞬もどって見えないように）
            Loader.show('ログインしています');
            apiPost({ action: 'login', email: email, password: password })
                .then(function (res) {
                    if (res && res.ok) {
                        setToken(res.token);
                        Loader.show('<ruby>読<rt>よ</rt></ruby>み<ruby>込<rt>こ</rt></ruby>んでいます');
                        showDone(res.user);
                        return;
                    }
                    return Loader.hide().then(function () {
                        setMsg((res && res.message) || 'ログインに失敗しました。', true);
                        btn.disabled = false;
                    });
                })
                .catch(function (err) {
                    console.error(err);
                    return Loader.hide().then(function () {
                        setMsg('通信に失敗しました。時間をおいてもう一度お試しください。', true);
                        btn.disabled = false;
                    });
                });
        });

        $('logoutBtn').addEventListener('click', function () {
            var token = getToken();
            setToken('');
            showLogin();
            setMsg('ログアウトしました。');
            if (token) apiPost({ action: 'logout', token: token }).catch(function () {});
        });
    }

    /* ---------- 開いたとき ---------- */
    function start() {
        // ほかの画面から「別の端末でログインされた」などの理由付きで戻ってきたとき
        var reason = new URLSearchParams(location.search).get('reason');
        if (reason === 'replaced') alertBox('別の端末でログインされたため、ログアウトしました。');
        if (reason === 'expired') alertBox('ログインの有効期限が切れました。もう一度ログインしてください。');

        var token = getToken();
        if (!token || !/^https:\/\//.test(CONFIG.API_URL || '')) { showLogin(); return; }

        // ログインしたままなら、ローディングの画面を消さずに学習の画面へ移る
        Loader.show('ログイン状態を確認しています');
        apiPost({ action: 'me', token: token })
            .then(function (res) {
                if (res && res.ok) { Loader.show('<ruby>読<rt>よ</rt></ruby>み<ruby>込<rt>こ</rt></ruby>んでいます'); showDone(res.user); return; }
                return Loader.hide().then(function () {
                    setToken('');
                    showLogin();
                    if (res && res.reason === 'replaced') alertBox(res.message);
                });
            })
            .catch(function () { return Loader.hide().then(showLogin); });
    }

    document.addEventListener('DOMContentLoaded', function () {
        initFurigana();
        initForm();
        start();
    });
})();
