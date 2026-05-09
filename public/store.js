(function ($) {
    'use strict';

    if (!window.ccPacksStore) return;

    var api      = ccPacksStore.apiUrl;
    var nonce    = ccPacksStore.nonce;
    var sbcFeed  = ccPacksStore.sbcFeed;
    var selected  = {};   // pack_id → true/false (toggle)
    var packsCache = [];
    var feedCache  = null;

    function apiFetch(url, options) {
        options = options || {};
        options.headers = options.headers || {};
        options.headers['X-WP-Nonce'] = nonce;
        return fetch(url, options);
    }

    function getFeed() {
        if (feedCache) return Promise.resolve(feedCache);
        return fetch(sbcFeed)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                feedCache = Array.isArray(data) ? data : (data.data || data.items || []);
                return feedCache;
            });
    }

    function thumbFor(dme) {
        if (dme.is_player && dme.player_preview && dme.player_preview.face_img)
            return dme.player_preview.face_img;
        if (dme.reward_img) return dme.reward_img;
        return '';
    }

    /* ---- barra inferior ---- */
    function updateBar() {
        var ids   = Object.keys(selected).filter(function (k) { return selected[k]; });
        var total = 0;
        ids.forEach(function (pid) {
            var p = packsCache.find(function (x) { return String(x.id) === pid; });
            if (p) total += parseFloat(p.price);
        });
        if (ids.length) {
            $('#cc-store-bar').css('display', 'flex');
            $('#cc-bar-summary').html(
                '<span class="cc-bar-count">' + ids.length + ' pack' + (ids.length > 1 ? 's' : '') + '</span>' +
                '<span class="cc-bar-sep">·</span>' +
                '<span class="cc-bar-total">R$ ' + total.toFixed(2).replace('.', ',') + '</span>'
            );
        } else {
            $('#cc-store-bar').hide();
        }
    }

    /* ---- grid de packs ---- */
    function renderGrid(packs) {
        var $grid = $('#cc-store-grid');
        $grid.empty();
        if (!packs.length) {
            $grid.html('<p class="cc-empty">Nenhum pack disponível no momento.</p>');
            return;
        }
        packs.forEach(function (pack) {
            var pid   = String(pack.id);
            var price = parseFloat(pack.price).toFixed(2).replace('.', ',');
            var $card = $(
                '<article class="cc-pack-card" data-pack-id="' + pid + '">' +
                '  <div class="cc-pack-cover" data-pack-id="' + pid + '">' +
                '    <div class="cc-cover-loading"><span></span><span></span><span></span></div>' +
                '  </div>' +
                '  <div class="cc-pack-body">' +
                '    <h3 class="cc-pack-name">' + pack.name + '</h3>' +
                '    <div class="cc-pack-row">' +
                '      <span class="cc-pack-price">R$ ' + price + '</span>' +
                '      <button class="cc-btn-add" data-pack-id="' + pid + '">Adicionar</button>' +
                '    </div>' +
                '    <button class="cc-btn-detail" data-pack-id="' + pid + '">Ver conteúdo →</button>' +
                '  </div>' +
                '</article>'
            );
            $grid.append($card);
            fillCover(pid, pack.dme_ids || []);
        });
    }

    function fillCover(packId, dmeIds) {
        var $cover = $('.cc-pack-cover[data-pack-id="' + packId + '"]');
        if (!dmeIds.length) { $cover.html('<div class="cc-cover-empty"></div>'); return; }
        getFeed().then(function (items) {
            var ids   = dmeIds.map(String);
            var found = items.filter(function (d) { return ids.indexOf(String(d.id)) !== -1; });
            $cover.empty();
            found.slice(0, 4).forEach(function (dme) {
                var src = thumbFor(dme);
                if (src) $cover.append('<img class="cc-cover-img" src="' + src + '" alt="' + (dme.name || '') + '">');
            });
            if (!$cover.children().length) $cover.html('<div class="cc-cover-empty"></div>');
        });
    }

    /* ---- toggle adicionar / remover ---- */
    $(document).on('click', '.cc-btn-add', function () {
        var pid = String($(this).data('pack-id'));
        selected[pid] = true;
        $(this)
            .text('Remover')
            .removeClass('cc-btn-add')
            .addClass('cc-btn-remove');
        $('.cc-pack-card[data-pack-id="' + pid + '"]').addClass('is-selected');
        updateBar();
    });

    $(document).on('click', '.cc-btn-remove', function () {
        var pid = String($(this).data('pack-id'));
        selected[pid] = false;
        $(this)
            .text('Adicionar')
            .removeClass('cc-btn-remove')
            .addClass('cc-btn-add');
        $('.cc-pack-card[data-pack-id="' + pid + '"]').removeClass('is-selected');
        updateBar();
    });

    /* ---- modal "ver conteúdo" ---- */
    $(document).on('click', '.cc-btn-detail', function () {
        openPackModal($(this).data('pack-id'));
    });

    function openPackModal(packId) {
        var pack = packsCache.find(function (p) { return String(p.id) === String(packId); });
        if (!pack) return;
        var dmeIds = (pack.dme_ids || []).map(String);

        var $overlay = $(
            '<div class="cc-modal-overlay" id="cc-pack-modal">' +
            '  <div class="cc-modal-box">' +
            '    <button class="cc-modal-close" aria-label="Fechar">✕</button>' +
            '    <div class="cc-modal-header">' +
            '      <h2 class="cc-modal-title">' + pack.name + '</h2>' +
            '      <span class="cc-modal-price">R$ ' + parseFloat(pack.price).toFixed(2).replace('.', ',') + '</span>' +
            '    </div>' +
            '    <div class="cc-modal-cards" id="cc-modal-cards">' +
            '      <div class="cc-cards-loading">Carregando jogadores...</div>' +
            '    </div>' +
            '  </div>' +
            '</div>'
        );
        $('body').append($overlay);

        $overlay.on('click', function (e) {
            if ($(e.target).hasClass('cc-modal-overlay') || $(e.target).hasClass('cc-modal-close')) {
                $overlay.remove();
            }
        });

        getFeed().then(function (items) {
            var found = items.filter(function (d) { return dmeIds.indexOf(String(d.id)) !== -1; });
            if (!found.length) { $('#cc-modal-cards').html('<p class="cc-modal-empty">Nenhum conteúdo encontrado.</p>'); return; }

            return apiFetch(api + '/render-cards', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ items: found }),
            })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res.css && !$('#cc-fc-card-css').length) {
                    $('head').append('<style id="cc-fc-card-css">' + res.css + '</style>');
                }
                var $cont  = $('#cc-modal-cards');
                var cards  = res.cards || {};
                $cont.empty();
                found.forEach(function (dme) {
                    var id   = String(dme.id);
                    var html = cards[id] || '';
                    var $item = $('<div class="cc-modal-dme-item">');
                    if (html) $item.append('<div class="cc-modal-card-wrap">' + html + '</div>');
                    $item.append('<p class="cc-dme-name">' + (dme.name || 'DME') + '</p>');

                    var challenges = dme.challenges || [];
                    if (challenges.length) {
                        var $btn = $('<button class="cc-btn-lineups" data-dme-id="' + id + '">Ver elencos (' + challenges.length + ')</button>');
                        var $sub = $('<div class="cc-lineups-wrap" data-dme-id="' + id + '" style="display:none">');
                        challenges.forEach(function (c) {
                            var cimg = c.img_url || '';
                            var cval = c.price_ps ? 'PS: ' + c.price_ps : (c.price_pc ? 'PC: ' + c.price_pc : '');
                            $sub.append(
                                '<div class="cc-lineup-item">' +
                                (cimg ? '<img src="' + cimg + '" class="cc-lineup-img">' : '') +
                                '<span class="cc-lineup-name">' + (c.name || c.title || '') + '</span>' +
                                (cval ? '<span class="cc-lineup-val">' + cval + '</span>' : '') +
                                '</div>'
                            );
                        });
                        $item.append($btn).append($sub);
                    }
                    $cont.append($item);
                });

                $cont.on('click', '.cc-btn-lineups', function () {
                    var id   = $(this).data('dme-id');
                    var $sub = $('.cc-lineups-wrap[data-dme-id="' + id + '"]');
                    $sub.toggle();
                    $(this).text($sub.is(':visible')
                        ? 'Fechar elencos'
                        : 'Ver elencos (' + $sub.children().length + ')'
                    );
                });
            });
        }).catch(function () {
            $('#cc-modal-cards').html('<p class="cc-modal-empty">Erro ao carregar conteúdo.</p>');
        });
    }

    /* ---- checkout ---- */
    $(document).on('click', '#cc-bar-checkout', function () {
        var ids = Object.keys(selected).filter(function (k) { return selected[k]; });
        if (!ids.length) return;
        var composition = ids.map(function (pid) { return { pack_id: parseInt(pid, 10), qty: 1 }; });
        var $btn = $(this);
        $btn.prop('disabled', true).text('Aguarde...');
        apiFetch(api + '/session', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ composition: composition }),
        })
        .then(function (r) { return r.json(); })
        .then(function (res) {
            if (res.redirect) {
                window.location.href = res.redirect;
            } else {
                alert('Erro ao processar pedido.');
                $btn.prop('disabled', false).text('Finalizar Pedido');
            }
        });
    });

    /* ---- init ---- */
    $(document).ready(function () {
        apiFetch(api + '/packs')
            .then(function (r) { return r.json(); })
            .then(function (res) {
                packsCache = res.data || [];
                renderGrid(packsCache);
            });
    });

}(jQuery));
