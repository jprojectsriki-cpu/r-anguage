/* R-anguage 管理画面
 * - 管理者ログイン（role が admin のときだけ管理画面を表示）
 * - 申込一覧（状態で絞り込み・検索）
 * - 入金を確認して発行
 */
(function () {
    'use strict';

    var CONFIG = window.RANGUAGE_CONFIG || {};
    var TOKEN_KEY = 'ranguage_admin_token';
    var Loader = window.RLoading || { show: function () {}, hide: function () { return Promise.resolve(); } };

    var STATUS_LABELS = {
        awaiting_payment: '入金待ち',
        paid: '入金確認済み',
        issued: '発行済み',
        expired: '期限切れ',
        cancelled: 'キャンセル'
    };
    var PAYMENT_LABELS = { konbini: 'コンビニ払い', bank_transfer: '銀行振込' };

    var state = { applications: [], status: 'awaiting_payment', query: '' };

    function $(id) { return document.getElementById(id); }

    /* ---------- トークンの保存 ---------- */
    function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
    function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 無視 */ } }

    /* ---------- 通信 ---------- */
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

    /* ---------- 表示の切り替え ---------- */
    function showLogin(message, isError) {
        $('appView').hidden = true;
        $('loginView').hidden = false;
        var msg = $('loginMsg');
        msg.textContent = message || '';
        msg.classList.toggle('is-error', !!isError);
    }
    function showApp(user) {
        $('loginView').hidden = true;
        $('appView').hidden = false;
        $('whoAmI').textContent = user.email + ' でログイン中';
    }
    function notice(text, type) {
        var el = $('notice');
        el.textContent = text;
        el.className = 'notice' + (type ? ' is-' + type : '');
        el.hidden = !text;
    }

    // ログイン切れ・別の端末でのログインなど、管理画面を使えなくなったとき
    function handleAuthError(res) {
        if (res && (res.reason === 'expired' || res.reason === 'replaced' || res.reason === 'forbidden')) {
            setToken('');
            showLogin(res.message, true);
            return true;
        }
        return false;
    }

    /* ---------- 日付の表示 ---------- */
    function fmt(value) {
        if (!value) return '—';
        var d = new Date(value);
        if (isNaN(d)) return '—';
        var p = function (n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    /* ---------- 一覧の描画 ---------- */
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }
    function td(label, cls) {
        var c = el('td', cls);
        c.setAttribute('data-label', label);
        return c;
    }

    function updateCounts() {
        var counts = { '': state.applications.length };
        state.applications.forEach(function (a) { counts[a.status] = (counts[a.status] || 0) + 1; });
        document.querySelectorAll('[data-count]').forEach(function (b) {
            b.textContent = counts[b.getAttribute('data-count')] || 0;
        });
    }

    function render() {
        updateCounts();
        var q = state.query.trim().toLowerCase();
        var list = state.applications.filter(function (a) {
            if (state.status && a.status !== state.status) return false;
            if (!q) return true;
            return (a.applicationId + ' ' + a.name + ' ' + a.email).toLowerCase().indexOf(q) !== -1;
        });

        var tbody = $('appRows');
        tbody.replaceChildren();
        var now = Date.now();

        list.forEach(function (a) {
            var tr = el('tr');

            var c1 = td('申込番号', 'cell-id'); c1.textContent = a.applicationId;
            var c2 = td('申込日時', 'cell-nowrap'); c2.textContent = fmt(a.createdAt);

            var c3 = td('お名前／メール');
            var nameWrap = el('div');
            nameWrap.append(el('span', '', a.name), el('span', 'cell-sub', a.email));
            c3.append(nameWrap);

            var c4 = td('レベル'); c4.append(el('span', 'level-pill lv-' + a.level, a.level));
            var c5 = td('金額', 'cell-nowrap'); c5.textContent = '¥' + Number(a.amount || 0).toLocaleString('ja-JP');
            var c6 = td('お支払い', 'cell-nowrap'); c6.textContent = PAYMENT_LABELS[a.paymentMethod] || a.paymentMethod;

            var c7 = td('支払期限', 'cell-nowrap');
            var limit = el('div');
            limit.append(el('span', '', fmt(a.expiresAt)));
            if (a.status === 'awaiting_payment' && a.expiresAt && new Date(a.expiresAt).getTime() < now) {
                limit.append(el('span', 'overdue', '期限を過ぎています'));
            }
            c7.append(limit);

            var c8 = td('状態');
            c8.append(el('span', 'status st-' + a.status, STATUS_LABELS[a.status] || a.status));
            if (a.status === 'issued') c8.append(el('span', 'cell-sub', '発行 ' + fmt(a.issuedAt)));

            var c9 = td('操作', 'col-action');
            if (a.status === 'awaiting_payment' || a.status === 'paid') {
                var btn = el('button', 'btn btn-pink btn-sm', '発行');
                btn.type = 'button';
                btn.addEventListener('click', function () { confirmIssue(a); });
                c9.append(btn);
            } else {
                c9.textContent = '—';
            }

            tr.append(c1, c2, c3, c4, c5, c6, c7, c8, c9);
            tbody.append(tr);
        });

        $('emptyNote').hidden = list.length > 0;
    }

    /* ---------- 一覧の読み込み ---------- */
    function loadApplications() {
        return withLoading('申込を読み込んでいます', apiPost({ action: 'admin.list', token: getToken() }))
            .then(function (res) {
                if (handleAuthError(res)) return;
                if (!res || !res.ok) { notice((res && res.message) || '一覧を読み込めませんでした。', 'error'); return; }
                state.applications = res.applications || [];
                render();
            })
            .catch(function (err) {
                console.error(err);
                notice('通信に失敗しました。「最新の情報に更新」を押して、もう一度お試しください。', 'error');
            });
    }

    /* ---------- 発行 ---------- */
    function confirmIssue(a) {
        var dl = $('issueDetail');
        dl.replaceChildren();
        [
            ['申込番号', a.applicationId],
            ['お名前', a.name],
            ['メール', a.email],
            ['レベル', a.level],
            ['金額', '¥' + Number(a.amount || 0).toLocaleString('ja-JP')],
            ['お支払い', PAYMENT_LABELS[a.paymentMethod] || a.paymentMethod]
        ].forEach(function (pair) {
            dl.append(el('dt', '', pair[0]), el('dd', '', pair[1]));
        });

        var dlg = $('issueDialog');
        dlg.returnValue = '';
        dlg.onclose = function () {
            if (dlg.returnValue !== 'issue') return;
            issue(a.applicationId);
        };
        dlg.showModal();
    }

    function issue(applicationId) {
        withLoading('アカウントを発行しています', apiPost({ action: 'admin.issue', token: getToken(), applicationId: applicationId }))
            .then(function (res) {
                if (handleAuthError(res)) return;
                if (res && res.ok) {
                    notice(applicationId + ' を発行しました（レベル：' + res.levels.join('、') + '）。発行メールを送信しました。', 'ok');
                    return loadApplications();
                }
                notice((res && res.message) || '発行できませんでした。', 'error');
            })
            .catch(function (err) {
                console.error(err);
                notice('通信に失敗しました。発行されたかどうか、「最新の情報に更新」で確認してください。', 'error');
            });
    }

    /* ---------- ログイン・ログアウト ---------- */
    function initLogin() {
        var form = $('loginForm');
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var email = form.elements.email.value.trim();
            var password = form.elements.password.value;
            if (!email || !password) return showLogin('メールアドレスとパスワードを入力してください。', true);

            withLoading('ログインしています', apiPost({ action: 'login', email: email, password: password }))
                .then(function (res) {
                    if (!res || !res.ok) return showLogin((res && res.message) || 'ログインに失敗しました。', true);
                    if (res.user.role !== 'admin') {
                        // 受講生のアカウントでは管理画面に入れない
                        apiPost({ action: 'logout', token: res.token }).catch(function () {});
                        return showLogin('管理者のアカウントでログインしてください。', true);
                    }
                    setToken(res.token);
                    form.reset();
                    showApp(res.user);
                    return loadApplications();
                })
                .catch(function (err) {
                    console.error(err);
                    showLogin('通信に失敗しました。時間をおいてもう一度お試しください。', true);
                });
        });

        $('logoutBtn').addEventListener('click', function () {
            var token = getToken();
            setToken('');
            state.applications = [];
            showLogin('ログアウトしました。');
            if (token) apiPost({ action: 'logout', token: token }).catch(function () {});
        });
    }

    /* ---------- 絞り込み・検索・更新 ---------- */
    function initToolbar() {
        $('statusTabs').addEventListener('click', function (e) {
            var tab = e.target.closest('.tab');
            if (!tab) return;
            state.status = tab.getAttribute('data-status');
            document.querySelectorAll('#statusTabs .tab').forEach(function (t) {
                t.setAttribute('aria-selected', String(t === tab));
            });
            render();
        });
        $('searchBox').addEventListener('input', function (e) {
            state.query = e.target.value;
            render();
        });
        $('reloadBtn').addEventListener('click', function () {
            notice('');
            loadApplications();
        });
    }

    /* ---------- 起動時：保存されたトークンが使えるか確かめる ---------- */
    function start() {
        if (!/^https:\/\//.test(CONFIG.API_URL || '')) {
            showLogin('API_URL が設定されていません（user/js/config.js）。', true);
            return;
        }
        var token = getToken();
        if (!token) { showLogin(); return; }

        withLoading('確認しています', apiPost({ action: 'me', token: token }))
            .then(function (res) {
                if (!res || !res.ok || res.user.role !== 'admin') {
                    setToken('');
                    showLogin(res && res.reason === 'replaced' ? res.message : '');
                    return;
                }
                showApp(res.user);
                return loadApplications();
            })
            .catch(function (err) {
                console.error(err);
                showLogin('通信に失敗しました。時間をおいてもう一度お試しください。', true);
            });
    }

    document.addEventListener('DOMContentLoaded', function () {
        initLogin();
        initToolbar();
        start();
    });
})();
