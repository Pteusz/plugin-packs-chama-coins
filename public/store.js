(function ($) {
    'use strict';

    if (!window.ccPacksStore) return;

    var api     = ccPacksStore.apiUrl;
    var nonce   = ccPacksStore.nonce;
    var sbcFeed = ccPacksStore.sbcFeed;
    var qty     = {};
    var packsCache = [];

    function apiFetch(url, options) {
        options = options || {};
        options.headers = options.headers || {};
        options.headers['X-WP-Nonce'] = nonce;
        return fetch(url, options);
    }

    function updateBar() {
        var count = 0;
        var total = 0;
        packsCache.forEach(function (pack) {
            var q = qty[pack.id] || 0;
            count += q;
            total += q * parseFloat(pack.price);
        });
        if (count > 0) {
            $('#cc-store-bar').css('display', 'flex');
            $('#cc-bar-summary').text(count + ' pack(s) — R$ ' + total.toFixed(2).replace('.', ','));
        } else {
            $('#cc-store-bar').hide();
        }
    }

    function renderCards(packs) {
        var $grid = $('#cc-store-grid');
        $grid.empty();
        packs.forEach(function (pack) {
            var price = parseFloat(pack.price).toFixed(2).replace('.', ',');
            var dmeIds = pack.dme_ids || [];
            $grid.append(
                '<div class="cc-pack-card" data-pack-id="' + pack.id + '" data-price="' + pack.price + '">' +
                '<h3>' + pack.name + '</h3>' +
                '<p class="cc-pack-price">R$ ' + price + '</p>' +
                '<div class="cc-dme-thumbs" data-pack-id="' + pack.id + '"></div>' +
                '<button class="cc-view-pack button" data-pack-id="' + pack.id + '">Ver Pack</button>' +
                '<div class="cc-qty-controls">' +
                '<button class="cc-qty-minus" data-pack-id="' + pack.id + '">-</button>' +
                '<span class="cc-qty-display" data-pack-id="' + pack.id + '">0</span>' +
                '<button class="cc-qty-plus" data-pack-id="' + pack.id + '">+</button>' +
                '</div></div>'
            );
            fillThumbs(pack.id, dmeIds);
        });
    }

    function fillThumbs(packId, dmeIds) {
        if (!dmeIds.length) return;
        fetch(sbcFeed)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var items = Array.isArray(data) ? data : (data.items || data.data || []);
                var ids   = dmeIds.map(String);
                var found = items.filter(function (d) { return ids.indexOf(String(d.id || d.dme_id || '')) !== -1; });
                var $thumbs = $('.cc-dme-thumbs[data-pack-id="' + packId + '"]');
                found.slice(0, 4).forEach(function (dme) {
                    if (dme.reward_img) {
                        $thumbs.append('<img src="' + dme.reward_img + '" alt="' + (dme.name || '') + '" style="width:48px;height:48px;object-fit:cover;border-radius:4px;margin:2px">');
                    }
                });
            });
    }

    function openPackModal(packId) {
        var pack = packsCache.find(function (p) { return p.id == packId; });
        if (!pack) return;
        var dmeIds = (pack.dme_ids || []).map(String);

        var $modal = $(
            '<div class="cc-modal" id="cc-pack-modal">' +
            '<div class="cc-modal-box">' +
            '<h2>' + pack.name + '</h2>' +
            '<button id="cc-modal-close" class="button" style="float:right;margin-top:-32px">&#x2715;</button>' +
            '<div id="cc-modal-dmes"><em>Carregando DMEs...</em></div>' +
            '</div></div>'
        );
        $('body').append($modal);

        $modal.on('click', '#cc-modal-close', function () { $modal.remove(); });
        $modal.on('click', function (e) { if ($(e.target).is($modal)) $modal.remove(); });

        fetch(sbcFeed)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var items = Array.isArray(data) ? data : (data.items || data.data || []);
                var dmes  = items.filter(function (d) { return dmeIds.indexOf(String(d.id || d.dme_id || '')) !== -1; });
                var $cont = $('#cc-modal-dmes');
                $cont.empty();
                if (!dmes.length) { $cont.html('<p>Nenhum DME encontrado.</p>'); return; }
                dmes.forEach(function (dme) {
                    var id    = String(dme.id || dme.dme_id || '');
                    var name  = dme.name || dme.title || id;
                    var img   = dme.reward_img ? '<img src="' + dme.reward_img + '" style="max-width:60px;vertical-align:middle;margin-right:8px">' : '';
                    $cont.append(
                        '<div class="cc-dme-preview-item" style="margin-bottom:10px">' +
                        img + '<strong>' + name + '</strong> ' +
                        '<button class="cc-view-lineups button button-small" data-dme-id="' + id + '" data-feed-item=\'' + JSON.stringify(dme) + '\'>Ver Elencos</button>' +
                        '<div class="cc-lineups-list" data-dme-id="' + id + '" style="display:none;margin-top:6px;padding-left:16px"></div>' +
                        '</div>'
                    );
                });
            });

        $modal.on('click', '.cc-view-lineups', function () {
            var dmeId = $(this).data('dme-id');
            var dme   = $(this).data('feed-item');
            var $sub  = $('.cc-lineups-list[data-dme-id="' + dmeId + '"]');
            if ($sub.is(':visible')) { $sub.hide(); return; }
            $sub.show().empty();
            var challenges = dme.challenges || dme.lineups || dme.elencos || [];
            if (!challenges.length) { $sub.html('<em>Nenhum elenco disponível.</em>'); return; }
            challenges.forEach(function (c) {
                $sub.append('<div style="margin-bottom:4px">' + (c.name || c.title || JSON.stringify(c)) + '</div>');
            });
        });
    }

    /* qty controls */
    $(document).on('click', '.cc-qty-plus', function () {
        var id = String($(this).data('pack-id'));
        qty[id] = (qty[id] || 0) + 1;
        $('.cc-qty-display[data-pack-id="' + id + '"]').text(qty[id]);
        updateBar();
    });

    $(document).on('click', '.cc-qty-minus', function () {
        var id = String($(this).data('pack-id'));
        qty[id] = Math.max(0, (qty[id] || 0) - 1);
        $('.cc-qty-display[data-pack-id="' + id + '"]').text(qty[id]);
        updateBar();
    });

    /* view pack modal */
    $(document).on('click', '.cc-view-pack', function () {
        openPackModal($(this).data('pack-id'));
    });

    /* checkout */
    $(document).on('click', '#cc-bar-checkout', function () {
        var composition = [];
        Object.keys(qty).forEach(function (pid) {
            if (qty[pid] > 0) composition.push({ pack_id: parseInt(pid), qty: qty[pid] });
        });
        if (!composition.length) return;
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
                }
            });
    });

    /* init */
    $(document).ready(function () {
        apiFetch(api + '/packs')
            .then(function (r) { return r.json(); })
            .then(function (res) {
                packsCache = res.data || [];
                renderCards(packsCache);
            });
    });

}(jQuery));
