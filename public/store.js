(function ($) {
    'use strict';

    if (!window.ccPacksStore) return;

    var api      = ccPacksStore.apiUrl;
    var nonce    = ccPacksStore.nonce;
    var sbcFeed  = ccPacksStore.sbcFeed;
    var qty      = {};
    var packsCache = [];
    var feedCache  = null;

    console.log('[CC-STORE] init — api:', api, '| sbcFeed:', sbcFeed);

    /* ---- helpers ---- */
    function apiFetch(url, options) {
        options = options || {};
        options.headers = options.headers || {};
        options.headers['X-WP-Nonce'] = nonce;
        return fetch(url, options);
    }

    function getFeed() {
        if (feedCache) {
            console.log('[CC-STORE] getFeed: cache hit —', feedCache.length, 'items');
            return Promise.resolve(feedCache);
        }
        console.log('[CC-STORE] getFeed: fetching', sbcFeed);
        return fetch(sbcFeed)
            .then(function (r) {
                console.log('[CC-STORE] getFeed: HTTP', r.status, r.ok ? 'OK' : 'ERRO');
                return r.json();
            })
            .then(function (data) {
                var items = Array.isArray(data) ? data : (data.data || data.items || []);
                feedCache = items;
                console.log('[CC-STORE] getFeed: total items =', items.length);
                if (items.length) console.log('[CC-STORE] getFeed: item[0] keys =', Object.keys(items[0]), '| item[0] =', items[0]);
                return items;
            })
            .catch(function (err) {
                console.error('[CC-STORE] getFeed: FALHOU —', err);
                throw err;
            });
    }

    function thumbFor(dme) {
        if (dme.is_player && dme.player_preview && dme.player_preview.face_img)
            return dme.player_preview.face_img;
        if (dme.reward_img) return dme.reward_img;
        return '';
    }

    /* ---- bar ---- */
    function updateBar() {
        var count = 0, total = 0;
        packsCache.forEach(function (p) {
            var q = qty[p.id] || 0;
            count += q;
            total += q * parseFloat(p.price);
        });
        if (count > 0) {
            $('#cc-store-bar').css('display', 'flex');
            $('#cc-bar-summary').html(
                '<span class="cc-bar-count">' + count + ' pack' + (count > 1 ? 's' : '') + '</span>' +
                '<span class="cc-bar-total">R$ ' + total.toFixed(2).replace('.', ',') + '</span>'
            );
        } else {
            $('#cc-store-bar').hide();
        }
    }

    /* ---- render pack cards grid ---- */
    function renderGrid(packs) {
        var $grid = $('#cc-store-grid');
        $grid.empty();
        console.log('[CC-STORE] renderGrid:', packs.length, 'packs');
        if (!packs.length) {
            $grid.html('<p class="cc-empty">Nenhum pack disponível.</p>');
            return;
        }
        packs.forEach(function (pack) {
            console.log('[CC-STORE] pack id:', pack.id, '| dme_ids:', pack.dme_ids);
            var price = parseFloat(pack.price).toFixed(2).replace('.', ',');
            var $card = $(
                '<div class="cc-pack-card" data-pack-id="' + pack.id + '">' +
                '  <div class="cc-pack-thumbs" data-pack-id="' + pack.id + '">' +
                '    <div class="cc-thumbs-loading"><span></span><span></span><span></span></div>' +
                '  </div>' +
                '  <div class="cc-pack-info">' +
                '    <h3 class="cc-pack-name">' + pack.name + '</h3>' +
                '    <p class="cc-pack-price">R$ ' + price + '</p>' +
                '  </div>' +
                '  <div class="cc-pack-actions">' +
                '    <button class="cc-btn-view" data-pack-id="' + pack.id + '">Ver Pack</button>' +
                '    <div class="cc-qty-controls">' +
                '      <button class="cc-qty-btn cc-qty-minus" data-pack-id="' + pack.id + '">−</button>' +
                '      <span class="cc-qty-display" data-pack-id="' + pack.id + '">0</span>' +
                '      <button class="cc-qty-btn cc-qty-plus" data-pack-id="' + pack.id + '">+</button>' +
                '    </div>' +
                '  </div>' +
                '</div>'
            );
            $grid.append($card);
            fillThumbs(pack.id, pack.dme_ids || []);
        });
    }

    function fillThumbs(packId, dmeIds) {
        console.log('[CC-STORE] fillThumbs — packId:', packId, '| dmeIds:', dmeIds);
        if (!dmeIds.length) {
            console.log('[CC-STORE] fillThumbs: sem dme_ids, aplicando cc-thumbs-empty');
            $('.cc-pack-thumbs[data-pack-id="' + packId + '"]').html('<div class="cc-thumbs-empty"></div>');
            return;
        }
        getFeed().then(function (items) {
            var ids   = dmeIds.map(String);
            var found = items.filter(function (d) { return ids.indexOf(String(d.id)) !== -1; });

            console.log('[CC-STORE] fillThumbs packId:', packId,
                '| buscando ids:', ids,
                '| encontrados no feed:', found.length);

            found.forEach(function (dme) {
                var src = thumbFor(dme);
                console.log('[CC-STORE]   dme id:', dme.id, '| thumbFor =', src || '(vazio)',
                    '| is_player:', dme.is_player,
                    '| player_preview:', dme.player_preview,
                    '| reward_img:', dme.reward_img);
            });

            var $wrap = $('.cc-pack-thumbs[data-pack-id="' + packId + '"]');
            $wrap.empty();
            found.slice(0, 4).forEach(function (dme) {
                var src = thumbFor(dme);
                if (src) {
                    $wrap.append('<img class="cc-thumb-img" src="' + src + '" alt="' + (dme.name || '') + '">');
                }
            });

            console.log('[CC-STORE] fillThumbs packId:', packId,
                '| $wrap children após append:', $wrap.children().length,
                '| $wrap html:', $wrap.html());

            if (!$wrap.children().length) {
                console.log('[CC-STORE] fillThumbs: nenhuma thumb com src, aplicando cc-thumbs-empty');
                $wrap.html('<div class="cc-thumbs-empty"></div>');
            }
        }).catch(function (err) {
            console.error('[CC-STORE] fillThumbs erro:', err);
        });
    }

    /* ---- modal ---- */
    function openPackModal(packId) {
        var pack = packsCache.find(function (p) { return String(p.id) === String(packId); });
        if (!pack) return;
        var dmeIds = (pack.dme_ids || []).map(String);

        var $overlay = $(
            '<div class="cc-modal-overlay" id="cc-pack-modal">' +
            '  <div class="cc-modal-box">' +
            '    <button class="cc-modal-close">✕</button>' +
            '    <h2 class="cc-modal-title">' + pack.name + '</h2>' +
            '    <p class="cc-modal-price">R$ ' + parseFloat(pack.price).toFixed(2).replace('.', ',') + '</p>' +
            '    <div class="cc-modal-cards" id="cc-modal-cards"><div class="cc-cards-loading">Carregando cards...</div></div>' +
            '  </div>' +
            '</div>'
        );
        $('body').append($overlay);

        $overlay.on('click', '.cc-modal-close, .cc-modal-overlay', function (e) {
            if ($(e.target).hasClass('cc-modal-overlay') || $(e.target).hasClass('cc-modal-close')) {
                $overlay.remove();
            }
        });

        getFeed().then(function (items) {
            var found = items.filter(function (d) { return dmeIds.indexOf(String(d.id)) !== -1; });
            console.log('[CC-STORE] openPackModal — dmeIds:', dmeIds, '| found:', found.length);
            if (!found.length) {
                $('#cc-modal-cards').html('<p>Nenhum DME encontrado.</p>');
                return;
            }
            return apiFetch(api + '/render-cards', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ items: found }),
            })
            .then(function (r) {
                console.log('[CC-STORE] /render-cards modal: HTTP', r.status);
                return r.json();
            })
            .then(function (res) {
                console.log('[CC-STORE] /render-cards modal resposta:', {
                    temCss: !!res.css, cardKeys: Object.keys(res.cards || {}),
                });
                var $cont = $('#cc-modal-cards');
                $cont.empty();
                if (res.css && !$('#cc-fc-card-css').length) {
                    $('head').append('<style id="cc-fc-card-css">' + res.css + '</style>');
                }
                var cards = res.cards || {};
                found.forEach(function (dme) {
                    var id   = String(dme.id);
                    var html = cards[id] || '';
                    var challenges = dme.challenges || [];
                    var $item = $('<div class="cc-modal-dme-item">');
                    if (html) {
                        $item.append('<div class="cc-modal-card-wrap">' + html + '</div>');
                    }
                    $item.append('<p class="cc-dme-name">' + (dme.name || 'DME') + '</p>');
                    if (challenges.length) {
                        var $btn = $('<button class="cc-btn-lineups" data-dme-id="' + id + '">Ver Elencos (' + challenges.length + ')</button>');
                        var $sub = $('<div class="cc-lineups-wrap" data-dme-id="' + id + '" style="display:none">');
                        challenges.forEach(function (c) {
                            var cname = c.name || c.title || '';
                            var cimg  = c.img_url || '';
                            var cval  = c.price_ps ? 'PS: ' + c.price_ps : (c.price_pc ? 'PC: ' + c.price_pc : '');
                            $sub.append(
                                '<div class="cc-lineup-item">' +
                                (cimg ? '<img src="' + cimg + '" class="cc-lineup-img">' : '') +
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
                    var id = $(this).data('dme-id');
                    var $sub = $('.cc-lineups-wrap[data-dme-id="' + id + '"]');
                    $sub.toggle();
                    $(this).text($sub.is(':visible')
                        ? 'Fechar Elencos'
                        : 'Ver Elencos (' + $sub.children().length + ')'
                    );
                });
            });
        }).catch(function (err) {
            console.error('[CC-STORE] openPackModal erro:', err);
            $('#cc-modal-cards').html('<p>Erro ao carregar cards.</p>');
        });
    }

    /* ---- qty ---- */
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

    /* ---- ver pack ---- */
    $(document).on('click', '.cc-btn-view', function () {
        openPackModal($(this).data('pack-id'));
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
                alert('Erro ao processar pedido.');
                $btn.prop('disabled', false).text('Concluir Compra');
            }
        });
    });

    /* ---- init ---- */
    $(document).ready(function () {
        apiFetch(api + '/packs')
            .then(function (r) { return r.json(); })
            .then(function (res) {
                packsCache = res.data || [];
                console.log('[CC-STORE] packs carregados:', packsCache.length);
                renderGrid(packsCache);
            });
    });

}(jQuery));
