/* R-anguage 共通ローディング（全画面で共通）
 *   RLoading.show('<ruby>送信<rt>そうしん</rt></ruby>しています')  … 表示（文字はふりがな付きのHTMLも可）
 *   RLoading.hide().then(...)                                … 非表示（最低表示時間を守ってから消える）
 * ※ show に渡す文字は、プログラム内で決めた固定の文字だけにすること（入力された値は渡さない）
 */
window.RLoading = (function () {
    'use strict';

    var MIN_SHOW_MS = 700; // 一瞬で消えてチラつかないよう、最低限表示する時間
    var dlg = null;
    var label = null;
    var shownAt = 0;

    function build() {
        dlg = document.createElement('dialog');
        dlg.className = 'rl-loading';
        dlg.setAttribute('aria-live', 'polite');
        dlg.innerHTML =
            '<div class="rl-card" role="status">' +
                '<div class="rl-tiles" aria-hidden="true">' +
                    '<span class="rl-tile">L</span><span class="rl-tile">O</span>' +
                    '<span class="rl-tile">A</span><span class="rl-tile">D</span>' +
                    '<span class="rl-tile">I</span>' +'<span class="rl-tile">N</span>' +'<span class="rl-tile">G</span>' +
                '</div>' +
                '<p class="rl-label"><span class="rl-text"></span>' +
                    '<span class="rl-dots" aria-hidden="true"><i></i><i></i><i></i></span></p>' +
                '<div class="rl-bar" aria-hidden="true"></div>' +
                '<p class="rl-sub">そのままお<ruby>待<rt>ま</rt></ruby>ちください</p>' +
            '</div>';
        // Esc キーで閉じられないようにする（処理中に消えると混乱するため）
        dlg.addEventListener('cancel', function (e) { e.preventDefault(); });
        document.body.appendChild(dlg);
        label = dlg.querySelector('.rl-text');
    }

    function show(html) {
        if (!dlg) build();
        label.innerHTML = html || '<ruby>読<rt>よ</rt></ruby>み<ruby>込<rt>こ</rt></ruby>み<ruby>中<rt>ちゅう</rt></ruby>';
        shownAt = Date.now();
        dlg.classList.remove('is-leaving');
        if (!dlg.open) {
            if (typeof dlg.showModal === 'function') dlg.showModal();
            else dlg.setAttribute('open', '');
        }
    }

    function hide() {
        return new Promise(function (resolve) {
            if (!dlg || !dlg.open) { resolve(); return; }
            var wait = Math.max(0, MIN_SHOW_MS - (Date.now() - shownAt));
            window.setTimeout(function () {
                dlg.classList.add('is-leaving');
                window.setTimeout(function () {
                    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
                    dlg.classList.remove('is-leaving');
                    resolve();
                }, 200);
            }, wait);
        });
    }

    return { show: show, hide: hide };
})();
