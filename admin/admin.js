(function ($) {
    'use strict';

    if (!window.ccPacksAdmin) return;

    var api     = ccPacksAdmin.apiUrl;
    var nonce   = ccPacksAdmin.nonce;
    var sbcFeed = ccPacksAdmin.sbcFeed;
    var editingId      = null;
    var selectedDmeIds = [];
    var feedCache      = null;
    var allFeedItems   = [];
    var coinsDebounce = null;
    var csCalcUrl     = (window.ccPacksAdmin && ccPacksAdmin.csCalcUrl) ? ccPacksAdmin.csCalcUrl : null;

    function apiFetch(url, opts) {
        opts = opts || {};
        opts.headers = opts.headers || {};
        opts.headers['X-WP-Nonce'] = nonce;
        return fetch(url, opts);
    }

    function getFeed() {
        if (feedCache) return Promise.resolve(feedCache);
        return fetch(sbcFeed)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                feedCache = Array.isArray(data) ? data : (data.data || data.items || []);
                allFeedItems = feedCache;
                return feedCache;
            });
    }

    /**
     * Remove width/max-width/min-width inline de todos os elementos
     * do HTML retornado pelo fc-card-renderer (vem com style="width:220px").
     */
    function fitCardHtml(html) {
        if (!html) return '';
        var $tmp = $('<div>').html(html);
        $tmp.find('*').each(function () {
            var el = this;
            if (el.style && (el.style.width || el.style.maxWidth || el.style.minWidth)) {
                el.style.width    = '100%';
                el.style.maxWidth = '100%';
                el.style.minWidth = '0';
            }
        });
        return $tmp.html();
    }

    /* ── CRUD MODE ── */
    function initCrud() {
        var $list    = $('#cc-packs-list');
        var $search  = $('#cc-dme-search');
        var $dmeList = $('#cc-dme-list');
        var $cancel  = $('#cc-cancel-edit');
        var $save    = $('#cc-save-pack');
        var $title   = $('#cc-form-title');
        var searchTimer = null;

        if (!$list.length) return;

        function formatCoins(n) {
            n = parseInt(n) || 0;
            if (n <= 0) return '0';
            if (n >= 1000000) {
                var kk = n / 1000000;
                return (kk === Math.floor(kk) ? kk.toFixed(0) : kk.toFixed(1)) + 'kk';
            }
            return Math.floor(n / 1000) + 'k';
        }

        function triggerCoinsPreview() {
            clearTimeout(coinsDebounce);
            var coins    = parseInt($('#cc-pack-coins').val()) || 0;
            var platform = $('#cc-pack-coins-platform').val() || 'ps';
            var $preview = $('#cc-coins-price-preview');
            if (coins <= 0 || !csCalcUrl) { $preview.hide().text(''); return; }
            $preview.show().text('Calculando...');
            coinsDebounce = setTimeout(function () {
                var url = csCalcUrl + '?mode=lance&platform=' + encodeURIComponent(platform) + '&coins=' + coins;
                fetch(url, { headers: { 'X-WP-Nonce': nonce } })
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (data && data.price_formatted) {
                            $preview.text('🪙 Preço dos coins: ' + data.price_formatted).show();
                        } else {
                            $preview.hide().text('');
                        }
                    })
                    .catch(function () { $preview.hide().text(''); });
            }, 450);
        }

        $(document).on('input change', '#cc-pack-coins, #cc-pack-coins-platform', triggerCoinsPreview);

        loadPacks();

        // Carrega todos os DMEs ao iniciar (sem filtro)
        renderDmes('');

        // Filtra em tempo real conforme o usuário digita
        $search.on('input', function () {
            clearTimeout(searchTimer);
            var q = $(this).val().toLowerCase().trim();
            searchTimer = setTimeout(function () { renderDmes(q); }, 280);
        });

        $cancel.on('click', function () {
            editingId = null;
            selectedDmeIds = [];
            $('#cc-pack-name').val('');
            $('#cc-pack-price').val('');
            $search.val('');
            $('#cc-pack-coins').val('0');
            $('#cc-pack-coins-platform').val('ps');
            $('#cc-coins-price-preview').hide().text('');
            $cancel.hide();
            $title.text('Novo Pack');
            $save.text('Salvar Pack');
            renderDmes('');
            updateSelectedBadge();
        });

        $save.on('click', function () {
            var name  = $('#cc-pack-name').val().trim();
            var price = parseFloat($('#cc-pack-price').val());
            var coinsAmount   = parseInt($('#cc-pack-coins').val())        || 0;
            var coinsPlatform = $('#cc-pack-coins-platform').val()         || 'ps';
            if (!name)                  { alert('Informe o nome do pack.');    return; }
            if (isNaN(price) || price < 0) { alert('Informe um preço válido.'); return; }
            if (!selectedDmeIds.length) { alert('Selecione ao menos 1 DME.'); return; }

            var data   = { name: name, price: price, dme_ids: selectedDmeIds.slice(), coins_amount: coinsAmount, coins_platform: coinsPlatform };
            var url    = api + '/packs' + (editingId ? '/' + editingId : '');
            var method = editingId ? 'PUT' : 'POST';
            $save.prop('disabled', true).text('Salvando...');

            apiFetch(url, {
                method:  method,
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(data),
            }).then(function (r) {
                if (!r.ok) { alert('Erro ao salvar pack.'); $save.prop('disabled', false).text('Salvar Pack'); return; }
                editingId = null; selectedDmeIds = [];
                $('#cc-pack-name').val(''); $('#cc-pack-price').val(''); $search.val('');
                $cancel.hide();
                $title.text('Novo Pack');
                $save.prop('disabled', false).text('Salvar Pack');
                renderDmes('');
                updateSelectedBadge();
                loadPacks();
            });
        });

        /* ── Renderiza DMEs (com ou sem filtro) ── */
        function renderDmes(q) {
            getFeed().then(function (items) {
                var filtered = q
                    ? items.filter(function (d) {
                        return (d.name || '').toLowerCase().indexOf(q) !== -1;
                      })
                    : items;
                filtered = filtered.slice(0, 30);

                if (!filtered.length) {
                    $dmeList.html('<p class="cc-admin-dme-empty">Nenhum DME encontrado.</p>');
                    return;
                }

                $dmeList.html('<div class="cc-admin-dme-loading"><span></span><span></span><span></span></div>');

                return apiFetch(api + '/render-cards', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ items: filtered }),
                })
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    if (res.css && !$('#cc-fc-card-css').length) {
                        $('head').append('<style id="cc-fc-card-css">' + res.css + '</style>');
                    }
                    var cards = res.cards || {};
                    $dmeList.empty();
                    filtered.forEach(function (dme) {
                        var id      = String(dme.id);
                        var html    = fitCardHtml(cards[id] || '');
                        var checked = selectedDmeIds.indexOf(id) !== -1;
                        var $wrap   = $(
                            '<div class="cc-admin-dme-card' + (checked ? ' is-selected' : '') + '" data-dme-id="' + id + '">' +
                            (html
                                ? '<div class="cc-admin-card-inner">' + html + '</div>'
                                : '<div class="cc-admin-card-fallback">' +
                                  (dme.reward_img ? '<img src="' + dme.reward_img + '">' : '') +
                                  '</div>'
                            ) +
                            '<div class="cc-admin-dme-label">' + (dme.name || id) + '</div>' +
                            '<div class="cc-admin-dme-check-icon">✓</div>' +
                            '</div>'
                        );
                        $dmeList.append($wrap);
                    });
                    updateSelectedBadge();
                });
            }).catch(function () {
                $dmeList.html('<p class="cc-admin-dme-empty">Erro ao carregar DMEs.</p>');
            });
        }

        /* Toggle seleção */
        $dmeList.on('click', '.cc-admin-dme-card', function () {
            var id = String($(this).data('dme-id'));
            if ($(this).hasClass('is-selected')) {
                selectedDmeIds = selectedDmeIds.filter(function (v) { return v !== id; });
                $(this).removeClass('is-selected');
            } else {
                if (selectedDmeIds.indexOf(id) === -1) selectedDmeIds.push(id);
                $(this).addClass('is-selected');
            }
            updateSelectedBadge();
        });

        function updateSelectedBadge() {
            $('#cc-selected-count').text(
                selectedDmeIds.length ? selectedDmeIds.length + ' DME(s) selecionado(s)' : ''
            );
        }

        /* ── Lista de packs como cards com kebab ── */
        function loadPacks() {
            apiFetch(api + '/packs')
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    var packs = res.data || [];
                    $list.empty();
                    if (!packs.length) {
                        $list.html('<p class="cc-admin-empty">Nenhum pack cadastrado ainda.</p>');
                        return;
                    }
                    packs.forEach(function (pack) {
                        var price = parseFloat(pack.total_price || pack.price).toFixed(2).replace('.', ',');
                        var $card = $(
                            '<div class="cc-admin-pack-card" data-id="' + pack.id + '">' +
                            '  <div class="cc-admin-pack-card-body">' +
                            '    <span class="cc-admin-pack-card-name">' + pack.name + '</span>' +
                            '    <span class="cc-admin-pack-card-price">R$ ' + price + '</span>' +
                            '    <span class="cc-admin-pack-card-count">' + (pack.dme_ids ? pack.dme_ids.length : 0) + ' DMEs</span>' +
                            (pack.coins_amount > 0 ? '    <span class="cc-admin-pack-card-coins">🪙 ' + formatCoins(pack.coins_amount) + ' (' + (pack.coins_platform || 'ps').toUpperCase() + ')</span>' : '') +
                            '  </div>' +
                            '  <div class="cc-admin-pack-kebab-wrap">' +
                            '    <button class="cc-admin-pack-kebab" title="Opções">⋮</button>' +
                            '    <div class="cc-admin-pack-menu">' +
                            '      <button class="cc-pack-menu-btn cc-edit-pack" data-pack=\'' + JSON.stringify(pack) + '\'>✏️ Editar</button>' +
                            '      <button class="cc-pack-menu-btn cc-pack-menu-danger cc-delete-pack" data-id="' + pack.id + '">🗑 Excluir</button>' +
                            '    </div>' +
                            '  </div>' +
                            '</div>'
                        );
                        $list.append($card);
                    });
                });
        }

        // Abre / fecha kebab ao clicar no ⋮
        $list.on('click', '.cc-admin-pack-kebab', function (e) {
            e.stopPropagation();
            var $menu = $(this).siblings('.cc-admin-pack-menu');
            $('.cc-admin-pack-menu').not($menu).removeClass('is-open');
            $menu.toggleClass('is-open');
        });

        // Fecha kebab ao clicar fora
        $(document).on('click', function () {
            $('.cc-admin-pack-menu').removeClass('is-open');
        });

        $list.on('click', '.cc-edit-pack', function (e) {
            e.stopPropagation();
            var pack = $(this).data('pack');
            editingId      = pack.id;
            selectedDmeIds = (pack.dme_ids || []).map(String);
            $('#cc-pack-name').val(pack.name);
            $('#cc-pack-price').val(pack.price);
            $('#cc-pack-coins').val(pack.coins_amount || 0);
            $('#cc-pack-coins-platform').val(pack.coins_platform || 'ps');
            triggerCoinsPreview();
            $cancel.show();
            $title.text('Editar Pack');
            $save.text('Atualizar Pack');
            $('.cc-admin-pack-menu').removeClass('is-open');
            renderDmes($search.val().toLowerCase().trim());
            updateSelectedBadge();
            $('html,body').animate({ scrollTop: $('#cc-pack-form-wrap').offset().top - 40 }, 250);
        });

        $list.on('click', '.cc-delete-pack', function (e) {
            e.stopPropagation();
            $('.cc-admin-pack-menu').removeClass('is-open');
            if (!confirm('Excluir este pack?')) return;
            apiFetch(api + '/packs/' + $(this).data('id'), { method: 'DELETE' })
                .then(function () { loadPacks(); });
        });
    }

    /* ── ORDERS MODE ── */
    function initOrders() {
        var $list = $('#cc-orders-list');
        if (!$list.length) return;

        $list.html('<div class="cc-admin-dme-loading"><span></span><span></span><span></span></div>');

        apiFetch(api + '/packs')
            .then(function (r) { return r.json(); })
            .then(function (res) {
                var packMap = {};
                (res.data || []).forEach(function (p) { packMap[p.id] = p; });
                var sessions = window.ccPacksAdminSessions || [];
                $list.empty();
                if (!sessions.length) {
                    $list.html('<p class="cc-admin-empty">Nenhum pedido encontrado.</p>');
                    return;
                }
                renderOrders(sessions, packMap);
            });

        function compLabel(composition, packMap) {
            return Object.keys(composition).map(function (pid) {
                var p = packMap[pid];
                return (p ? p.name : 'Pack #' + pid) + ' ×' + composition[pid];
            }).join(', ');
        }

        function renderOrders(sessions, packMap) {
            sessions.forEach(function (s) {
                var comp   = compLabel(s.composition || {}, packMap);
                var total  = parseFloat(s.total || 0).toFixed(2).replace('.', ',');
                var phone  = (s.phone || '').replace(/\D/g, '');
                var waText = encodeURIComponent('Olá ' + (s.buyer_name || '') + '! Seu pedido de Packs Chama Coins está sendo processado.');
                var waLink = phone
                    ? '<a class="cc-admin-btn cc-admin-btn-wa" href="https://wa.me/55' + phone + '?text=' + waText + '" target="_blank">WhatsApp</a>'
                    : '';
                var statusClass = 'cc-status-' + (s.status || 'pending');
                var $row = $(
                    '<div class="cc-admin-order-item">' +
                    '<div class="cc-admin-order-header">' +
                    '<span class="cc-admin-order-buyer">' + (s.buyer_name || 'Usuário #' + s.user_id) + '</span>' +
                    '<span class="cc-status-badge ' + statusClass + '">' + (s.status || 'pending') + '</span>' +
                    waLink +
                    '</div>' +
                    '<div class="cc-admin-order-detail">' +
                    '<span class="cc-admin-order-comp">' + comp + '</span>' +
                    '<span class="cc-admin-order-total">R$ ' + total + '</span>' +
                    '</div>' +
                    '<div class="cc-admin-order-btns">' +
                    '<button class="cc-admin-btn cc-approve-btn" data-id="' + s.id + '">Aprovar</button>' +
                    '<button class="cc-admin-btn cc-admin-btn-danger cc-reject-btn" data-id="' + s.id + '">Reprovar</button>' +
                    '</div></div>'
                );
                $list.append($row);
            });
        }

        $list.on('click', '.cc-approve-btn', function () {
            apiFetch(api + '/session/' + $(this).data('id') + '/status', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'approved' }),
            }).then(function () { location.reload(); });
        });
        $list.on('click', '.cc-reject-btn', function () {
            apiFetch(api + '/session/' + $(this).data('id') + '/status', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'rejected' }),
            }).then(function () { location.reload(); });
        });
    }

    $(document).ready(function () {
        initCrud();
        initOrders();
    });

}(jQuery));
