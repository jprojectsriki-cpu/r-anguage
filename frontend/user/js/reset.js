/* R-anguage パスワード再設定ページ
 * - reset.html               … メールアドレスを入力して、再設定メールを送る
 * - reset.html?token=○○     … メールのリンクから開いたとき。新しいパスワードを設定する
 * - ふりがな ON/OFF（LP・ログインページと同じ設定を共有）
 */
(function () {
    'use strict';

    var CONFIG = window.RANGUAGE_CONFIG || {};
    var TOKEN_KEY = 'ranguage_token';
    var FURIGANA_KEY = 'ranguage_furigana';
    var CARDS = ['requestCard', 'sentCard', 'newCard', 'doneCard', 'invalidCard'];
    var Loader = window.RLoading || { show: function () {}, hide: function () { return Promise.resolve(); } };

    var resetToken = '';

    function $(id) { return document.getElementById(id); }
    function apiReady() { return /^https:\/\//.test(CONFIG.API_URL || ''); }

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
    function withLoading(text, promise) {
        Loader.show(text);
        return promise.then(
            function (res) { return Loader.hide().then(function () { return res; }); },
            function (err) { return Loader.hide().then(function () { throw err; }); }
        );
    }
    function setMsg(id, text, isError) {
        var el = $(id);
        el.textContent = text || '';
        el.classList.toggle('is-error', !!isError);
    }
    function show(id) {
        CARDS.forEach(function (c) { $(c).hidden = c !== id; });
        window.scrollTo(0, 0);
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

    /* ---------- ① メールアドレスを入力して送る ---------- */
    function initRequest() {
        var form = $('requestForm');
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var input = form.elements.email;
            var email = input.value.trim();
            if (!email || !input.checkValidity()) return setMsg('requestMsg', 'メールアドレスを確認してください。', true);
            if (!apiReady()) return setMsg('requestMsg', 'ただいまお手続きできません。時間をおいてお試しください。', true);

            var btn = form.querySelector('button[type="submit"]');
            btn.disabled = true;
            setMsg('requestMsg', '');
            withLoading('メールを送っています', apiPost({ action: 'resetRequest', email: email }))
                .then(function (res) {
                    if (res && res.ok) {
                        form.reset();
                        show('sentCard');
                    } else {
                        setMsg('requestMsg', (res && res.message) || 'お手続きできませんでした。', true);
                    }
                })
                .catch(function (err) {
                    console.error(err);
                    setMsg('requestMsg', '通信に失敗しました。時間をおいてもう一度お試しください。', true);
                })
                .then(function () { btn.disabled = false; });
        });

        $('againBtn').addEventListener('click', function () {
            setMsg('requestMsg', '');
            show('requestCard');
            form.elements.email.focus();
        });
    }

    /* ---------- ③ 新しいパスワードを設定する ---------- */
    function initNewPassword() {
        var form = $('newForm');

        form.querySelectorAll('[data-pw-toggle]').forEach(function (b) {
            b.addEventListener('click', function () {
                var input = b.parentNode.querySelector('input');
                var visible = input.type === 'password';
                input.type = visible ? 'text' : 'password';
                b.setAttribute('aria-pressed', String(visible));
            });
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var pw = form.elements.password.value;
            var pw2 = form.elements.passwordConfirm.value;
            if (pw.length < 8 || pw.length > 64) return setMsg('newMsg', 'パスワードは8〜64文字で入力してください。', true);
            if (pw !== pw2) return setMsg('newMsg', 'パスワード（確認）が一致しません。', true);

            var btn = form.querySelector('button[type="submit"]');
            btn.disabled = true;
            setMsg('newMsg', '');
            withLoading('パスワードを変更しています', apiPost({ action: 'resetPassword', token: resetToken, password: pw }))
                .then(function (res) {
                    if (res && res.ok) {
                        form.reset();
                        resetToken = '';
                        // この端末のログイン情報も消す（GAS側で、ログイン中の端末はすべてログアウトしている）
                        try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* 無視 */ }
                        show('doneCard');
                    } else if (res && res.reason === 'invalid') {
                        show('invalidCard');
                    } else {
                        setMsg('newMsg', (res && res.message) || 'パスワードを変更できませんでした。', true);
                    }
                })
                .catch(function (err) {
                    console.error(err);
                    setMsg('newMsg', '通信に失敗しました。時間をおいてもう一度お試しください。', true);
                })
                .then(function () { btn.disabled = false; });
        });
    }

    /* ---------- 開いたとき ---------- */
    function start() {
        var params = new URLSearchParams(location.search);
        resetToken = params.get('token') || '';

        if (!resetToken) { show('requestCard'); return; }

        if (!apiReady()) { show('invalidCard'); return; }
        withLoading('リンクを確認しています', apiPost({ action: 'resetCheck', token: resetToken }))
            .then(function (res) {
                // アドレスバーや履歴にリンクの文字列が残らないように、URLから消しておく
                try { history.replaceState(null, '', location.pathname); } catch (e) { /* 無視 */ }
                if (res && res.ok) {
                    $('maskedEmail').textContent = res.email || '';
                    show('newCard');
                    $('newForm').elements.password.focus();
                } else {
                    show('invalidCard');
                }
            })
            .catch(function (err) {
                // 通信の失敗のときは、URLを残したままにする（読み込み直せば、もう一度確認できる）
                console.error(err);
                $('invalidTitle').textContent = '通信に失敗しました';
                $('invalidLead').textContent = 'インターネットの接続を確認してから、このページを読み込み直してください（ブラウザの再読み込みボタンを押してください）。';
                show('invalidCard');
            });
    }

    document.addEventListener('DOMContentLoaded', function () {
        initFurigana();
        initRequest();
        initNewPassword();
        start();
    });
})();
