(function ($) {
    'use strict';

    if (!window.ccPacksAdmin) return;

    var api     = ccPacksAdmin.apiUrl;
    var nonce   = ccPacksAdmin.nonce;
    var sbcFeed = ccPacksAdmin.sbcFeed;
    var editingId      = null;
    var selectedDmeIds = [];
    var feedCache      = null;

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
                return feedCache;
            });
    }

    /* ── CRUD MODE ── */
    function initCrud() {
        var $list      = $('#cc-packs-list');
        var $form      = $('#cc-pack-form');
        var $search    = $('#cc-dme-search');
        var $dmeList   = $('#cc-dme-list');
        var $cancel    = $('#cc-cancel-edit');
        var searchTimer = null;

        if (!$list.length) return;

        loadPacks();

        // Busca DMEs com debounce
        $search.on('input', function () {
            clearTimeout(searchTimer);
            var q = $(this).val().toLowerCase().trim();
            if (!q) { $dmeList.empty(); return; }
            searchTimer = setTimeout(function () { fetchAndRenderDmes(q); }, 280);
        });

        $cancel.on('click', function () {
            editingId = null;
            selectedDmeIds = [];
            $form[0].reset();
            $dmeList.empty();
            $cancel.hide();
            updateSelectedBadge();
        });

        $form.on('submit', function (e) {
            e.preventDefault();
            if (!selectedDmeIds.length) { alert('Selecione ao menos 1 DME.'); return; }
            var data   = { name: $('#cc-pack-name').val(), price: parseFloat($('#cc-pack-price').val()), dme_ids: selectedDmeIds.slice() };
            var url    = api + '/packs' + (editingId ? '/' + editingId : '');
            var method = editingId ? 'PUT' : 'POST';
            var $btn   = $form.find('[type=submit]');
            $btn.prop('disabled', true).text('Salvando...');
            apiFetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
                .then(function (r) {
                    if (!r.ok) { alert('Erro ao salvar pack.'); $btn.prop('disabled', false).text('Salvar Pack'); return; }
                    editingId = null; selectedDmeIds = [];
                    $form[0].reset(); $dmeList.empty(); $cancel.hide();
                    updateSelectedBadge();
                    $btn.prop('disabled', false).text('Salvar Pack');
                    loadPacks();
                });
        });

        /* Busca + renderiza DMEs como cards */
        function fetchAndRenderDmes(q) {
            $dmeList.html('<div class="cc-admin-dme-loading"><span></span><span></span><span></span></div>');
            getFeed().then(function (items) {
                var filtered = items.filter(function (d) {
                    return (d.name || '').toLowerCase().indexOf(q) !== -1;
                }).slice(0, 20);

                if (!filtered.length) {
                    $dmeList.html('<p class="cc-admin-dme-empty">Nenhum DME encontrado.</p>');
                    return;
                }

                // Requisita cards renderizados ao PHP
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
                        var html    = cards[id] || '';
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

        // Toggle seleção ao clicar no card
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
            var $badge = $('#cc-selected-count');
            if (!$badge.length) $search.after('<span id="cc-selected-count"></span>');
            $('#cc-selected-count').text(selectedDmeIds.length ? selectedDmeIds.length + ' DME(s) selecionado(s)' : '');
        }

        /* Lista de packs */
        function loadPacks() {
            apiFetch(api + '/packs')
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    var packs = res.data || [];
                    $list.empty();
                    if (!packs.length) { $list.html('<p class="cc-admin-empty">Nenhum pack cadastrado.</p>'); return; }
                    packs.forEach(function (pack) {
                        var price = parseFloat(pack.price).toFixed(2).replace('.', ',');
                        $list.append(
                            '<div class="cc-admin-pack-item" data-id="' + pack.id + '">' +
                            '<div class="cc-admin-pack-info">' +
                            '<span class="cc-admin-pack-name">' + pack.name + '</span>' +
                            '<span class="cc-admin-pack-price">R$ ' + price + '</span>' +
                            '<span class="cc-admin-pack-dmes">' + (pack.dme_ids ? pack.dme_ids.length : 0) + ' DMEs</span>' +
                            '</div>' +
                            '<div class="cc-admin-pack-actions">' +
                            '<button class="cc-admin-btn cc-edit-pack" data-pack=\'' + JSON.stringify(pack) + '\'>Editar</button>' +
                            '<button class="cc-admin-btn cc-admin-btn-danger cc-delete-pack" data-id="' + pack.id + '">Excluir</button>' +
                            '</div></div>'
                        );
                    });
                });
        }

        $list.on('click', '.cc-edit-pack', function (e) {
            e.preventDefault();
            var pack = $(this).data('pack');
            editingId      = pack.id;
            selectedDmeIds = (pack.dme_ids || []).map(String);
            $('#cc-pack-name').val(pack.name);
            $('#cc-pack-price').val(pack.price);
            $cancel.show();
            updateSelectedBadge();
            $('html,body').animate({ scrollTop: $form.offset().top - 40 }, 250);
        });

        $list.on('click', '.cc-delete-pack', function (e) {
            e.preventDefault();
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
                if (!sessions.length) { $list.html('<p class="cc-admin-empty">Nenhum pedido encontrado.</p>'); return; }
                renderOrders(sessions, packMap);
            });

        function compLabel(composition, packMap) {
            return Object.keys(composition).map(function (pid) {
                var p = packMap[pid];
                return (p ? p.name : 'Pack #' + pid) + ' x' + composition[pid];
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
            var id = $(this).data('id');
            apiFetch(api + '/session/' + id + '/status', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'approved' }),
            }).then(function () { location.reload(); });
        });
        $list.on('click', '.cc-reject-btn', function () {
            var id = $(this).data('id');
            apiFetch(api + '/session/' + id + '/status', {
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
