/* R-anguage 管理画面：お知らせ
 * - 一覧（表示中・表示前・下書き・表示終了で分けて表示、対象・キーワードで絞り込み、入力ミスの表示）
 * - 作成・編集（受講生の画面に近いプレビュー付き）、削除
 * - ふりがなは {漢字|よみ} で書く（「ふりがな」ボタンで挿入できる）
 * ※ admin.js のあとに読み込むこと（window.RAdmin を使う）
 */
(function () {
    'use strict';

    var A = window.RAdmin;
    var PHASE = { showing: '表示中', scheduled: '表示前', draft: '下書き', ended: '表示終了', error: '入力ミス' };
    var PHASE_CLASS = { showing: 'st-active', scheduled: 'st-paid', draft: 'st-pending', ended: 'st-expired', error: 'st-suspended' };
    var TARGETS = ['すべて', 'N4', 'N3', 'N2', 'N1'];

    var n = {
        list: [],
        loaded: false,
        today: '',       // GASから受け取る今日の日付（日本時間、2026-10-27 の形）
        phase: 'showing',
        target: '',
        query: '',
        editing: null,
        saved: ''
    };

    function $(id) { return document.getElementById(id); }
    var el = function (t, c, x) { return A.el(t, c, x); };

    /* ===================== ふりがな ===================== */
    function renderRuby(node, text) {
        node.replaceChildren();
        var re = /\{([^{}|\n]+)\|([^{}|\n]+)\}/g;
        var src = String(text || '');
        var last = 0, m;
        function addText(s) {
            s.split('\n').forEach(function (part, i) {
                if (i > 0) node.append(document.createElement('br'));
                if (part) node.append(document.createTextNode(part));
            });
        }
        while ((m = re.exec(src)) !== null) {
            addText(src.slice(last, m.index));
            var r = document.createElement('ruby');
            r.append(document.createTextNode(m[1]));
            var rt = document.createElement('rt');
            rt.textContent = m[2];
            r.append(rt);
            node.append(r);
            last = re.lastIndex;
        }
        addText(src.slice(last));
        return node;
    }
    function ruby(tag, cls, text) { return renderRuby(el(tag, cls), text); }
    function plain(text) { return String(text || '').replace(/\{([^{}|\n]+)\|[^{}|\n]+\}/g, '$1'); }

    /* ===================== 日付 ===================== */
    function pad(x) { return String(x).padStart(2, '0'); }
    function localToday() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function today() { return n.today || localToday(); }
    // 2026-11-01 → 2026/11/01
    function showDate(s) { return s ? s.replace(/-/g, '/') : ''; }
    function period(x) {
        return showDate(x.startDate) + ' 〜 ' + (x.endDate ? showDate(x.endDate) : '終了日なし');
    }
    function phaseOf(d) {
        if (d.status !== '公開') return 'draft';
        if (d.startDate && d.startDate > today()) return 'scheduled';
        if (d.endDate && d.endDate < today()) return 'ended';
        return 'showing';
    }

    /* ===================== 入力チェック（GASと同じ内容） ===================== */
    function validate(d) {
        var e = [];
        if (!d.title) e.push('タイトルを入力してください。');
        if (!d.body.trim()) e.push('本文を入力してください。');
        if (TARGETS.indexOf(d.target) === -1) e.push('対象を選んでください。');
        if (!d.startDate) e.push('表示開始日を入力してください。');
        if (d.startDate && d.endDate && d.endDate < d.startDate) e.push('表示終了日は、表示開始日と同じ日かそれより後にしてください。');
        if (['通常', '重要'].indexOf(d.importance) === -1) e.push('重要かどうかを選んでください。');
        if (['公開', '下書き'].indexOf(d.status) === -1) e.push('状態を選んでください。');
        var bad = (d.title + d.body).match(/\{[^}]*$|\{[^|}]*\}/m);
        if (bad) e.push('ふりがなの書き方を確認してください：「' + bad[0].slice(0, 20) + '」（正しくは {漢字|よみ}）');
        return e;
    }

    /* ===================== 読み込み ===================== */
    function load() {
        return A.withLoading('お知らせを読み込んでいます', A.apiPost({ action: 'admin.notices', token: A.getToken() }))
            .then(function (res) {
                if (A.handleAuthError(res)) return;
                if (!res || !res.ok) { A.notice((res && res.message) || 'お知らせを読み込めませんでした。', 'error'); return; }
                n.list = res.notices || [];
                n.today = res.today || '';
                n.loaded = true;
                renderList();
            })
            .catch(function (err) {
                console.error(err);
                A.notice('通信に失敗しました。「最新の情報に更新」を押して、もう一度お試しください。', 'error');
            });
    }

    /* ===================== 一覧 ===================== */
    function renderList() {
        var list = n.list;
        var counts = { '': list.length };
        list.forEach(function (x) { counts[x.phase] = (counts[x.phase] || 0) + 1; });
        var errors = counts.error || 0;

        var badge = $('navBadgeN');
        badge.textContent = errors;
        badge.hidden = errors === 0;
        $('nErrorBox').hidden = errors === 0;
        $('nErrorText').textContent = '入力ミスがあるお知らせが ' + errors + '件あります（受講生には表示されません）。';
        document.querySelector('#nTabs [data-phase="error"]').hidden = errors === 0;
        if (n.phase === 'error' && !errors) n.phase = 'showing';

        document.querySelectorAll('[data-ncount]').forEach(function (b) { b.textContent = counts[b.getAttribute('data-ncount')] || 0; });
        document.querySelectorAll('#nTabs .tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.getAttribute('data-phase') === n.phase)); });
        $('nTarget').value = n.target;

        var word = n.query.trim().toLowerCase();
        var rows = list.filter(function (x) {
            if (n.phase && x.phase !== n.phase) return false;
            if (n.target && x.target !== n.target) return false;
            if (!word) return true;
            return (x.noticeId + ' ' + plain(x.title) + ' ' + plain(x.body)).toLowerCase().indexOf(word) !== -1;
        });
        // 表示開始日の新しい順（同じ日なら更新日時の新しい順）
        rows.sort(function (a, b) {
            if (a.startDate !== b.startDate) return a.startDate < b.startDate ? 1 : -1;
            return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
        });

        var tbody = $('nRows');
        tbody.replaceChildren();
        rows.forEach(function (x) {
            var tr = el('tr');
            if (x.phase === 'error') tr.className = 'has-error';

            var c1 = A.td('お知らせID', 'cell-id'); c1.textContent = x.noticeId;
            var c2 = A.td('タイトル', 'cell-question');
            var t = el('div');
            if (x.importance === '重要') t.append(el('span', 'important-tag', '重要'));
            t.append(ruby('span', 'n-title', x.title || '（タイトルがありません）'));
            t.append(el('span', 'cell-sub n-body', plain(x.body).replace(/\s+/g, ' ').slice(0, 80)));
            if (x.errors && x.errors.length) {
                var ul = el('ul', 'row-errors');
                x.errors.forEach(function (msg) { ul.append(el('li', '', msg)); });
                t.append(ul);
            }
            c2.append(t);

            var c3 = A.td('対象');
            c3.append(x.target === 'すべて' || !x.target ? el('span', 'target-all', x.target || '—') : el('span', 'level-pill lv-' + x.target, x.target));
            var c4 = A.td('表示期間', 'cell-nowrap'); c4.textContent = period(x);
            var c5 = A.td('状況'); c5.append(el('span', 'status ' + (PHASE_CLASS[x.phase] || ''), PHASE[x.phase] || x.phase));
            var c6 = A.td('更新日', 'cell-nowrap'); c6.textContent = A.fmt(x.updatedAt, false);

            var c7 = A.td('操作', 'col-action');
            var acts = el('div', 'actions');
            acts.append(
                A.button('編集', 'btn btn-white btn-xs', function () { openEditor(x); }),
                A.button('削除', 'btn btn-white btn-xs btn-danger', function () { removeNotice(x); })
            );
            c7.append(acts);

            tr.append(c1, c2, c3, c4, c5, c6, c7);
            tbody.append(tr);
        });
        $('nEmpty').hidden = rows.length > 0;
        $('nEmpty').textContent = list.length ? '該当するお知らせはありません。' : 'まだお知らせがありません。「新しいお知らせ」から作成できます。';
    }

    function removeNotice(x) {
        A.confirmAction({
            title: 'このお知らせを削除しますか？',
            rows: [['お知らせID', x.noticeId], ['タイトル', plain(x.title)], ['対象', x.target], ['表示期間', period(x)]],
            text: '削除したお知らせは元にもどせません。表示をやめたいだけなら、「編集」で「下書き」にするか、表示終了日を入れる方法もあります。',
            ok: '削除する'
        }).then(function (r) {
            if (!r) return;
            A.withLoading('削除しています', A.apiPost({ action: 'admin.deleteNotice', token: A.getToken(), noticeId: x.noticeId }))
                .then(function (res) {
                    if (A.handleAuthError(res)) return;
                    if (!res || !res.ok) { A.notice((res && res.message) || '削除できませんでした。', 'error'); return; }
                    A.notice(x.noticeId + ' を削除しました。', 'ok');
                    return load();
                })
                .catch(function (err) {
                    console.error(err);
                    A.notice('通信に失敗しました。削除されたかどうか、「最新の情報に更新」で確認してください。', 'error');
                });
        });
    }

    /* ===================== 作成・編集 ===================== */
    function form() { return $('nForm'); }

    function readForm() {
        var f = form().elements;
        var checked = function (name) { var c = form().querySelector('input[name="' + name + '"]:checked'); return c ? c.value : ''; };
        return {
            noticeId: n.editing ? n.editing.noticeId : '',
            title: f.title.value.trim(),
            body: f.body.value,
            target: f.target.value,
            startDate: f.startDate.value,
            endDate: f.endDate.value,
            importance: checked('importance'),
            status: checked('status')
        };
    }

    function fillForm(d) {
        var f = form().elements;
        f.title.value = d.title || '';
        f.body.value = d.body || '';
        f.target.value = TARGETS.indexOf(d.target) === -1 ? 'すべて' : d.target;
        // 日付の欄は 2026-11-01 の形のときだけ入る（読めない日付は空欄になる）
        f.startDate.value = /^\d{4}-\d{2}-\d{2}$/.test(d.startDate || '') ? d.startDate : '';
        f.endDate.value = /^\d{4}-\d{2}-\d{2}$/.test(d.endDate || '') ? d.endDate : '';
        form().querySelectorAll('input[name="importance"]').forEach(function (r) { r.checked = r.value === (d.importance || '通常'); });
        form().querySelectorAll('input[name="status"]').forEach(function (r) { r.checked = r.value === (d.status || '下書き'); });
        $('nFormErrors').hidden = true;
        renderPreview();
    }

    function openEditor(x) {
        n.editing = x || null;
        $('nEditTitle').textContent = x ? 'お知らせを編集（' + x.noticeId + '）' : '新しいお知らせ';
        fillForm(x || { startDate: today() });
        n.saved = JSON.stringify(readForm());
        A.notice('');
        A.switchView('noticeEdit');
        if (!x) form().elements.title.focus({ preventScroll: true });
    }

    function isDirty() { return JSON.stringify(readForm()) !== n.saved; }

    function renderPreview() {
        var d = readForm();
        var card = $('nPreview');
        card.replaceChildren();
        card.classList.toggle('is-important', d.importance === '重要');

        var head = el('p', 'notice-meta');
        if (d.importance === '重要') head.append(el('span', 'important-tag', '重要'));
        head.append(el('span', 'notice-date', showDate(d.startDate) || '（表示開始日）'));
        card.append(head);
        card.append(ruby('h3', 'notice-title', d.title || '（タイトル）'));
        card.append(ruby('div', 'notice-body', d.body || '（本文）'));

        var who = d.target === 'すべて' ? 'すべての受講生' : d.target + ' を持っている受講生';
        var msg = {
            draft: '下書きは、受講生には表示されません。',
            scheduled: '保存すると、' + showDate(d.startDate) + ' から' + who + 'に表示されます。',
            ended: '表示終了日が過ぎているため、保存しても表示されません。',
            showing: '保存すると、すぐに' + who + 'に表示されます' + (d.endDate ? '（' + showDate(d.endDate) + ' まで）' : '（終了日なし）') + '。'
        }[phaseOf(d)];
        $('nPvStatus').textContent = msg;
    }

    function save() {
        var d = readForm();
        var box = $('nFormErrors'), ul = $('nFormErrorList');
        var errors = validate(d);
        ul.replaceChildren();
        if (errors.length) {
            errors.forEach(function (m) { ul.append(el('li', '', m)); });
            box.hidden = false;
            box.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        box.hidden = true;

        A.withLoading('保存しています', A.apiPost({ action: 'admin.saveNotice', token: A.getToken(), notice: d }))
            .then(function (res) {
                if (A.handleAuthError(res)) return;
                if (!res || !res.ok) {
                    (res && res.errors ? res.errors : [(res && res.message) || '保存できませんでした。']).forEach(function (m) { ul.append(el('li', '', m)); });
                    box.hidden = false;
                    return;
                }
                n.saved = JSON.stringify(readForm());
                n.phase = res.phase || phaseOf(d); // 保存したお知らせが見えるタブを開く
                A.switchView('notices', null, true);
                A.notice(res.noticeId + ' を' + (res.created ? '作成' : '更新') + 'しました（' + (PHASE[n.phase] || d.status) + '）。', 'ok');
                load();
            })
            .catch(function (err) {
                console.error(err);
                A.notice('通信に失敗しました。保存されたかどうか、お知らせの一覧で確認してください。', 'error');
            });
    }

    /* ---------- ふりがなを付ける（問題と同じダイアログを使う） ---------- */
    function addRuby(name) {
        var box = form().elements[name];
        var start = box.selectionStart, end = box.selectionEnd;
        var base = box.value.slice(start, end);
        if (!base || /[{}|\n]/.test(base)) {
            A.notice('ふりがなを付けたい漢字を、先に選んでから「ふりがな」を押してください。', 'error');
            box.focus();
            return;
        }
        A.notice('');
        var dlg = $('rubyDialog');
        $('rubyBase').textContent = base;
        $('rubyReading').value = '';
        dlg.returnValue = '';
        dlg.onclose = function () {
            var reading = $('rubyReading').value.trim().replace(/[{}|]/g, '');
            if (dlg.returnValue !== 'ok' || !reading) { box.focus(); return; }
            box.setRangeText('{' + base + '|' + reading + '}', start, end, 'end');
            box.focus();
            renderPreview();
        };
        dlg.showModal();
        $('rubyReading').focus();
    }

    /* ===================== 準備 ===================== */
    function init() {
        $('nReload').addEventListener('click', function () { A.notice(''); load(); });
        $('nNew').addEventListener('click', function () { openEditor(null); });
        $('nTabs').addEventListener('click', function (e) {
            var t = e.target.closest('.tab');
            if (!t) return;
            n.phase = t.getAttribute('data-phase');
            renderList();
        });
        $('nErrorShow').addEventListener('click', function () { n.phase = 'error'; renderList(); });
        $('nTarget').addEventListener('change', function (e) { n.target = e.target.value; renderList(); });
        $('nSearch').addEventListener('input', function (e) { n.query = e.target.value; renderList(); });

        var f = form();
        f.addEventListener('input', renderPreview);
        f.addEventListener('change', renderPreview);
        f.addEventListener('submit', function (e) { e.preventDefault(); save(); });
        $('nCancel').addEventListener('click', function () { A.switchView('notices'); });
        $('nBack').addEventListener('click', function () { A.switchView('notices'); });
        f.querySelectorAll('[data-nruby]').forEach(function (b) {
            b.addEventListener('mousedown', function (e) { e.preventDefault(); });
            b.addEventListener('click', function () { addRuby(b.getAttribute('data-nruby')); });
        });
        $('nPreviewRuby').addEventListener('change', function (e) {
            $('nPreview').classList.toggle('ruby-off', !e.target.checked);
        });

        window.addEventListener('beforeunload', function (e) {
            if (!$('appView').hidden && !document.querySelector('.view[data-view="noticeEdit"]').hidden && isDirty()) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    A.registerView('notices', {
        onShow: function () { if (!n.loaded) load(); else renderList(); }
    });
    A.registerView('noticeEdit', {
        beforeLeave: function () {
            if (!isDirty()) return Promise.resolve(true);
            return A.confirmAction({
                title: '保存していない変更があります',
                text: 'このまま移動すると、入力した内容は保存されません。',
                ok: '保存せずに移動する'
            }).then(function (r) { return !!r; });
        }
    });
    A.registerView('_noticesData', {
        onLogout: function () { n.list = []; n.loaded = false; n.today = ''; n.editing = null; n.saved = ''; n.phase = 'showing'; }
    });

    document.addEventListener('DOMContentLoaded', init);
})();
