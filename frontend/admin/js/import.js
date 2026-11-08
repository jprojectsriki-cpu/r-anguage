/* R-ANGUAGE 管理画面：まとめて登録（問題・単語カード）
 * - テンプレートの行をコピーして貼り付け → チェック（GAS の dryRun）→ エラーがなければ登録
 * - テンプレートは Googleスプレッドシート（GAS の createImportTemplates で作る。URL は admin.importTemplates で受け取る）
 * - スプレッドシートからコピーした文字（タブ区切り。改行や " を含むセルは " で囲まれる）を読み取る
 * - 問題の音声ファイルは、GitHub Pages の frontend/user/audio/ にあるかも確かめる（ないときは注意）
 * ※ admin.js のあとに読み込むこと（window.RAdmin を使う）
 */
(function () {
    'use strict';

    var A = window.RAdmin;
    var el = function (t, c, x) { return A.el(t, c, x); };
    var KINDS = {
        questions: {
            label: '問題',
            cols: 13,
            first: 'レベル',
            action: 'admin.importQuestions',
            urlKey: 'questions',
            templateText: 'テンプレート（Googleスプレッドシート「R-ANGUAGE 問題テンプレート」）の「問題」シートに、1行に1問ずつ書きます。「書き方」と「記入例」のシートも見てください。「問題形式」は「問題形式の一覧」シートの名前と同じにします（ちがうと出題されません）。',
            pasteText: '「問題」シートの A列（レベル）〜 M列（状態）の、書いた行を選んでコピー（Ctrl+C）して、下に貼り付けます（Ctrl+V）。見出しの行がまざっていてもかまいません。1回 500行まで。',
            head: ['行', 'レベル', '科目・問題形式', '問題文', '状態', 'チェック']
        },
        cards: {
            label: '単語カード',
            cols: 7,
            first: 'レベル',
            action: 'admin.importCards',
            urlKey: 'cards',
            templateText: 'テンプレート（Googleスプレッドシート「R-ANGUAGE 単語カードテンプレート」）の「単語カード」シートに、1行に1枚ずつ書きます。「書き方」と「記入例」のシートも見てください。',
            pasteText: '「単語カード」シートの A列（レベル）〜 G列（状態）の、書いた行を選んでコピー（Ctrl+C）して、下に貼り付けます（Ctrl+V）。見出しの行がまざっていてもかまいません。1回 500行まで。',
            head: ['行', 'レベル', '単語・読み', '英語の意味', '状態', 'チェック']
        }
    };
    var S = { kind: 'questions', rows: null, checked: null, urls: null };

    function $(id) { return document.getElementById(id); }

    /** タブ区切りの文字を、行と列に分ける（" で囲まれたセルの中の改行・タブ・"" に対応） */
    function parseTsv(text) {
        var rows = [], row = [], cell = '', i = 0, q = false;
        text = String(text || '').replace(/\r\n?/g, '\n');
        while (i < text.length) {
            var ch = text.charAt(i);
            if (q) {
                if (ch === '"') {
                    if (text.charAt(i + 1) === '"') { cell += '"'; i += 2; continue; }
                    q = false; i++; continue;
                }
                cell += ch; i++; continue;
            }
            if (ch === '"' && cell === '') { q = true; i++; continue; }
            if (ch === '\t') { row.push(cell); cell = ''; i++; continue; }
            if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
            cell += ch; i++;
        }
        if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
        return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    }

    function setKind(kind) {
        S.kind = kind;
        var k = KINDS[kind];
        document.querySelectorAll('#imTabs .tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.getAttribute('data-kind') === kind)); });
        $('imTemplateText').textContent = k.templateText;
        $('imPasteText').textContent = k.pasteText;
        drawTemplateLink();
        reset();
    }

    function reset() {
        S.rows = null;
        S.checked = null;
        $('imResult').hidden = true;
        $('imSave').disabled = true;
    }

    /** テンプレートを開くボタン（まだ作っていないときは、作り方を出す） */
    function drawTemplateLink() {
        var k = KINDS[S.kind];
        var link = $('imTemplate');
        var none = $('imTemplateNone');
        var url = S.urls ? S.urls[k.urlKey] : '';
        link.hidden = !url;
        none.hidden = !!url || !S.urls;
        if (url) link.href = url;
    }

    function loadTemplates() {
        A.apiPost({ action: 'admin.importTemplates', token: A.getToken() }).then(function (res) {
            if (A.handleAuthError(res)) return;
            S.urls = res && res.ok ? { questions: res.questions, cards: res.cards } : { questions: '', cards: '' };
            drawTemplateLink();
        }).catch(function (err) { console.error(err); });
    }

    /** チェックする（登録はしない） */
    function check() {
        var k = KINDS[S.kind];
        var rows = parseTsv($('imPaste').value);
        if (rows.length && String(rows[0][0]).trim() === k.first) rows.shift(); // 見出しの行
        if (!rows.length) { A.notice('貼り付けた行がありません。テンプレートの行をコピーして貼り付けてください。', 'error'); return; }
        var wrongCols = rows.filter(function (r) { return r.length !== k.cols; }).length;
        if (wrongCols === rows.length) {
            A.notice('列の数が合いません（' + k.label + 'は ' + k.cols + '列）。テンプレートの A列〜' + String.fromCharCode(64 + k.cols) + '列を選んでコピーしてください。', 'error');
            return;
        }
        rows = rows.map(function (r) { r = r.slice(0, k.cols); while (r.length < k.cols) r.push(''); return r; });
        S.rows = rows;
        A.notice('');
        A.withLoading(rows.length + '行をチェックしています', A.apiPost({ action: k.action, token: A.getToken(), rows: rows, dryRun: true }))
            .then(function (res) {
                if (A.handleAuthError(res)) return;
                if (!res || !res.ok) { A.notice((res && res.message) || 'チェックできませんでした。', 'error'); return; }
                S.checked = res;
                draw(res);
                if (S.kind === 'questions') checkAudio(res);
            })
            .catch(function (err) {
                console.error(err);
                A.notice('通信に失敗しました。もう一度お試しください。', 'error');
            });
    }

    function draw(res) {
        var k = KINDS[S.kind];
        var trh = el('tr');
        k.head.forEach(function (x) { trh.append(el('th', '', x)); });
        $('imHead').replaceChildren(trh);
        var tbody = $('imRows');
        tbody.replaceChildren();
        res.rows.forEach(function (r) {
            var tr = el('tr', r.errors.length ? 'is-error' : r.warnings.length ? 'is-warn' : '');
            tr.setAttribute('data-row', String(r.row));
            var c1 = A.td('行', 'cell-id'); c1.textContent = String(r.row);
            var c2 = A.td('レベル'); c2.textContent = r.level || '—';
            var c3 = A.td(k.head[2]);
            var c4 = A.td(k.head[3], 'im-text-cell');
            if (S.kind === 'questions') {
                c3.append(el('span', '', r.section || '—'), el('span', 'cell-sub', r.form || ''));
                c4.textContent = r.text;
                if (r.audio) c4.append(el('span', 'cell-sub', '音声：' + r.audio));
            } else {
                c3.append(el('span', '', r.word || '—'), el('span', 'cell-sub', r.reading || ''));
                c4.textContent = r.text;
            }
            var c5 = A.td('状態'); c5.textContent = r.status;
            var c6 = A.td('チェック', 'im-check');
            c6.append(checkCell(r.errors, r.warnings));
            tr.append(c1, c2, c3, c4, c5, c6);
            tbody.append(tr);
        });
        summary();
        $('imResult').hidden = false;
        $('imResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function checkCell(errors, warnings) {
        var box = el('div', 'im-msgs');
        if (!errors.length && !warnings.length) box.append(el('span', 'im-ok', 'OK'));
        errors.forEach(function (m) { box.append(el('span', 'im-err', m)); });
        warnings.forEach(function (m) { box.append(el('span', 'im-warn', m)); });
        return box;
    }

    function summary() {
        var res = S.checked;
        var warnRows = res.rows.filter(function (r) { return !r.errors.length && r.warnings.length; }).length;
        var text = '全部で ' + res.total + '行　エラー ' + res.errorRows + '行　注意 ' + warnRows + '行';
        if (res.errorRows) text += '　→ エラーの行を直してから、もう一度コピーして貼り付けてください（エラーがあると1行も登録しません）。';
        else if (warnRows) text += '　→ 注意の行も、このまま登録できます。';
        else text += '　→ 登録できます。';
        $('imSummary').textContent = text;
        $('imSummary').className = 'im-summary ' + (res.errorRows ? 'is-error' : 'is-ok');
        $('imSave').disabled = !!res.errorRows;
        $('imSave').textContent = res.total + '行を登録する';
    }

    /** 音声ファイルが GitHub Pages にあるか（ないときは注意を足す） */
    function checkAudio(res) {
        var names = {};
        res.rows.forEach(function (r) { if (r.audio) names[r.audio] = true; });
        Object.keys(names).forEach(function (name) {
            fetch('../user/audio/' + encodeURIComponent(name), { method: 'HEAD', cache: 'no-store' })
                .then(function (r) { return r.ok; }, function () { return false; })
                .then(function (found) {
                    if (found || S.checked !== res) return;
                    res.rows.forEach(function (r) {
                        if (r.audio !== name) return;
                        var msg = '音声ファイル「' + name + '」が見つかりません（frontend/user/audio/ に入れて push しましたか？）。登録はできます。';
                        if (r.warnings.indexOf(msg) >= 0) return;
                        r.warnings.push(msg);
                        var tr = document.querySelector('#imRows tr[data-row="' + r.row + '"]');
                        if (!tr) return;
                        if (!r.errors.length) tr.className = 'is-warn';
                        tr.querySelector('.im-check').replaceChildren(checkCell(r.errors, r.warnings));
                    });
                    summary();
                });
        });
    }

    /** 登録する */
    function save() {
        var k = KINDS[S.kind];
        var res = S.checked;
        if (!res || res.errorRows || !S.rows) return;
        A.confirmAction({
            title: k.label + 'を ' + res.total + '行 登録しますか？',
            rows: [['登録するもの', k.label], ['行の数', res.total + '行'], ['状態が「公開」の行', res.rows.filter(function (r) { return r.status === '公開'; }).length + '行（すぐに受講生に出ます）']],
            text: '状態が「下書き」の行は、受講生には出ません。「' + k.label + '」のページで確かめてから「公開」にしてください。',
            ok: '登録する'
        }).then(function (yes) {
            if (!yes) return;
            A.withLoading(res.total + '行を登録しています', A.apiPost({ action: k.action, token: A.getToken(), rows: S.rows, dryRun: false }))
                .then(function (r) {
                    if (A.handleAuthError(r)) return;
                    if (!r || !r.ok) { A.notice((r && r.message) || '登録できませんでした。', 'error'); return; }
                    if (!r.saved) { S.checked = r; draw(r); A.notice('エラーがあったので、登録しませんでした。結果を見て直してください。', 'error'); return; }
                    A.notice(k.label + 'を ' + r.saved + '行 登録しました。「' + k.label + '」のページで確かめられます。', 'ok');
                    $('imPaste').value = '';
                    reset();
                })
                .catch(function (err) {
                    console.error(err);
                    A.notice('通信に失敗しました。登録されたかどうか、「' + k.label + '」のページで確かめてから、もう一度お試しください（同じ行は2回登録されません）。', 'error');
                });
        });
    }

    function init() {
        document.querySelectorAll('#imTabs .tab').forEach(function (t) {
            t.addEventListener('click', function () { setKind(t.getAttribute('data-kind')); });
        });
        $('imCheck').addEventListener('click', check);
        $('imClear').addEventListener('click', function () { $('imPaste').value = ''; reset(); A.notice(''); });
        $('imPaste').addEventListener('input', reset);
        $('imSave').addEventListener('click', save);
        setKind('questions');
    }

    A.registerView('import', { onShow: function () { if (!S.urls) loadTemplates(); } }); // 貼り付けた内容は残す
    document.addEventListener('DOMContentLoaded', init);
})();
