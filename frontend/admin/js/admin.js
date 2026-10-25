/* R-anguage 管理画面
 * - 管理者ログイン（role が admin のときだけ表示）
 * - ダッシュボード（売上・申込数のグラフ、レベル別の受講生、集計カード）
 * - 申込（発行・キャンセル）
 * - 受講生（停止・再開・レベル追加）
 */
(function () {
    'use strict';

    var CONFIG = window.RANGUAGE_CONFIG || {};
    var TOKEN_KEY = 'ranguage_admin_token';
    var Loader = window.RLoading || { show: function () {}, hide: function () { return Promise.resolve(); } };

    var LEVELS = ['N4', 'N3', 'N2', 'N1'];
    var APP_STATUS = { awaiting_payment: '入金待ち', paid: '入金確認済み', issued: '発行済み', expired: '期限切れ', cancelled: 'キャンセル' };
    var USER_STATUS = { active: '利用中', suspended: '停止中', pending: '入金待ち' };
    var PAYMENT = { konbini: 'コンビニ払い', bank_transfer: '銀行振込' };

    var state = {
        applications: [],
        users: [],
        loadedAt: null,
        appStatus: 'awaiting_payment',
        appQuery: '',
        userStatus: 'active',
        userQuery: ''
    };

    function $(id) { return document.getElementById(id); }

    /* ===================== 共通 ===================== */
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
    function withLoading(text, promise) {
        Loader.show(text);
        return promise.then(
            function (res) { return Loader.hide().then(function () { return res; }); },
            function (err) { return Loader.hide().then(function () { throw err; }); }
        );
    }
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    }
    function td(label, cls) {
        var c = el('td', cls);
        c.setAttribute('data-label', label);
        return c;
    }
    function yen(n) { return '¥' + Number(n || 0).toLocaleString('ja-JP'); }
    function pad(n) { return String(n).padStart(2, '0'); }
    function fmt(value, withTime) {
        if (!value) return '—';
        var d = new Date(value);
        if (isNaN(d)) return '—';
        var s = d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate());
        return withTime === false ? s : s + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    function notice(text, type) {
        var n = $('notice');
        n.textContent = text || '';
        n.className = 'notice' + (type ? ' is-' + type : '');
        n.hidden = !text;
    }
    function isOverdue(a) {
        return a.status === 'awaiting_payment' && a.expiresAt && new Date(a.expiresAt).getTime() < Date.now();
    }

    /* ===================== 表示の切り替え ===================== */
    function showLogin(message, isError) {
        $('appView').hidden = true;
        $('loginView').hidden = false;
        var m = $('loginMsg');
        m.textContent = message || '';
        m.classList.toggle('is-error', !!isError);
    }
    function showApp(user) {
        $('loginView').hidden = true;
        $('appView').hidden = false;
        $('whoAmI').textContent = user.email + ' でログイン中';
    }
    function handleAuthError(res) {
        if (res && (res.reason === 'expired' || res.reason === 'replaced' || res.reason === 'forbidden' || res.reason === 'suspended')) {
            setToken('');
            showLogin(res.message, true);
            return true;
        }
        return false;
    }

    function switchView(name, title) {
        document.querySelectorAll('.view').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== name; });
        document.querySelectorAll('.nav-item').forEach(function (b) {
            var on = b.getAttribute('data-view') === name && (name !== 'soon' || b.getAttribute('data-title') === title);
            if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        });
        if (name === 'soon') $('soonTitle').textContent = title;
        if (name === 'dashboard') renderDashboard(); // 幅が変わっていることがあるので描き直す
        window.scrollTo(0, 0);
    }

    /* ===================== データの読み込み ===================== */
    function loadAll() {
        var token = getToken();
        return withLoading('データを読み込んでいます', Promise.all([
            apiPost({ action: 'admin.list', token: token }),
            apiPost({ action: 'admin.users', token: token })
        ])).then(function (results) {
            var apps = results[0], users = results[1];
            if (handleAuthError(apps) || handleAuthError(users)) return;
            if (!apps.ok || !users.ok) {
                notice((apps.message || users.message) || 'データを読み込めませんでした。', 'error');
                return;
            }
            state.applications = apps.applications || [];
            state.users = users.users || [];
            state.loadedAt = new Date();
            renderAll();
        }).catch(function (err) {
            console.error(err);
            notice('通信に失敗しました。「最新の情報に更新」を押して、もう一度お試しください。', 'error');
        });
    }

    function renderAll() {
        renderDashboard();
        renderApplications();
        renderUsers();
        var waiting = state.applications.filter(function (a) { return a.status === 'awaiting_payment'; }).length;
        var badge = $('navBadgeApps');
        badge.textContent = waiting;
        badge.hidden = waiting === 0;
    }

    /* ===================== ダッシュボード ===================== */
    function lastMonths(n) {
        var now = new Date();
        var list = [];
        for (var i = n - 1; i >= 0; i--) {
            var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            list.push({ key: d.getFullYear() + '-' + pad(d.getMonth() + 1), label: (d.getMonth() + 1) + '月', year: d.getFullYear() });
        }
        return list;
    }
    function monthKey(value) {
        var d = new Date(value);
        return isNaN(d) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1);
    }

    function renderDashboard() {
        if ($('appView').hidden) return;
        var apps = state.applications;
        var users = state.users;
        var months = lastMonths(6);
        var thisKey = months[months.length - 1].key;
        var prevKey = months[months.length - 2].key;

        var issued = apps.filter(function (a) { return a.status === 'issued' && a.issuedAt; });
        var salesBy = {}, countBy = {};
        issued.forEach(function (a) { var k = monthKey(a.issuedAt); salesBy[k] = (salesBy[k] || 0) + Number(a.amount || 0); });
        apps.forEach(function (a) { var k = monthKey(a.createdAt); countBy[k] = (countBy[k] || 0) + 1; });

        // 集計カード
        var thisSales = salesBy[thisKey] || 0;
        var prevSales = salesBy[prevKey] || 0;
        $('kpiSales').textContent = yen(thisSales);
        $('kpiSalesSub').textContent = '先月 ' + yen(prevSales) + '・累計 ' + yen(issued.reduce(function (s, a) { return s + Number(a.amount || 0); }, 0));

        var waiting = apps.filter(function (a) { return a.status === 'awaiting_payment'; });
        var overdue = waiting.filter(isOverdue);
        setCount('kpiWaiting', waiting.length, '件');
        $('kpiWaitingSub').textContent = waiting.length ? '合計 ' + yen(waiting.reduce(function (s, a) { return s + Number(a.amount || 0); }, 0)) + ' の入金待ち' : '入金待ちはありません';
        setCount('kpiOverdue', overdue.length, '件');
        $('kpiOverdueCard').classList.toggle('has-items', overdue.length > 0);

        var active = users.filter(function (u) { return u.status === 'active'; });
        setCount('kpiUsers', active.length, '人');
        var suspended = users.filter(function (u) { return u.status === 'suspended'; }).length;
        $('kpiUsersSub').textContent = '停止中 ' + suspended + '人・入金待ち ' + users.filter(function (u) { return u.status === 'pending'; }).length + '人';

        $('dashUpdated').textContent = state.loadedAt ? fmt(state.loadedAt) + ' 時点' : '';

        // グラフ
        renderColumns($('salesChart'), months.map(function (m) { return { label: m.label, sub: m.year + '年', value: salesBy[m.key] || 0 }; }), yen, '売上');
        renderColumns($('appsChart'), months.map(function (m) { return { label: m.label, sub: m.year + '年', value: countBy[m.key] || 0 }; }), function (v) { return v + '件'; }, '申込数');
        renderTable($('salesTable'), months, salesBy, '売上', yen);
        renderTable($('appsTable'), months, countBy, '申込数', function (v) { return v + '件'; });
        renderLevelBars(active);
    }

    function setCount(id, n, unit) {
        var p = $(id);
        p.textContent = n;
        p.append(el('small', '', unit));
    }

    /* 縦棒グラフ（SVG）：1系列、6本、ホバーで値を表示 */
    function renderColumns(box, data, format, seriesName) {
        box.replaceChildren();
        var W = Math.max(280, box.clientWidth || 600);
        var H = 220;
        var m = { top: 22, right: 8, bottom: 40, left: 56 };
        var iw = W - m.left - m.right;
        var ih = H - m.top - m.bottom;
        var max = Math.max.apply(null, data.map(function (d) { return d.value; }));
        var ticks = niceTicks(max);
        var top = ticks[ticks.length - 1] || 1;
        var band = iw / data.length;
        var bw = Math.min(24, band * 0.55);
        var NS = 'http://www.w3.org/2000/svg';

        function s(tag, attrs) {
            var n = document.createElementNS(NS, tag);
            Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
            return n;
        }

        var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': seriesName + 'の月別グラフ' });

        // 目盛り線と左の数値
        var grid = s('g', { class: 'grid' });
        var axis = s('g', { class: 'axis' });
        ticks.forEach(function (t) {
            var y = m.top + ih - (t / top) * ih;
            grid.append(s('line', { x1: m.left, x2: W - m.right, y1: y, y2: y }));
            var tx = s('text', { x: m.left - 8, y: y + 4, 'text-anchor': 'end' });
            tx.textContent = compact(t, format);
            axis.append(tx);
        });
        svg.append(grid);

        data.forEach(function (d, i) {
            var cx = m.left + band * i + band / 2;
            var h = d.value > 0 ? Math.max(2, (d.value / top) * ih) : 0;
            var x = cx - bw / 2;
            var y = m.top + ih - h;
            var g = s('g', { class: 'col' });

            // ホバー用の当たり判定（棒より大きく、帯全体）
            var hit = s('rect', { class: 'hit', x: m.left + band * i, y: m.top, width: band, height: ih, tabindex: '0', 'aria-label': d.sub + d.label + '：' + format(d.value) });
            g.append(hit);
            if (h > 0) {
                var r = Math.min(4, h, bw / 2);
                // 上の角だけ4pxの丸み、下（基準線側）は四角
                var path = 'M' + x + ',' + (m.top + ih) +
                    ' V' + (y + r) +
                    ' Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
                    ' H' + (x + bw - r) +
                    ' Q' + (x + bw) + ',' + y + ' ' + (x + bw) + ',' + (y + r) +
                    ' V' + (m.top + ih) + ' Z';
                g.append(s('path', { class: 'bar', d: path }));
            }
            var lb = s('text', { x: cx, y: H - m.bottom + 18, 'text-anchor': 'middle' });
            lb.textContent = d.label;
            axis.append(lb);

            // 今月の値だけ、棒の上に表示（全部には付けない）
            if (i === data.length - 1) {
                var cap = s('text', { class: 'cap', x: cx, y: y - 6, 'text-anchor': 'middle' });
                cap.textContent = format(d.value);
                g.append(cap);
            }

            function show(e) {
                g.classList.add('is-hover');
                var rect = hit.getBoundingClientRect();
                tooltip(d.sub + d.label, format(d.value), seriesName, e && e.clientX ? e.clientX : rect.left + rect.width / 2, rect.top + (ih - h) * (rect.height / ih));
            }
            function hide() { g.classList.remove('is-hover'); tooltip(); }
            hit.addEventListener('pointermove', show);
            hit.addEventListener('pointerleave', hide);
            hit.addEventListener('focus', show);
            hit.addEventListener('blur', hide);
            svg.append(g);
        });

        // 基準線
        svg.append(s('line', { x1: m.left, x2: W - m.right, y1: m.top + ih, y2: m.top + ih, stroke: 'rgba(30,27,75,0.35)', 'stroke-width': 1 }));
        svg.append(axis);
        box.append(svg);
    }

    function niceTicks(max) {
        if (max <= 0) return [0, 1, 2, 3, 4];
        var raw = max / 4;
        var mag = Math.pow(10, Math.floor(Math.log10(raw)));
        var step = [1, 2, 2.5, 5, 10].map(function (k) { return k * mag; }).filter(function (v) { return v >= raw; })[0];
        if (step < 1) step = 1;
        var list = [];
        for (var v = 0; v <= max + step * 0.001 || list.length < 2; v += step) list.push(Math.round(v));
        if (list[list.length - 1] < max) list.push(list[list.length - 1] + step);
        return list;
    }
    function compact(v, format) {
        var s = format(v);
        if (v >= 10000 && s.indexOf('¥') === 0) return '¥' + (v / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '万';
        return s;
    }

    function tooltip(title, value, series, x, y) {
        var t = $('tooltip');
        if (!title) { t.hidden = true; return; }
        t.replaceChildren(
            el('span', 'tt-value', value),
            (function () { var r = el('span', 'tt-label'); r.append(el('span', 'tt-key'), document.createTextNode(series + '・' + title)); return r; })()
        );
        t.hidden = false;
        var w = t.offsetWidth, h = t.offsetHeight;
        var left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2));
        var top = Math.max(8, y - h - 12);
        t.style.left = left + 'px';
        t.style.top = top + 'px';
    }

    function renderTable(box, months, byKey, label, format) {
        var table = el('table');
        var thead = el('thead');
        var hr = el('tr');
        hr.append(el('th', '', '月'), el('th', '', label));
        thead.append(hr);
        var tbody = el('tbody');
        months.forEach(function (m) {
            var tr = el('tr');
            tr.append(el('td', '', m.year + '年' + m.label), el('td', '', format(byKey[m.key] || 0)));
            tbody.append(tr);
        });
        table.append(thead, tbody);
        box.replaceChildren(table);
    }

    /* レベル別の受講生（横棒） */
    function renderLevelBars(activeUsers) {
        var counts = {};
        LEVELS.forEach(function (lv) { counts[lv] = 0; });
        activeUsers.forEach(function (u) { (u.levels || []).forEach(function (lv) { if (counts[lv] !== undefined) counts[lv]++; }); });
        var max = Math.max(1, Math.max.apply(null, LEVELS.map(function (lv) { return counts[lv]; })));
        var box = $('levelChart');
        box.replaceChildren();
        LEVELS.forEach(function (lv) {
            var row = el('div', 'hbar');
            var track = el('div', 'hbar-track');
            var fill = el('div', 'hbar-fill');
            fill.style.width = (counts[lv] / max * 100) + '%';
            if (!counts[lv]) fill.style.minWidth = '0';
            track.append(fill);
            row.append(el('span', 'hbar-label', lv), track, el('span', 'hbar-value', counts[lv] + '人'));
            box.append(row);
        });
    }

    /* ===================== 申込 ===================== */
    function renderApplications() {
        var counts = { '': state.applications.length };
        state.applications.forEach(function (a) { counts[a.status] = (counts[a.status] || 0) + 1; });
        document.querySelectorAll('[data-count]').forEach(function (b) { b.textContent = counts[b.getAttribute('data-count')] || 0; });

        var q = state.appQuery.trim().toLowerCase();
        var list = state.applications.filter(function (a) {
            if (state.appStatus && a.status !== state.appStatus) return false;
            return !q || (a.applicationId + ' ' + a.name + ' ' + a.email).toLowerCase().indexOf(q) !== -1;
        });

        var tbody = $('appRows');
        tbody.replaceChildren();
        list.forEach(function (a) {
            var tr = el('tr');
            var c1 = td('申込番号', 'cell-id'); c1.textContent = a.applicationId;
            var c2 = td('申込日時', 'cell-nowrap'); c2.textContent = fmt(a.createdAt);
            var c3 = td('お名前／メール');
            var w = el('div'); w.append(el('span', '', a.name), el('span', 'cell-sub', a.email)); c3.append(w);
            var c4 = td('レベル'); c4.append(el('span', 'level-pill lv-' + a.level, a.level));
            var c5 = td('金額', 'cell-nowrap'); c5.textContent = yen(a.amount);
            var c6 = td('お支払い', 'cell-nowrap'); c6.textContent = PAYMENT[a.paymentMethod] || a.paymentMethod;
            var c7 = td('支払期限', 'cell-nowrap');
            var lim = el('div'); lim.append(el('span', '', fmt(a.expiresAt)));
            if (isOverdue(a)) lim.append(el('span', 'overdue', '期限を過ぎています'));
            c7.append(lim);
            var c8 = td('状態');
            var st = el('div'); st.append(el('span', 'status st-' + a.status, APP_STATUS[a.status] || a.status));
            if (a.status === 'issued') st.append(el('span', 'cell-sub', '発行 ' + fmt(a.issuedAt)));
            if (a.note) st.append(el('span', 'note-text', a.note));
            c8.append(st);

            var c9 = td('操作', 'col-action');
            if (a.status === 'awaiting_payment' || a.status === 'paid') {
                var acts = el('div', 'actions');
                acts.append(
                    button('発行', 'btn btn-pink btn-xs', function () { issueApplication(a); }),
                    button('キャンセル', 'btn btn-white btn-xs', function () { cancelApplication(a); })
                );
                c9.append(acts);
            } else {
                c9.textContent = '—';
            }
            tr.append(c1, c2, c3, c4, c5, c6, c7, c8, c9);
            tbody.append(tr);
        });
        $('appEmpty').hidden = list.length > 0;
    }

    function button(text, cls, onClick) {
        var b = el('button', cls, text);
        b.type = 'button';
        b.addEventListener('click', onClick);
        return b;
    }

    function appRows(a) {
        return [['申込番号', a.applicationId], ['お名前', a.name], ['メール', a.email], ['レベル', a.level], ['金額', yen(a.amount)], ['お支払い', PAYMENT[a.paymentMethod] || a.paymentMethod]];
    }

    function issueApplication(a) {
        confirmAction({
            title: 'この申込を発行しますか？',
            rows: appRows(a),
            text: '入金を確認してから発行してください。発行すると、アカウントが有効になり、受講生に発行メールが送られます。',
            ok: '入金を確認して発行する'
        }).then(function (r) {
            if (!r) return;
            runAction('アカウントを発行しています', { action: 'admin.issue', applicationId: a.applicationId }, function (res) {
                return a.applicationId + ' を発行しました（レベル：' + res.levels.join('、') + '）。発行メールを送信しました。';
            });
        });
    }

    function cancelApplication(a) {
        confirmAction({
            title: 'この申込をキャンセルしますか？',
            rows: appRows(a),
            note: { label: 'キャンセルの理由・返金のメモ（申込に記録されます）' },
            text: 'キャンセルしても、受講生にメールは送られません。必要に応じて、別途ご連絡ください。',
            ok: 'キャンセルする'
        }).then(function (r) {
            if (!r) return;
            runAction('キャンセルしています', { action: 'admin.cancel', applicationId: a.applicationId, note: r.note }, function () {
                return a.applicationId + ' をキャンセルしました。';
            });
        });
    }

    /* ===================== 受講生 ===================== */
    function renderUsers() {
        var counts = { '': state.users.length };
        state.users.forEach(function (u) { counts[u.status] = (counts[u.status] || 0) + 1; });
        document.querySelectorAll('[data-ucount]').forEach(function (b) { b.textContent = counts[b.getAttribute('data-ucount')] || 0; });

        var q = state.userQuery.trim().toLowerCase();
        var list = state.users.filter(function (u) {
            if (state.userStatus && u.status !== state.userStatus) return false;
            return !q || (u.name + ' ' + u.email).toLowerCase().indexOf(q) !== -1;
        });
        list.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });

        var tbody = $('userRows');
        tbody.replaceChildren();
        list.forEach(function (u) {
            var tr = el('tr');
            var c1 = td('お名前／メール');
            var w = el('div'); w.append(el('span', '', u.name), el('span', 'cell-sub', u.email)); c1.append(w);
            var c2 = td('状態'); c2.append(el('span', 'status st-' + u.status, USER_STATUS[u.status] || u.status));
            var c3 = td('レベル');
            var lv = el('div');
            (u.levels || []).forEach(function (l) { lv.append(el('span', 'level-pill lv-' + l, l)); });
            if (!(u.levels || []).length) lv.textContent = '—';
            c3.append(lv);
            var c4 = td('登録日', 'cell-nowrap'); c4.textContent = fmt(u.createdAt, false);
            var c5 = td('最終ログイン', 'cell-nowrap'); c5.textContent = fmt(u.lastLoginAt);

            var c6 = td('操作', 'col-action');
            if (u.status === 'pending') {
                c6.append(el('span', 'cell-sub', '申込から発行してください'));
            } else {
                var acts = el('div', 'actions');
                var missing = LEVELS.filter(function (l) { return (u.levels || []).indexOf(l) === -1; });
                if (missing.length) acts.append(button('レベル追加', 'btn btn-white btn-xs', function () { addLevel(u, missing); }));
                if (u.status === 'active') acts.append(button('停止', 'btn btn-white btn-xs', function () { setUserStatus(u, 'suspended'); }));
                if (u.status === 'suspended') acts.append(button('再開', 'btn btn-pink btn-xs', function () { setUserStatus(u, 'active'); }));
                c6.append(acts);
            }
            tr.append(c1, c2, c3, c4, c5, c6);
            tbody.append(tr);
        });
        $('userEmpty').hidden = list.length > 0;
    }

    function userRows(u) {
        return [['お名前', u.name], ['メール', u.email], ['レベル', (u.levels || []).join('、') || '—'], ['状態', USER_STATUS[u.status] || u.status]];
    }

    function setUserStatus(u, status) {
        var stop = status === 'suspended';
        confirmAction({
            title: stop ? 'このアカウントを停止しますか？' : 'このアカウントを再開しますか？',
            rows: userRows(u),
            text: stop ? '停止すると、この受講生はログインできなくなり、ログイン中の端末もその場でログアウトされます。' : '再開すると、この受講生はまたログインできるようになります。',
            ok: stop ? '停止する' : '再開する'
        }).then(function (r) {
            if (!r) return;
            runAction(stop ? '停止しています' : '再開しています', { action: 'admin.userStatus', userId: u.userId, status: status }, function () {
                return u.name + ' さんのアカウントを' + (stop ? '停止' : '再開') + 'しました。';
            });
        });
    }

    function addLevel(u, missing) {
        confirmAction({
            title: 'レベルを追加しますか？',
            rows: userRows(u),
            levels: missing,
            text: '申込なしでレベルを追加します（料金は発生しません）。受講生にメールは送られません。',
            ok: '追加する'
        }).then(function (r) {
            if (!r) return;
            runAction('レベルを追加しています', { action: 'admin.addLevel', userId: u.userId, level: r.level }, function (res) {
                return u.name + ' さんに ' + r.level + ' を追加しました（' + res.levels.join('、') + '）。';
            });
        });
    }

    /* ===================== 確認ダイアログと実行 ===================== */
    function confirmAction(opt) {
        return new Promise(function (resolve) {
            var dlg = $('confirmDialog');
            $('confirmTitle').textContent = opt.title;
            var dl = $('confirmDetail');
            dl.replaceChildren();
            (opt.rows || []).forEach(function (p) { dl.append(el('dt', '', p[0]), el('dd', '', p[1])); });

            $('confirmNoteField').hidden = !opt.note;
            $('confirmNote').value = '';
            if (opt.note) $('confirmNoteLabel').textContent = opt.note.label;

            $('confirmLevelField').hidden = !opt.levels;
            var sel = $('confirmLevel');
            sel.replaceChildren();
            (opt.levels || []).forEach(function (l) { var o = el('option', '', l); o.value = l; sel.append(o); });

            $('confirmNoteText').textContent = opt.text || '';
            $('confirmOk').textContent = opt.ok;
            dlg.returnValue = '';
            dlg.onclose = function () {
                if (dlg.returnValue !== 'ok') return resolve(null);
                resolve({ note: $('confirmNote').value.trim(), level: sel.value });
            };
            dlg.showModal();
        });
    }

    function runAction(loadingText, payload, successText) {
        payload.token = getToken();
        withLoading(loadingText, apiPost(payload))
            .then(function (res) {
                if (handleAuthError(res)) return;
                if (res && res.ok) {
                    notice(successText(res), 'ok');
                    return loadAll();
                }
                notice((res && res.message) || '処理できませんでした。', 'error');
            })
            .catch(function (err) {
                console.error(err);
                notice('通信に失敗しました。処理されたかどうか、「最新の情報に更新」で確認してください。', 'error');
            });
    }

    /* ===================== ログイン・操作の準備 ===================== */
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
                        apiPost({ action: 'logout', token: res.token }).catch(function () {});
                        return showLogin('管理者のアカウントでログインしてください。', true);
                    }
                    setToken(res.token);
                    form.reset();
                    showApp(res.user);
                    switchView('dashboard');
                    return loadAll();
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
            state.users = [];
            notice('');
            showLogin('ログアウトしました。');
            if (token) apiPost({ action: 'logout', token: token }).catch(function () {});
        });
    }

    function initControls() {
        $('nav').addEventListener('click', function (e) {
            var b = e.target.closest('.nav-item');
            if (b) switchView(b.getAttribute('data-view'), b.getAttribute('data-title'));
        });
        document.querySelectorAll('[data-reload]').forEach(function (b) {
            b.addEventListener('click', function () { notice(''); loadAll(); });
        });
        function tabs(boxId, key, render) {
            $(boxId).addEventListener('click', function (e) {
                var t = e.target.closest('.tab');
                if (!t) return;
                state[key] = t.getAttribute('data-status');
                $(boxId).querySelectorAll('.tab').forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });
                render();
            });
        }
        tabs('appTabs', 'appStatus', renderApplications);
        tabs('userTabs', 'userStatus', renderUsers);
        $('appSearch').addEventListener('input', function (e) { state.appQuery = e.target.value; renderApplications(); });
        $('userSearch').addEventListener('input', function (e) { state.userQuery = e.target.value; renderUsers(); });

        document.querySelectorAll('[data-table-toggle]').forEach(function (b) {
            b.addEventListener('click', function () {
                var t = $(b.getAttribute('data-table-toggle'));
                t.hidden = !t.hidden;
                b.textContent = t.hidden ? '表で見る' : '表を閉じる';
            });
        });

        // 画面の幅が変わったら、グラフを描き直す
        var timer = null;
        window.addEventListener('resize', function () {
            window.clearTimeout(timer);
            timer = window.setTimeout(renderDashboard, 150);
        });
    }

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
                switchView('dashboard');
                return loadAll();
            })
            .catch(function (err) {
                console.error(err);
                showLogin('通信に失敗しました。時間をおいてもう一度お試しください。', true);
            });
    }

    document.addEventListener('DOMContentLoaded', function () {
        initLogin();
        initControls();
        start();
    });
})();
