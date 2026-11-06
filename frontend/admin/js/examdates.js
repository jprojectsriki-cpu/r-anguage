/* R-ANGUAGE 管理画面：試験日
 * - 受講生がマイページで選ぶ試験日の一覧・追加・変更・削除
 * ※ admin.js のあとに読み込むこと（window.RAdmin を使う）
 */
(function () {
    'use strict';

    var A = window.RAdmin;
    var e = { list: [], loaded: false, today: '', editing: null };

    function $(id) { return document.getElementById(id); }
    var el = function (t, c, x) { return A.el(t, c, x); };
    function showDate(s) {
        var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return s || '';
        var w = '日月火水木金土'.charAt(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay());
        return m[1] + '/' + m[2] + '/' + m[3] + '（' + w + '）';
    }
    function daysLeft(date) {
        if (!e.today) return '';
        var a = Date.parse(e.today + 'T00:00:00Z');
        var b = Date.parse(date + 'T00:00:00Z');
        var d = Math.round((b - a) / 86400000);
        return d > 0 ? 'あと' + d + '日' : d === 0 ? '今日' : '終了';
    }

    function load() {
        return A.withLoading('試験日を読み込んでいます', A.apiPost({ action: 'admin.examDates', token: A.getToken() }))
            .then(function (res) {
                if (A.handleAuthError(res)) return;
                if (!res || !res.ok) { A.notice((res && res.message) || '試験日を読み込めませんでした。', 'error'); return; }
                e.list = res.exams || [];
                e.today = res.today || '';
                e.loaded = true;
                render();
            })
            .catch(function (err) {
                console.error(err);
                A.notice('通信に失敗しました。「最新の情報に更新」を押して、もう一度お試しください。', 'error');
            });
    }

    function render() {
        var tbody = $('eRows');
        tbody.replaceChildren();
        e.list.forEach(function (x) {
            var past = e.today && x.date < e.today;
            var tr = el('tr');
            if (past) tr.className = 'is-past';
            var c1 = A.td('試験日ID', 'cell-id'); c1.textContent = x.examId;
            var c2 = A.td('試験名'); c2.textContent = x.name;
            var c3 = A.td('試験日', 'cell-nowrap'); c3.textContent = showDate(x.date);
            var c4 = A.td('残り', 'cell-nowrap');
            c4.append(el('span', 'status ' + (past ? 'st-expired' : 'st-active'), daysLeft(x.date)));
            var c5 = A.td('操作', 'col-action');
            var acts = el('div', 'actions');
            acts.append(
                A.button('編集', 'btn btn-white btn-xs', function () { startEdit(x); }),
                A.button('削除', 'btn btn-white btn-xs btn-danger', function () { remove(x); })
            );
            c5.append(acts);
            tr.append(c1, c2, c3, c4, c5);
            tbody.append(tr);
        });
        $('eEmpty').hidden = e.list.length > 0;
    }

    /* ---------- 追加・変更 ---------- */
    function resetForm() {
        e.editing = null;
        $('eForm').reset();
        $('eFormTitle').textContent = '試験日を追加';
        $('eSubmit').textContent = '追加する';
        $('eCancel').hidden = true;
    }
    function startEdit(x) {
        e.editing = x;
        var f = $('eForm');
        f.elements.examName.value = x.name;
        f.elements.examDate.value = x.date;
        $('eFormTitle').textContent = '試験日を変更（' + x.examId + '）';
        $('eSubmit').textContent = '変更する';
        $('eCancel').hidden = false;
        f.scrollIntoView({ behavior: 'smooth', block: 'center' });
        f.elements.examName.focus({ preventScroll: true });
    }
    function submit(ev) {
        ev.preventDefault();
        var f = $('eForm');
        var name = f.elements.examName.value.trim();
        var date = f.elements.examDate.value;
        if (!name) { A.notice('試験名を入力してください（例：2027年7月 JLPT）。', 'error'); f.elements.examName.focus(); return; }
        if (!date) { A.notice('試験日を入力してください。', 'error'); f.elements.examDate.focus(); return; }
        var exam = { name: name, date: date };
        if (e.editing) exam.examId = e.editing.examId;
        A.withLoading(e.editing ? '試験日を変更しています' : '試験日を追加しています',
            A.apiPost({ action: 'admin.saveExamDate', token: A.getToken(), exam: exam }))
            .then(function (res) {
                if (A.handleAuthError(res)) return;
                if (!res || !res.ok) { A.notice((res && res.message) || '保存できませんでした。', 'error'); return; }
                A.notice(res.message || '保存しました。', 'ok');
                resetForm();
                return load();
            })
            .catch(function (err) {
                console.error(err);
                A.notice('通信に失敗しました。保存されたかどうか、「最新の情報に更新」で確認してください。', 'error');
            });
    }
    function remove(x) {
        A.confirmAction({
            title: 'この試験日を削除しますか？',
            rows: [['試験日ID', x.examId], ['試験名', x.name], ['試験日', showDate(x.date)]],
            text: 'この試験日を選んでいた受講生は「試験日を選んでいない」状態になります（ホームの日数が出なくなります）。',
            ok: '削除する'
        }).then(function (r) {
            if (!r) return;
            A.withLoading('試験日を削除しています', A.apiPost({ action: 'admin.deleteExamDate', token: A.getToken(), examId: x.examId }))
                .then(function (res) {
                    if (A.handleAuthError(res)) return;
                    if (!res || !res.ok) { A.notice((res && res.message) || '削除できませんでした。', 'error'); return; }
                    A.notice(res.message || '削除しました。', 'ok');
                    if (e.editing && e.editing.examId === x.examId) resetForm();
                    return load();
                })
                .catch(function (err) {
                    console.error(err);
                    A.notice('通信に失敗しました。削除されたかどうか、「最新の情報に更新」で確認してください。', 'error');
                });
        });
    }

    function init() {
        $('eForm').addEventListener('submit', submit);
        $('eCancel').addEventListener('click', resetForm);
        $('eReload').addEventListener('click', function () { A.notice(''); load(); });
    }

    A.registerView('examDates', {
        onShow: function () { if (!e.loaded) load(); else render(); }
    });
    A.registerView('_examDatesData', {
        onLogout: function () { e.list = []; e.loaded = false; e.today = ''; resetForm(); }
    });

    document.addEventListener('DOMContentLoaded', init);
})();
