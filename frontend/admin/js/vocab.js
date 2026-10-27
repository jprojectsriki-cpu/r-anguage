/* R-anguage 管理画面：単語カード
 * - 一覧（レベル・状態・キーワードで絞り込み、入力ミスと重複の表示）
 * - 作成・編集（カードのプレビュー付き）、削除
 * - 例文のふりがなは {漢字|よみ} で書く（「ふりがな」ボタンで挿入できる）
 * ※ admin.js のあとに読み込むこと（window.RAdmin を使う）
 */
(function () {
    'use strict';

    var A = window.RAdmin;
    var LEVELS = ['N4', 'N3', 'N2', 'N1'];
    var KANA = /^[ぁ-ゟ゠-ヿー・ 　]+$/;

    var v = {
        list: [],
        loaded: false,
        level: '',
        status: '',
        query: '',
        checkOnly: false,
        editing: null,  // 編集中のカード（新規は null）
        saved: ''       // 開いたときのフォームの内容（変更の確認用）
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
    /* ===================== 入力チェック（GASと同じ内容） ===================== */
    function validate(d) {
        var e = [];
        if (LEVELS.indexOf(d.level) === -1) e.push('レベルを選んでください。');
        if (!d.word) e.push('単語を入力してください。');
        if (!d.reading) e.push('読みを入力してください。');
        else if (!KANA.test(d.reading)) e.push('読みは、ひらがな・カタカナで入力してください。');
        if (!d.meaning) e.push('英語の意味を入力してください。');
        if (d.exampleEn.trim() && !d.example.trim()) e.push('例文の英訳だけが入っています。例文も入力してください。');
        if (['公開', '下書き'].indexOf(d.status) === -1) e.push('状態を選んでください。');
        var bad = d.example.match(/\{[^}]*$|\{[^|}]*\}/m);
        if (bad) e.push('例文のふりがなの書き方を確認してください：「' + bad[0].slice(0, 20) + '」（正しくは {漢字|よみ}）');
        return e;
    }
    function needsCheck(c) { return (c.errors && c.errors.length) || c.duplicateOf; }

    /* ===================== 読み込み ===================== */
    function load() {
        return A.withLoading('単語カードを読み込んでいます', A.apiPost({ action: 'admin.cards', token: A.getToken() }))
            .then(function (res) {
                if (A.handleAuthError(res)) return;
                if (!res || !res.ok) { A.notice((res && res.message) || '単語カードを読み込めませんでした。', 'error'); return; }
                v.list = res.cards || [];
                v.loaded = true;
                renderList();
            })
            .catch(function (err) {
                console.error(err);
                A.notice('通信に失敗しました。「最新の情報に更新」を押して、もう一度お試しください。', 'error');
            });
    }

    /* ===================== 一覧 ===================== */
    function renderList() {
        var list = v.list;
        var errors = list.filter(function (c) { return c.errors && c.errors.length; }).length;
        var dups = list.filter(function (c) { return c.duplicateOf; }).length;
        var check = errors + dups > 0;

        var badge = $('navBadgeV');
        badge.textContent = list.filter(needsCheck).length;
        badge.hidden = !check;

        $('vErrorBox').hidden = !check;
        if (!check) v.checkOnly = false;
        var parts = [];
        if (errors) parts.push('入力ミスがあるカードが ' + errors + '枚あります（受講生には表示されません）。');
        if (dups) parts.push('同じレベルに同じ単語のカードが ' + dups + '枚あります。');
        $('vErrorText').textContent = parts.join(' ');
        $('vErrorToggle').textContent = v.checkOnly ? 'すべてのカードを表示' : '確認が必要なカードだけ表示';

        var counts = { '': list.length };
        list.forEach(function (c) { counts[c.level] = (counts[c.level] || 0) + 1; });
        document.querySelectorAll('[data-vcount]').forEach(function (b) { b.textContent = counts[b.getAttribute('data-vcount')] || 0; });
        document.querySelectorAll('#vLevelTabs .tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.getAttribute('data-level') === v.level)); });
        $('vStatus').value = v.status;

        var word = v.query.trim().toLowerCase();
        var rows = list.filter(function (c) {
            if (v.checkOnly && !needsCheck(c)) return false;
            if (v.level && c.level !== v.level) return false;
            if (v.status && c.status !== v.status) return false;
            if (!word) return true;
            return (c.cardId + ' ' + c.word + ' ' + c.reading + ' ' + c.meaning + ' ' + plain(c.example)).toLowerCase().indexOf(word) !== -1;
        });
        rows.sort(function (a, b) { return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0); });

        var tbody = $('vRows');
        tbody.replaceChildren();
        rows.forEach(function (c) {
            var tr = el('tr');
            if (needsCheck(c)) tr.className = 'has-error';

            var c1 = A.td('カードID', 'cell-id'); c1.textContent = c.cardId;
            var c2 = A.td('レベル'); c2.append(el('span', 'level-pill lv-' + c.level, c.level || '?'));
            var c3 = A.td('単語／読み');
            var w = el('div'); w.append(el('span', 'v-word', c.word || '—'), el('span', 'cell-sub', c.reading || '—')); c3.append(w);
            var c4 = A.td('英語の意味', 'cell-meaning'); c4.textContent = c.meaning || '—';
            c4.lang = 'en';

            var c5 = A.td('例文', 'cell-question');
            var ex = el('div');
            if (c.example) {
                ex.append(ruby('span', 'q-text', c.example));
                if (c.exampleEn) { var en = el('span', 'cell-sub v-en', c.exampleEn); en.lang = 'en'; ex.append(en); }
            } else {
                ex.append(el('span', 'cell-sub', '—'));
            }
            var notes = el('ul', 'row-errors');
            (c.errors || []).forEach(function (msg) { notes.append(el('li', '', msg)); });
            if (c.duplicateOf) notes.append(el('li', '', '同じレベルに、同じ単語・読みのカードがあります（' + c.duplicateOf + '）'));
            if (notes.children.length) ex.append(notes);
            c5.append(ex);

            var c6 = A.td('状態'); c6.append(el('span', 'status ' + (c.status === '公開' ? 'st-active' : 'st-pending'), c.status || '—'));
            var c7 = A.td('更新日', 'cell-nowrap'); c7.textContent = A.fmt(c.updatedAt, false);

            var c8 = A.td('操作', 'col-action');
            var acts = el('div', 'actions');
            acts.append(
                A.button('編集', 'btn btn-white btn-xs', function () { openEditor(c); }),
                A.button('削除', 'btn btn-white btn-xs btn-danger', function () { removeCard(c); })
            );
            c8.append(acts);

            tr.append(c1, c2, c3, c4, c5, c6, c7, c8);
            tbody.append(tr);
        });
        $('vEmpty').hidden = rows.length > 0;
        $('vEmpty').textContent = list.length ? '該当するカードはありません。' : 'まだカードがありません。「新しいカード」から作成できます。';
    }

    function removeCard(c) {
        A.confirmAction({
            title: 'このカードを削除しますか？',
            rows: [['カードID', c.cardId], ['レベル', c.level], ['単語', c.word + '（' + c.reading + '）'], ['英語の意味', c.meaning]],
            text: '削除したカードは元にもどせません。受講生に表示したくないだけなら、「編集」で「下書き」にする方法もあります。',
            ok: '削除する'
        }).then(function (r) {
            if (!r) return;
            A.withLoading('削除しています', A.apiPost({ action: 'admin.deleteCard', token: A.getToken(), cardId: c.cardId }))
                .then(function (res) {
                    if (A.handleAuthError(res)) return;
                    if (!res || !res.ok) { A.notice((res && res.message) || '削除できませんでした。', 'error'); return; }
                    A.notice(c.cardId + '（' + c.word + '）を削除しました。', 'ok');
                    return load();
                })
                .catch(function (err) {
                    console.error(err);
                    A.notice('通信に失敗しました。削除されたかどうか、「最新の情報に更新」で確認してください。', 'error');
                });
        });
    }

    /* ===================== 作成・編集 ===================== */
    function form() { return $('vForm'); }

    function readForm() {
        var f = form().elements;
        var st = form().querySelector('input[name="status"]:checked');
        return {
            cardId: v.editing ? v.editing.cardId : '',
            level: f.level.value,
            word: f.word.value.trim(),
            reading: f.reading.value.trim(),
            meaning: f.meaning.value.trim(),
            example: f.example.value,
            exampleEn: f.exampleEn.value,
            status: st ? st.value : ''
        };
    }

    function fillForm(d) {
        var f = form().elements;
        f.level.value = d.level || 'N4';
        f.word.value = d.word || '';
        f.reading.value = d.reading || '';
        f.meaning.value = d.meaning || '';
        f.example.value = d.example || '';
        f.exampleEn.value = d.exampleEn || '';
        form().querySelectorAll('input[name="status"]').forEach(function (r) { r.checked = r.value === (d.status || '下書き'); });
        hideErrors();
        $('vCard').classList.remove('is-flipped');
        renderPreview();
    }

    function openEditor(c, keep) {
        v.editing = c || null;
        $('vEditTitle').textContent = c ? 'カードを編集（' + c.cardId + '）' : '新しいカード';
        $('vSaveNext').hidden = !!c;
        fillForm(c || keep || {});
        v.saved = JSON.stringify(readForm());
        A.notice('');
        A.switchView('vocabEdit');
        if (!c) form().elements.word.focus({ preventScroll: true });
    }

    function isDirty() { return JSON.stringify(readForm()) !== v.saved; }

    function renderPreview() {
        var d = readForm();

        var front = $('vFront');
        front.replaceChildren(
            el('span', 'level-pill lv-' + d.level, d.level),
            el('span', 'fc-word', d.word || '（単語）')
        );

        var back = $('vBackFace');
        back.replaceChildren();
        back.append(el('span', 'fc-word fc-word-sm', d.word || '（単語）'));
        var rd = el('span', 'fc-reading', d.reading || '（読み）');
        var mean = el('span', 'fc-meaning', d.meaning || '（英語の意味）');
        mean.lang = 'en';
        back.append(rd, mean);
        if (d.example.trim()) {
            var ex = el('span', 'fc-example');
            ex.append(ruby('span', 'fc-ex-ja', d.example));
            if (d.exampleEn.trim()) { var en = el('span', 'fc-ex-en', d.exampleEn); en.lang = 'en'; ex.append(en); }
            back.append(ex);
        }

        $('vPvStatus').textContent = d.status === '公開' ? '保存すると、受講生に表示されます。' : '下書きは、受講生には表示されません。';
    }

    function hideErrors() {
        $('vFormErrors').hidden = true;
    }
    function showErrors(list) {
        var ul = $('vFormErrorList');
        ul.replaceChildren();
        list.forEach(function (m) { ul.append(el('li', '', m)); });
        $('vFormErrors').hidden = false;
        $('vFormErrors').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function save(next) {
        var d = readForm();
        var errors = validate(d);
        if (errors.length) { showErrors(errors); return; }
        hideErrors();

        A.withLoading('保存しています', A.apiPost({ action: 'admin.saveCard', token: A.getToken(), card: d }))
            .then(function (res) {
                if (A.handleAuthError(res)) return;
                if (!res || !res.ok) {
                    if (res && res.duplicate) {
                        showErrors([res.message, '同じ単語に別の意味を加えたいときは、「やめる」を押して一覧にもどり、そのカードの「編集」で、英語の意味に「;」で区切って追加してください。'], false);
                    } else {
                        showErrors(res && res.errors ? res.errors : [(res && res.message) || '保存できませんでした。']);
                    }
                    return;
                }
                var msg = res.cardId + '（' + d.word + '）を' + (res.created ? '作成' : '更新') + 'しました（' + d.status + '）。';
                v.saved = JSON.stringify(readForm());
                if (next) {
                    // レベルと状態はそのままで、次のカードへ
                    openEditor(null, { level: d.level, status: d.status });
                    A.notice(msg + ' 続けて次のカードを作成できます。', 'ok');
                    load();
                } else {
                    A.switchView('vocab', null, true);
                    A.notice(msg, 'ok');
                    load();
                }
            })
            .catch(function (err) {
                console.error(err);
                A.notice('通信に失敗しました。保存されたかどうか、単語カードの一覧で確認してください。', 'error');
            });
    }

    /* ---------- 例文にふりがなを付ける（問題と同じダイアログを使う） ---------- */
    function addRuby(name) {
        var ta = form().elements[name];
        var start = ta.selectionStart, end = ta.selectionEnd;
        var base = ta.value.slice(start, end);
        if (!base || /[{}|\n]/.test(base)) {
            A.notice('ふりがなを付けたい漢字を、先に選んでから「ふりがな」を押してください。', 'error');
            ta.focus();
            return;
        }
        A.notice('');
        var dlg = $('rubyDialog');
        $('rubyBase').textContent = base;
        $('rubyReading').value = '';
        dlg.returnValue = '';
        dlg.onclose = function () {
            var reading = $('rubyReading').value.trim().replace(/[{}|]/g, '');
            if (dlg.returnValue !== 'ok' || !reading) { ta.focus(); return; }
            ta.setRangeText('{' + base + '|' + reading + '}', start, end, 'end');
            ta.focus();
            renderPreview();
        };
        dlg.showModal();
        $('rubyReading').focus();
    }

    /* ===================== 準備 ===================== */
    function init() {
        $('vReload').addEventListener('click', function () { A.notice(''); load(); });
        $('vNew').addEventListener('click', function () { openEditor(null, { level: v.level || 'N4', status: '下書き' }); });
        $('vLevelTabs').addEventListener('click', function (e) {
            var t = e.target.closest('.tab');
            if (!t) return;
            v.level = t.getAttribute('data-level');
            renderList();
        });
        $('vStatus').addEventListener('change', function (e) { v.status = e.target.value; renderList(); });
        $('vSearch').addEventListener('input', function (e) { v.query = e.target.value; renderList(); });
        $('vErrorToggle').addEventListener('click', function () { v.checkOnly = !v.checkOnly; renderList(); });

        var f = form();
        f.addEventListener('input', function () { renderPreview(); });
        f.addEventListener('change', function () { renderPreview(); });
        f.addEventListener('submit', function (e) {
            e.preventDefault();
            save(e.submitter && e.submitter.value === 'next');
        });
        $('vCancel').addEventListener('click', function () { A.switchView('vocab'); });
        $('vBack').addEventListener('click', function () { A.switchView('vocab'); });
        f.querySelectorAll('[data-vruby]').forEach(function (b) {
            b.addEventListener('mousedown', function (e) { e.preventDefault(); });
            b.addEventListener('click', function () { addRuby(b.getAttribute('data-vruby')); });
        });
        $('vCard').addEventListener('click', function () { this.classList.toggle('is-flipped'); });
        $('vPreviewRuby').addEventListener('change', function (e) {
            $('vCard').classList.toggle('ruby-off', !e.target.checked);
        });

        window.addEventListener('beforeunload', function (e) {
            if (!$('appView').hidden && !document.querySelector('.view[data-view="vocabEdit"]').hidden && isDirty()) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    A.registerView('vocab', {
        onShow: function () { if (!v.loaded) load(); else renderList(); }
    });
    A.registerView('vocabEdit', {
        beforeLeave: function () {
            if (!isDirty()) return Promise.resolve(true);
            return A.confirmAction({
                title: '保存していない変更があります',
                text: 'このまま移動すると、入力した内容は保存されません。',
                ok: '保存せずに移動する'
            }).then(function (r) { return !!r; });
        }
    });
    A.registerView('_vocabData', {
        onLogout: function () { v.list = []; v.loaded = false; v.editing = null; v.saved = ''; }
    });

    document.addEventListener('DOMContentLoaded', init);
})();
