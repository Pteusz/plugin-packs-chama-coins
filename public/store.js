(function ($) {
    'use strict';

    if (!window.ccPacksStore) return;

    var api        = ccPacksStore.apiUrl;
    var nonce      = ccPacksStore.nonce;
    var sbcFeed    = ccPacksStore.sbcFeed;
    var qty        = {};
    var packsCache = [];
    var feedCache  = null;

    /* ---- helpers ---- */
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
                var items = Array.isArray(data) ? data : (data.data || data.items || []);
                feedCache = items;
                return items;
            });
    }

    function thumbFor(dme) {
        if (dme.is_player && dme.player_preview && dme.player_preview.face_img)
            return dme.player_preview.face_img;
        if (dme.reward_img) return dme.reward_img;
        return '';
    }

    /* ---- checkout bar ---- */
    function updateBar() {
        var count = 0, total = 0;
        packsCache.forEach(function (p) {
            var q = qty[p.id] || 0;
            count += q;
            total += q * parseFloat(p.price);
        });

        if (count > 0) {
            $('#cc-store-bar').css('display', 'flex');
            $('#cc-bar-count-text').text(count + (count === 1 ? ' pack' : ' packs') + ' selecionado' + (count === 1 ? '' : 's'));
            $('#cc-bar-total-text').text('R$ ' + total.toFixed(2).replace('.', ','));
        } else {
            $('#cc-store-bar').hide();
        }

        // Atualiza estado visual dos cartões
        packsCache.forEach(function (p) {
            var id = String(p.id);
            var q  = qty[id] || 0;
            var $card = $('.cc-pack-card[data-pack-id="' + id + '"]');
            $card.toggleClass('cc-has-qty', q > 0);
            $('.cc-qty-display[data-pack-id="' + id + '"]').text(q);
        });
    }

    /* ---- grid ---- */
    function renderGrid(packs) {
        var $grid  = $('#cc-store-grid');
        var $count = $('#cc-packs-count');
        $grid.empty();

        if (!packs.length) {
            $grid.html('<p class="cc-empty">Nenhum pack disponível no momento.</p>');
            $count.text('');
            return;
        }

        $count.text(packs.length + (packs.length === 1 ? ' pack' : ' packs'));

        packs.forEach(function (pack) {
            var price = parseFloat(pack.price).toFixed(2).replace('.', ',');
            var id    = String(pack.id);

            var $card = $(
                '<div class="cc-pack-card" data-pack-id="' + id + '">' +

                '  <div class="cc-pack-cover">' +
                '    <div class="cc-pack-thumbs" data-pack-id="' + id + '">' +
                '      <div class="cc-thumbs-skeleton">' +
                '        <span></span><span></span><span></span>' +
                '      </div>' +
                '    </div>' +
                '    <div class="cc-pack-cover-overlay">' +
                '      <button class="cc-btn-view" data-pack-id="' + id + '">Ver conteúdo</button>' +
                '    </div>' +
                '  </div>' +

                '  <div class="cc-pack-meta">' +
                '    <h3 class="cc-pack-name">' + pack.name + '</h3>' +
                '    <div class="cc-pack-bottom">' +
                '      <span class="cc-pack-price">R$ ' + price + '</span>' +
                '      <div class="cc-qty-controls">' +
                '        <button class="cc-qty-btn cc-qty-minus" data-pack-id="' + id + '" title="Remover">−</button>' +
                '        <span class="cc-qty-display" data-pack-id="' + id + '">0</span>' +
                '        <button class="cc-qty-btn cc-qty-plus" data-pack-id="' + id + '" title="Adicionar">+</button>' +
                '      </div>' +
                '    </div>' +
                '  </div>' +

                '</div>'
            );

            $grid.append($card);
            fillThumbs(id, pack.dme_ids || []);
        });
    }

    function fillThumbs(packId, dmeIds) {
        if (!dmeIds.length) {
            $('.cc-pack-thumbs[data-pack-id="' + packId + '"]').html('<div class="cc-thumbs-placeholder"></div>');
            return;
        }
        getFeed().then(function (items) {
            var ids   = dmeIds.map(String);
            var found = items.filter(function (d) { return ids.indexOf(String(d.id)) !== -1; });
            var $wrap = $('.cc-pack-thumbs[data-pack-id="' + packId + '"]');
            $wrap.empty();

            var shown = found.slice(0, 4);
            shown.forEach(function (dme) {
                var src = thumbFor(dme);
                if (src) {
                    $wrap.append(
                        '<div class="cc-thumb-cell">' +
                        '<img class="cc-thumb-img" src="' + src + '" alt="' + (dme.name || '') + '" loading="lazy">' +
                        '</div>'
                    );
                }
            });

            if (!$wrap.children().length) {
                $wrap.html('<div class="cc-thumbs-placeholder"></div>');
            }

            // layout: 1 imagem → full; 2 → 1x2; 3-4 → 2x2
            var n = $wrap.children('.cc-thumb-cell').length;
            $wrap.attr('data-count', n);
        });
    }

    /* ---- modal ---- */
    function openPackModal(packId) {
        var pack = packsCache.find(function (p) { return String(p.id) === String(packId); });
        if (!pack) return;
        var dmeIds = (pack.dme_ids || []).map(String);

        $('body').addClass('cc-modal-open');

        var $overlay = $(
            '<div class="cc-modal-overlay" id="cc-pack-modal" role="dialog" aria-modal="true">' +
            '  <div class="cc-modal-box">' +
            '    <div class="cc-modal-header">' +
            '      <div>' +
            '        <span class="cc-modal-badge">Conteúdo do pack</span>' +
            '        <h2 class="cc-modal-title">' + pack.name + '</h2>' +
            '        <p class="cc-modal-price">R$ ' + parseFloat(pack.price).toFixed(2).replace('.', ',') + '</p>' +
            '      </div>' +
            '      <button class="cc-modal-close" aria-label="Fechar">✕</button>' +
            '    </div>' +
            '    <div class="cc-modal-body">' +
            '      <div class="cc-modal-cards" id="cc-modal-cards">' +
            '        <div class="cc-cards-loading">' +
            '          <span></span><span></span><span></span>' +
            '          <p>Carregando jogadores...</p>' +
            '        </div>' +
            '      </div>' +
            '    </div>' +
            '    <div class="cc-modal-footer">' +
            '      <div class="cc-modal-qty">' +
            '        <button class="cc-qty-btn cc-qty-minus" data-pack-id="' + packId + '">−</button>' +
            '        <span class="cc-qty-display cc-modal-qty-display" data-pack-id="' + packId + '">' + (qty[packId] || 0) + '</span>' +
            '        <button class="cc-qty-btn cc-qty-plus" data-pack-id="' + packId + '">+</button>' +
            '      </div>' +
            '      <button class="cc-modal-add-btn cc-qty-plus" data-pack-id="' + packId + '">Adicionar ao carrinho</button>' +
            '    </div>' +
            '  </div>' +
            '</div>'
        );

        $('body').append($overlay);
        setTimeout(function () { $overlay.addClass('cc-modal-visible'); }, 10);

        $overlay.on('click', function (e) {
            if ($(e.target).hasClass('cc-modal-overlay') || $(e.target).hasClass('cc-modal-close')) {
                closeModal($overlay);
            }
        });

        $(document).on('keydown.ccmodal', function (e) {
            if (e.key === 'Escape') closeModal($overlay);
        });

        getFeed().then(function (items) {
            var found = items.filter(function (d) { return dmeIds.indexOf(String(d.id)) !== -1; });
            if (!found.length) {
                $('#cc-modal-cards').html('<p class="cc-modal-empty">Nenhum jogador encontrado neste pack.</p>');
                return;
            }
            return apiFetch(api + '/render-cards', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ items: found }),
            })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                var $cont = $('#cc-modal-cards');
                $cont.empty();

                if (res.css && !$('#cc-fc-card-css').length) {
                    $('head').append('<style id="cc-fc-card-css">' + res.css + '</style>');
                }

                var cards = res.cards || {};
                found.forEach(function (dme) {
                    var id         = String(dme.id);
                    var html       = cards[id] || '';
                    var challenges = dme.challenges || [];

                    var $item = $('<div class="cc-modal-dme-item">');

                    if (html) {
                        $item.append('<div class="cc-modal-card-wrap">' + html + '</div>');
                    }

                    $item.append('<p class="cc-dme-name">' + (dme.name || 'Jogador') + '</p>');

                    if (challenges.length) {
                        var $btn = $('<button class="cc-btn-lineups" data-dme-id="' + id + '">Ver Elencos (' + challenges.length + ')</button>');
                        var $sub = $('<div class="cc-lineups-wrap" data-dme-id="' + id + '" hidden>');

                        challenges.forEach(function (c) {
                            var cname = c.name || c.title || '';
                            var cimg  = c.img_url || '';
                            var cval  = c.price_ps ? 'PS: ' + c.price_ps : (c.price_pc ? 'PC: ' + c.price_pc : '');
                            $sub.append(
                                '<div class="cc-lineup-item">' +
                                (cimg ? '<img src="' + cimg + '" class="cc-lineup-img" loading="lazy">' : '') +
                                '<span class="cc-lineup-name">' + cname + '</span>' +
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
                    var open = $sub.is(':visible');
                    $sub.toggle();
                    $(this).toggleClass('is-open', !open);
                    $(this).text(!open
                        ? 'Fechar Elencos'
                        : 'Ver Elencos (' + $sub.children().length + ')');
                });
            });
        }).catch(function () {
            $('#cc-modal-cards').html('<p class="cc-modal-empty">Erro ao carregar conteúdo. Tente novamente.</p>');
        });
    }

    function closeModal($overlay) {
        $overlay.removeClass('cc-modal-visible');
        $('body').removeClass('cc-modal-open');
        $(document).off('keydown.ccmodal');
        setTimeout(function () { $overlay.remove(); }, 260);
    }

    /* ---- qty ---- */
    $(document).on('click', '.cc-qty-plus', function () {
        var id = String($(this).data('pack-id'));
        qty[id] = (qty[id] || 0) + 1;
        updateBar();
    });

    $(document).on('click', '.cc-qty-minus', function () {
        var id = String($(this).data('pack-id'));
        qty[id] = Math.max(0, (qty[id] || 0) - 1);
        updateBar();
    });

    /* ---- ver pack ---- */
    $(document).on('click', '.cc-btn-view', function () {
        openPackModal(String($(this).data('pack-id')));
    });

    /* ---- checkout ---- */
    $(document).on('click', '#cc-bar-checkout', function () {
        var composition = [];
        Object.keys(qty).forEach(function (pid) {
            if (qty[pid] > 0) composition.push({ pack_id: parseInt(pid, 10), qty: qty[pid] });
        });
        if (!composition.length) return;

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
                alert('Erro ao processar pedido. Tente novamente.');
                $btn.prop('disabled', false).text('Concluir Compra');
            }
        })
        .catch(function () {
            alert('Erro de conexão. Tente novamente.');
            $btn.prop('disabled', false).text('Concluir Compra');
        });
    });

    /* ---- init ---- */
    $(document).ready(function () {
        apiFetch(api + '/packs')
            .then(function (r) { return r.json(); })
            .then(function (res) {
                packsCache = res.data || [];
                renderGrid(packsCache);
            })
            .catch(function () {
                $('#cc-store-grid').html('<p class="cc-empty">Erro ao carregar packs. Recarregue a página.</p>');
            });
    });

}(jQuery));
