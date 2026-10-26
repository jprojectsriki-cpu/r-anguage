/* R-anguage 管理画面：問題
 * - 一覧（登録状況の表、レベル・科目・状態・キーワードで絞り込み、入力ミスの表示）
 * - 作成・編集（プレビュー付き）、削除
 * - ふりがなは {漢字|よみ} で書く（「ふりがな」ボタンで挿入できる）
 * ※ admin.js のあとに読み込むこと（window.RAdmin を使う）
 */
(function () {
    'use strict';

    var A = window.RAdmin;
    var LEVELS = ['N4', 'N3', 'N2', 'N1'];
    var SECTIONS = ['文字・語彙', '文法', '読解', '聴解'];
    var AUDIO_DIR = '../user/audio/'; // GitHub Pages の frontend/user/audio/

    // JLPTの大問の種類（入力の候補。ほかの名前も自由に入力できる）
    var FORMS = {
        '文字・語彙': ['漢字読み', '表記', '語形成', '文脈規定', '言い換え類義', '用法'],
        '文法': ['文法形式の判断', '文の組み立て', '文章の文法'],
        '読解': ['内容理解（短文）', '内容理解（中文）', '内容理解（長文）', '統合理解', '主張理解（長文）', '情報検索'],
        '聴解': ['課題理解', 'ポイント理解', '概要理解', '発話表現', '即時応答', '統合理解']
    };

    var q = {
        list: [],
        loaded: false,
        level: '',
        section: '',
        status: '',
        query: '',
        errorsOnly: false,
        editing: null,   // 編集中の問題（新規は null）
        saved: ''        // 開いたときのフォームの内容（変更の確認用）
    };

    function $(id) { return document.getElementById(id); }
    var el = function (t, c, x) { return A.el(t, c, x); };

    /* ===================== ふりがな ===================== */
    // 「{漢字|よみ}」を <ruby> に、改行を <br> にして node に入れる（HTMLとしては解釈しない）
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
        if (SECTIONS.indexOf(d.section) === -1) e.push('科目を選んでください。');
        if (d.section === '聴解' && !d.audio.trim()) e.push('聴解の問題には音声ファイル名を入力してください。');
        if (d.section === '読解' && !d.passage.trim()) e.push('読解の問題には本文を入力してください。');
        if (!d.question.trim()) e.push('問題文を入力してください。');
        d.choices.forEach(function (c, i) { if (!c.trim()) e.push('選択肢' + (i + 1) + 'を入力してください。'); });
        if (['1', '2', '3', '4'].indexOf(d.answer) === -1) e.push('正解の番号を選んでください。');
        if (['公開', '下書き'].indexOf(d.status) === -1) e.push('状態を選んでください。');
        var bad = (d.passage + d.question + d.explanation + d.choices.join('')).match(/\{[^}]*$|\{[^|}]*\}/m);
        if (bad) e.push('ふりがなの書き方を確認してください：「' + bad[0].slice(0, 20) + '」（正しくは {漢字|よみ}）');
        return e;
    }

    /* ===================== 読み込み ===================== */
    function load() {
        return A.withLoading('問題を読み込んでいます', A.apiPost({ action: 'admin.questions', token: A.getToken() }))
            .then(function (res) {
                if (A.handleAuthError(res)) return;
                if (!res || !res.ok) { A.notice((res && res.message) || '問題を読み込めませんでした。', 'error'); return; }
                q.list = res.questions || [];
                q.loaded = true;
                renderList();
            })
            .catch(function (err) {
                console.error(err);
                A.notice('通信に失敗しました。「最新の情報に更新」を押して、もう一度お試しください。', 'error');
            });
    }

    /* ===================== 一覧 ===================== */
    function renderList() {
        var list = q.list;
        var withErrors = list.filter(function (x) { return x.errors && x.errors.length; });

        // メニューの数字（入力ミスの件数）
        var badge = $('navBadgeQ');
        badge.textContent = withErrors.length;
        badge.hidden = withErrors.length === 0;

        // 入力ミスのお知らせ
        $('qErrorBox').hidden = withErrors.length === 0;
        if (!withErrors.length) q.errorsOnly = false;
        $('qErrorText').textContent = '入力ミスがある問題が ' + withErrors.length + '件あります。この問題は受講生に出題されません。';
        $('qErrorToggle').textContent = q.errorsOnly ? 'すべての問題を表示' : 'ミスのある問題だけ表示';

        renderMatrix();

        // レベルのタブの数字
        var counts = { '': list.length };
        list.forEach(function (x) { counts[x.level] = (counts[x.level] || 0) + 1; });
        document.querySelectorAll('[data-qcount]').forEach(function (b) { b.textContent = counts[b.getAttribute('data-qcount')] || 0; });
        document.querySelectorAll('#qLevelTabs .tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.getAttribute('data-level') === q.level)); });
        $('qSection').value = q.section;
        $('qStatus').value = q.status;

        var word = q.query.trim().toLowerCase();
        var rows = list.filter(function (x) {
            if (q.errorsOnly && !(x.errors && x.errors.length)) return false;
            if (q.level && x.level !== q.level) return false;
            if (q.section && x.section !== q.section) return false;
            if (q.status && x.status !== q.status) return false;
            if (!word) return true;
            return (x.questionId + ' ' + x.form + ' ' + plain(x.question) + ' ' + plain(x.passage)).toLowerCase().indexOf(word) !== -1;
        });
        rows.sort(function (a, b) { return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0); });

        var tbody = $('qRows');
        tbody.replaceChildren();
        rows.forEach(function (x) {
            var tr = el('tr');
            if (x.errors && x.errors.length) tr.className = 'has-error';

            var c1 = A.td('問題ID', 'cell-id'); c1.textContent = x.questionId;
            var c2 = A.td('レベル'); c2.append(el('span', 'level-pill lv-' + x.level, x.level || '?'));
            var c3 = A.td('科目／問題形式', 'cell-section');
            var w = el('div'); w.append(el('span', 'section-tag sec-' + SECTIONS.indexOf(x.section), x.section || '—'));
            if (x.form) w.append(el('span', 'cell-sub', x.form));
            c3.append(w);

            var c4 = A.td('問題文', 'cell-question');
            var qbox = el('div');
            if (x.section === '聴解' && x.audio) qbox.append(el('span', 'audio-tag', '♪ ' + x.audio));
            qbox.append(ruby('span', 'q-text', x.question || '（問題文がありません）'));
            if (x.errors && x.errors.length) {
                var ul = el('ul', 'row-errors');
                x.errors.forEach(function (msg) { ul.append(el('li', '', msg)); });
                qbox.append(ul);
            }
            c4.append(qbox);

            var c5 = A.td('正解', 'cell-nowrap cell-answer');
            var ans = x.choices && x.choices[Number(x.answer) - 1];
            var aw = el('div');
            aw.append(el('b', 'answer-no', x.answer || '—'));
            if (ans) aw.append(ruby('span', 'cell-sub', ans));
            c5.append(aw);

            var c6 = A.td('状態'); c6.append(el('span', 'status ' + (x.status === '公開' ? 'st-active' : 'st-pending'), x.status || '—'));
            var c7 = A.td('更新日', 'cell-nowrap'); c7.textContent = A.fmt(x.updatedAt, false);

            var c8 = A.td('操作', 'col-action');
            var acts = el('div', 'actions');
            acts.append(
                A.button('編集', 'btn btn-white btn-xs', function () { openEditor(x); }),
                A.button('削除', 'btn btn-white btn-xs btn-danger', function () { removeQuestion(x); })
            );
            c8.append(acts);

            tr.append(c1, c2, c3, c4, c5, c6, c7, c8);
            tbody.append(tr);
        });
        $('qEmpty').hidden = rows.length > 0;
        $('qEmpty').textContent = list.length ? '該当する問題はありません。' : 'まだ問題がありません。「新しい問題」から作成できます。';
    }

    // 登録状況：レベル × 科目 の公開数（下書き数）
    function renderMatrix() {
        var table = $('qMatrix');
        table.replaceChildren();
        var count = {};
        q.list.forEach(function (x) {
            var k = x.level + '|' + x.section;
            count[k] = count[k] || { pub: 0, draft: 0 };
            if (x.status === '公開' && !(x.errors && x.errors.length)) count[k].pub++; else count[k].draft++;
        });

        var thead = el('thead');
        var hr = el('tr');
        hr.append(el('th', '', 'レベル'));
        SECTIONS.forEach(function (s) { hr.append(el('th', '', s)); });
        hr.append(el('th', '', '合計'));
        thead.append(hr);

        var tbody = el('tbody');
        LEVELS.forEach(function (lv) {
            var tr = el('tr');
            var th = el('th'); th.append(el('span', 'level-pill lv-' + lv, lv)); tr.append(th);
            var totalPub = 0, totalDraft = 0;
            SECTIONS.forEach(function (s) {
                var c = count[lv + '|' + s] || { pub: 0, draft: 0 };
                totalPub += c.pub; totalDraft += c.draft;
                var cell = el('td');
                var b = A.button('', 'matrix-btn' + (c.pub === 0 ? ' is-zero' : ''), function () {
                    q.level = lv; q.section = s; q.status = ''; q.errorsOnly = false;
                    renderList();
                    $('qRows').closest('.table-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
                b.setAttribute('aria-label', lv + ' ' + s + '：公開 ' + c.pub + '問、下書き ' + c.draft + '問');
                b.append(el('b', '', c.pub));
                if (c.draft) b.append(el('small', '', '（' + c.draft + '）'));
                cell.append(b);
                tr.append(cell);
            });
            var tot = el('td', 'matrix-total');
            tot.append(el('b', '', totalPub));
            if (totalDraft) tot.append(el('small', '', '（' + totalDraft + '）'));
            tr.append(tot);
            tbody.append(tr);
        });
        table.append(thead, tbody);
    }

    function removeQuestion(x) {
        A.confirmAction({
            title: 'この問題を削除しますか？',
            rows: [['問題ID', x.questionId], ['レベル', x.level], ['科目', x.section + (x.form ? '（' + x.form + '）' : '')], ['問題文', plain(x.question).slice(0, 60)]],
            text: '削除した問題は元にもどせません。受講生に出題したくないだけなら、「編集」で「下書き」にする方法もあります。',
            ok: '削除する'
        }).then(function (r) {
            if (!r) return;
            A.withLoading('削除しています', A.apiPost({ action: 'admin.deleteQuestion', token: A.getToken(), questionId: x.questionId }))
                .then(function (res) {
                    if (A.handleAuthError(res)) return;
                    if (!res || !res.ok) { A.notice((res && res.message) || '削除できませんでした。', 'error'); return; }
                    A.notice(x.questionId + ' を削除しました。', 'ok');
                    return load();
                })
                .catch(function (err) {
                    console.error(err);
                    A.notice('通信に失敗しました。削除されたかどうか、「最新の情報に更新」で確認してください。', 'error');
                });
        });
    }

    /* ===================== 作成・編集 ===================== */
    function form() { return $('qForm'); }

    function readForm() {
        var f = form().elements;
        var checked = function (name) { var c = form().querySelector('input[name="' + name + '"]:checked'); return c ? c.value : ''; };
        return {
            questionId: q.editing ? q.editing.questionId : '',
            level: f.level.value,
            section: f.section.value,
            form: f.form.value.trim(),
            passage: f.passage.value,
            audio: f.section.value === '聴解' ? f.audio.value.trim() : '',
            question: f.question.value,
            choices: [f.choice1.value, f.choice2.value, f.choice3.value, f.choice4.value],
            answer: checked('answer'),
            explanation: f.explanation.value,
            status: checked('status')
        };
    }

    function fillForm(d) {
        var f = form().elements;
        f.level.value = d.level || 'N4';
        f.section.value = d.section || '文字・語彙';
        f.form.value = d.form || '';
        f.passage.value = d.passage || '';
        f.audio.value = d.audio || '';
        f.question.value = d.question || '';
        ['choice1', 'choice2', 'choice3', 'choice4'].forEach(function (n, i) { f[n].value = (d.choices || [])[i] || ''; });
        form().querySelectorAll('input[name="answer"]').forEach(function (r) { r.checked = r.value === String(d.answer || ''); });
        form().querySelectorAll('input[name="status"]').forEach(function (r) { r.checked = r.value === (d.status || '下書き'); });
        $('qFormErrors').hidden = true;
        onSectionChange();
        renderPreview();
    }

    function openEditor(x, keep) {
        q.editing = x || null;
        $('qEditTitle').textContent = x ? '問題を編集（' + x.questionId + '）' : '新しい問題';
        $('qSaveNext').hidden = !!x;
        fillForm(x || keep || {});
        q.saved = JSON.stringify(readForm());
        A.notice('');
        A.switchView('questionEdit');
        if (!x) form().elements.question.focus({ preventScroll: true });
    }

    function isDirty() { return JSON.stringify(readForm()) !== q.saved; }

    function onSectionChange() {
        var f = form().elements;
        var s = f.section.value;
        $('qAudioField').hidden = s !== '聴解';

        var label = { '読解': '本文', '聴解': 'スクリプト' }[s] || '本文';
        var req = s === '読解' ? ' <em class="req">必須</em>' : ' <em>任意</em>';
        $('qPassageLabel').innerHTML = label + req;
        $('qPassageHint').textContent = {
            '読解': '読む文章を入力します。',
            '聴解': '音声の内容（スクリプト）。受講生には、解答したあとに表示します。',
            '文法': '「文章の文法」のように、文章を読んで答える問題のときに入力します。',
            '文字・語彙': 'ふつうは空欄で大丈夫です。'
        }[s] || '';

        var dl = $('qFormList');
        dl.replaceChildren();
        (FORMS[s] || []).forEach(function (v) { var o = document.createElement('option'); o.value = v; dl.append(o); });
    }

    // 受講生の画面に近い見え方
    function renderPreview() {
        var d = readForm();
        var box = $('qPreview');
        box.replaceChildren();

        var meta = el('p', 'pv-meta');
        meta.append(el('span', 'level-pill lv-' + d.level, d.level), el('span', 'section-tag sec-' + SECTIONS.indexOf(d.section), d.section));
        if (d.form) meta.append(el('span', 'pv-form', d.form));
        box.append(meta);

        if (d.section === '聴解') {
            var au = el('div', 'pv-audio');
            if (d.audio) {
                var audio = document.createElement('audio');
                audio.controls = true;
                audio.preload = 'none';
                audio.src = AUDIO_DIR + encodeURIComponent(d.audio);
                var miss = el('small', 'pv-warn', 'この音声ファイルが見つかりません（frontend/user/audio/' + d.audio + '）。アップロードがまだなら、このままでも保存はできます。');
                miss.hidden = true;
                audio.addEventListener('error', function () { miss.hidden = false; });
                au.append(audio, miss);
            } else {
                au.append(el('small', 'pv-warn', '音声ファイル名を入力すると、ここで再生できます。'));
            }
            box.append(au);
        }

        if (d.passage.trim() && d.section !== '聴解') box.append(ruby('div', 'pv-passage', d.passage));
        box.append(ruby('p', 'pv-question', d.question || '（問題文）'));

        var ol = el('ol', 'pv-choices');
        d.choices.forEach(function (c, i) {
            var li = el('li', d.answer === String(i + 1) ? 'is-answer' : '');
            li.append(el('span', 'pv-no', String(i + 1)), ruby('span', '', c || '（選択肢' + (i + 1) + '）'));
            ol.append(li);
        });
        box.append(ol);

        var ex = el('div', 'pv-explain');
        ex.append(el('p', 'pv-explain-title', '解説'));
        ex.append(d.explanation.trim() ? ruby('div', '', d.explanation) : el('p', 'pv-muted', '（解説はまだありません）'));
        if (d.section === '聴解' && d.passage.trim()) {
            ex.append(el('p', 'pv-explain-title', 'スクリプト'));
            ex.append(ruby('div', 'pv-script', d.passage));
        }
        box.append(ex);

        box.append(el('p', 'pv-status', d.status === '公開' ? '保存すると、受講生に出題されます。' : '下書きは、受講生には出題されません。'));
    }

    function save(next) {
        var d = readForm();
        var errors = validate(d);
        var box = $('qFormErrors');
        box.replaceChildren();
        if (errors.length) {
            errors.forEach(function (m) { box.append(el('li', '', m)); });
            box.hidden = false;
            box.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        box.hidden = true;

        A.withLoading('保存しています', A.apiPost({ action: 'admin.saveQuestion', token: A.getToken(), question: d }))
            .then(function (res) {
                if (A.handleAuthError(res)) return;
                if (!res || !res.ok) {
                    (res && res.errors ? res.errors : [(res && res.message) || '保存できませんでした。']).forEach(function (m) { box.append(el('li', '', m)); });
                    box.hidden = false;
                    return;
                }
                var msg = res.questionId + ' を' + (res.created ? '作成' : '更新') + 'しました（' + d.status + '）。';
                q.saved = JSON.stringify(readForm()); // 保存済み
                if (next) {
                    // レベル・科目・問題形式・状態はそのままで、次の問題へ
                    openEditor(null, { level: d.level, section: d.section, form: d.form, status: d.status, audio: '' });
                    A.notice(msg + ' 続けて次の問題を作成できます。', 'ok');
                    load();
                } else {
                    A.switchView('questions', null, true);
                    A.notice(msg, 'ok');
                    load();
                }
            })
            .catch(function (err) {
                console.error(err);
                A.notice('通信に失敗しました。保存されたかどうか、問題の一覧で確認してください。', 'error');
            });
    }

    /* ---------- ふりがなを付ける ---------- */
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
            var ins = '{' + base + '|' + reading + '}';
            ta.setRangeText(ins, start, end, 'end');
            ta.focus();
            renderPreview();
        };
        dlg.showModal();
        $('rubyReading').focus();
    }

    /* ===================== 準備 ===================== */
    function init() {
        $('qReload').addEventListener('click', function () { A.notice(''); load(); });
        $('qNew').addEventListener('click', function () {
            openEditor(null, { level: q.level || 'N4', section: q.section || '文字・語彙', status: '下書き' });
        });
        $('qLevelTabs').addEventListener('click', function (e) {
            var t = e.target.closest('.tab');
            if (!t) return;
            q.level = t.getAttribute('data-level');
            renderList();
        });
        $('qSection').addEventListener('change', function (e) { q.section = e.target.value; renderList(); });
        $('qStatus').addEventListener('change', function (e) { q.status = e.target.value; renderList(); });
        $('qSearch').addEventListener('input', function (e) { q.query = e.target.value; renderList(); });
        $('qErrorToggle').addEventListener('click', function () { q.errorsOnly = !q.errorsOnly; renderList(); });

        var f = form();
        f.addEventListener('input', renderPreview);
        f.addEventListener('change', renderPreview);
        f.elements.section.addEventListener('change', onSectionChange);
        f.addEventListener('submit', function (e) {
            e.preventDefault();
            save(e.submitter && e.submitter.value === 'next');
        });
        $('qCancel').addEventListener('click', function () { A.switchView('questions'); });
        $('qBack').addEventListener('click', function () { A.switchView('questions'); });
        f.querySelectorAll('[data-ruby]').forEach(function (b) {
            // ボタンを押してもテキストの選択が外れないようにする
            b.addEventListener('mousedown', function (e) { e.preventDefault(); });
            b.addEventListener('click', function () { addRuby(b.getAttribute('data-ruby')); });
        });
        $('previewRuby').addEventListener('change', function (e) {
            $('qPreview').classList.toggle('ruby-off', !e.target.checked);
        });

        // 保存していない変更があるときは、ページを閉じる前に確認
        window.addEventListener('beforeunload', function (e) {
            if (!$('appView').hidden && !document.querySelector('.view[data-view="questionEdit"]').hidden && isDirty()) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    A.registerView('questions', {
        onShow: function () { if (!q.loaded) load(); else renderList(); }
    });
    A.registerView('questionEdit', {
        beforeLeave: function () {
            if (!isDirty()) return Promise.resolve(true);
            return A.confirmAction({
                title: '保存していない変更があります',
                text: 'このまま移動すると、入力した内容は保存されません。',
                ok: '保存せずに移動する'
            }).then(function (r) { return !!r; });
        }
    });
    A.registerView('_questionsData', {
        onLogout: function () { q.list = []; q.loaded = false; q.editing = null; q.saved = ''; }
    });

    document.addEventListener('DOMContentLoaded', init);
})();
