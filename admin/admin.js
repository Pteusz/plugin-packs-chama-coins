(function ($) {
    'use strict';

    if (!window.ccPacksAdmin) return;

    var api     = ccPacksAdmin.apiUrl;
    var nonce   = ccPacksAdmin.nonce;
    var sbcFeed = ccPacksAdmin.sbcFeed;
    var editingId      = null;
    var selectedDmeIds = [];

    function apiFetch(url, options) {
        options = options || {};
        options.headers = options.headers || {};
        options.headers['X-WP-Nonce'] = nonce;
        return fetch(url, options);
    }

    /* ---- CRUD MODE ---- */

    function initCrud() {
        var $list     = $('#cc-packs-list');
        var $form     = $('#cc-pack-form');
        var $dmeSearch = $('#cc-dme-search');
        var $dmeList  = $('#cc-dme-list');
        var $cancel   = $('#cc-cancel-edit');

        if (!$list.length) return;

        loadPacks();

        $dmeSearch.on('input', function () {
            fetchDmes($(this).val().toLowerCase());
        });

        $cancel.on('click', function () {
            editingId = null;
            selectedDmeIds = [];
            $form[0].reset();
            $dmeList.empty();
            $cancel.hide();
        });

        $form.on('submit', function (e) {
            e.preventDefault();
            var data = {
                name:    $('#cc-pack-name').val(),
                price:   parseFloat($('#cc-pack-price').val()),
                dme_ids: selectedDmeIds.slice(),
            };
            var url    = api + '/packs' + (editingId ? '/' + editingId : '');
            var method = editingId ? 'PUT' : 'POST';
            apiFetch(url, {
                method:  method,
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(data),
            }).then(function (r) {
                if (!r.ok) { alert('Erro ao salvar pack.'); return; }
                editingId = null;
                selectedDmeIds = [];
                $form[0].reset();
                $dmeList.empty();
                $cancel.hide();
                loadPacks();
            });
        });

        function fetchDmes(q) {
            fetch(sbcFeed)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var items = Array.isArray(data) ? data : (data.items || data.data || []);
                    if (q) {
                        items = items.filter(function (d) {
                            return (d.name || d.title || '').toLowerCase().indexOf(q) !== -1;
                        });
                    }
                    $dmeList.empty();
                    items.forEach(function (dme) {
                        var id      = String(dme.id || dme.dme_id || '');
                        var label   = dme.name || dme.title || id;
                        var checked = selectedDmeIds.indexOf(id) !== -1 ? ' checked' : '';
                        $dmeList.append(
                            '<label style="display:block;padding:4px 0">' +
                            '<input type="checkbox" class="cc-dme-check" value="' + id + '"' + checked + '> ' +
                            label + '</label>'
                        );
                    });
                }).catch(function () { $dmeList.html('<em>Erro ao carregar DMEs.</em>'); });
        }

        $dmeList.on('change', '.cc-dme-check', function () {
            var val = $(this).val();
            if ($(this).is(':checked')) {
                if (selectedDmeIds.indexOf(val) === -1) selectedDmeIds.push(val);
            } else {
                selectedDmeIds = selectedDmeIds.filter(function (v) { return v !== val; });
            }
        });

        function loadPacks() {
            apiFetch(api + '/packs')
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    var packs = res.data || [];
                    $list.empty();
                    if (!packs.length) { $list.html('<p>Nenhum pack cadastrado.</p>'); return; }
                    packs.forEach(function (pack) {
                        var price = parseFloat(pack.price).toFixed(2).replace('.', ',');
                        $list.append(
                            '<div class="cc-pack-item" style="border:1px solid #ddd;padding:8px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">' +
                            '<span><strong>' + pack.name + '</strong> &mdash; R$ ' + price + '</span>' +
                            '<div style="position:relative">' +
                            '<button class="cc-pack-menu-btn button button-small" data-id="' + pack.id + '">&#8942;</button>' +
                            '<div class="cc-pack-menu" data-id="' + pack.id + '" style="display:none;position:absolute;right:0;background:#fff;border:1px solid #ccc;z-index:100;min-width:120px;box-shadow:0 2px 6px rgba(0,0,0,.15)">' +
                            '<a href="#" class="cc-edit-pack" data-pack=\'' + JSON.stringify(pack) + '\' style="display:block;padding:6px 12px">Editar</a>' +
                            '<a href="#" class="cc-delete-pack" data-id="' + pack.id + '" style="display:block;padding:6px 12px;color:#b32d2e">Excluir</a>' +
                            '</div></div></div>'
                        );
                    });
                });
        }

        $list.on('click', '.cc-pack-menu-btn', function (e) {
            e.stopPropagation();
            var id = $(this).data('id');
            $('.cc-pack-menu').not('[data-id="' + id + '"]').hide();
            $('.cc-pack-menu[data-id="' + id + '"]').toggle();
        });

        $list.on('click', '.cc-edit-pack', function (e) {
            e.preventDefault();
            var pack = $(this).data('pack');
            if (!pack) return;
            editingId      = pack.id;
            selectedDmeIds = (pack.dme_ids || []).map(String);
            $('#cc-pack-name').val(pack.name);
            $('#cc-pack-price').val(pack.price);
            $cancel.show();
            fetchDmes('');
            $('.cc-pack-menu').hide();
            $('html,body').animate({ scrollTop: $form.offset().top - 40 }, 300);
        });

        $list.on('click', '.cc-delete-pack', function (e) {
            e.preventDefault();
            var id = $(this).data('id');
            if (!confirm('Excluir este pack?')) return;
            apiFetch(api + '/packs/' + id, { method: 'DELETE' })
                .then(function () { loadPacks(); });
        });

        $(document).on('click', function () { $('.cc-pack-menu').hide(); });
    }

    /* ---- ORDERS MODE ---- */

    function initOrders() {
        var $list = $('#cc-orders-list');
        if (!$list.length) return;

        $list.html('<p>Carregando pedidos...</p>');

        apiFetch(api + '/packs')
            .then(function (r) { return r.json(); })
            .then(function (res) {
                var packs   = res.data || [];
                var packMap = {};
                packs.forEach(function (p) { packMap[p.id] = p; });

                /* Não há endpoint REST para listar sessions por ADM; a listagem
                   é feita via PHP (CC_Packs_Session::get_by_adm). O JS renderiza
                   os dados passados via wp_localize_script se disponíveis. */
                var sessions = (window.ccPacksAdminSessions || []);
                if (!sessions.length) {
                    $list.html('<p>Nenhum pedido encontrado para este administrador.</p>');
                    return;
                }
                renderOrders(sessions, packMap);
            });

        function compLabel(composition, packMap) {
            return Object.keys(composition).map(function (pid) {
                var pack = packMap[pid];
                var name = pack ? pack.name : 'Pack #' + pid;
                return name + ' x' + composition[pid];
            }).join(', ');
        }

        function renderOrders(sessions, packMap) {
            $list.empty();
            sessions.forEach(function (s) {
                var comp  = compLabel(s.composition || {}, packMap);
                var total = parseFloat(s.total || 0).toFixed(2).replace('.', ',');
                var phone = (s.phone || '').replace(/\D/g, '');
                var waMsg = encodeURIComponent('Olá! Seu pedido de Packs foi processado.');
                var waLink = phone
                    ? '<a href="https://wa.me/55' + phone + '?text=' + waMsg + '" target="_blank" class="button button-small">WhatsApp</a>'
                    : '';
                var badge = '<span class="cc-status-badge cc-status-' + s.status + '">' + s.status + '</span>';
                $list.append(
                    '<div class="cc-order-item" style="border:1px solid #ddd;padding:12px;margin-bottom:12px">' +
                    '<p><strong>' + (s.buyer_name || 'Usuário #' + s.user_id) + '</strong> ' + waLink + ' ' + badge + '</p>' +
                    '<p>Composição: ' + comp + '</p>' +
                    '<p>Total: R$ ' + total + '</p>' +
                    '<button class="cc-approve-btn button" data-id="' + s.id + '">Aprovar</button> ' +
                    '<button class="cc-reject-btn button" data-id="' + s.id + '" style="margin-left:4px">Reprovar</button>' +
                    '</div>'
                );
            });
        }

        $list.on('click', '.cc-approve-btn', function () {
            var id = $(this).data('id');
            apiFetch(api + '/session/' + id + '/status', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ status: 'approved' }),
            }).then(function () { location.reload(); });
        });

        $list.on('click', '.cc-reject-btn', function () {
            var id = $(this).data('id');
            apiFetch(api + '/session/' + id + '/status', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ status: 'rejected' }),
            }).then(function () { location.reload(); });
        });
    }

    $(document).ready(function () {
        initCrud();
        initOrders();
    });

}(jQuery));
