/**
 * RandomScraper — Módulo Random Player para Futbin Hub
 * Versão: 1.0.8
 *
 * Implementa o contrato do Hub:
 *   start(params, callbacks)  → processa fila de pedidos pendentes
 *   stop()                    → interrompe o scraping
 *
 * Fluxo:
 *   1. Lê fila pendente via GET {apiBase}/queue
 *   2. Para cada pedido: busca páginas aleatórias de listagem por faixa de preço
 *   3. Extrai candidatos, seleciona aleatoriamente, busca detalhes de cada jogador
 *   4. Salva resultado via AJAX fhub_random_save
 *
 * Callbacks disponíveis:
 *   callbacks.onLog(message, type)         type: 'info'|'success'|'warning'|'error'
 *   callbacks.onProgress(current, total)
 *   callbacks.onStats(statsObject)
 *   callbacks.onPhase(text, color)
 *   callbacks.onComplete(summary)
 *   callbacks.onError(message)
 */

var RandomScraper = (function () {
    'use strict';

    // ================================================================
    // ESTADO INTERNO
    // ================================================================

    var _running   = false;
    var _callbacks = null;
    var _params    = null;

    var _stats = {
        requests:   0,
        processed:  0,
        players:    0,
        saved:      0,
        errors:     0
    };

    // ================================================================
    // CONFIGURAÇÃO
    // ================================================================

    var CFG = {
        BASE:             'https://www.futbin.com',
        PLAYERS_LIST:     'https://www.futbin.com/players',
        MAX_PAGES_RANDOM: 3,       // páginas aleatórias por faixa
        PAGES_POOL:       [2,3,4,5,6,7,8,9,10],
        NAV_DELAY:        2000,
        RETRY_DELAY:      5000,
        MAX_RETRIES:      3,
        RANDOM_DELAY_MIN: 600,
        RANDOM_DELAY_MAX: 1400
    };

    // Proxy via extensão (mesmo padrão do SBC)

    // ================================================================
    // INTERFACE PÚBLICA
    // ================================================================

    function start(params, callbacks) {
        if (_running) {
            callbacks.onLog('Módulo já está em execução.', 'warning');
            return;
        }

        _running   = true;
        _callbacks = callbacks;
        _params    = params;

        _stats = { requests: 0, processed: 0, players: 0, saved: 0, errors: 0 };

        _log('═══ Random Player Scraper v1.0.2 iniciado ═══', 'info');

        _run().catch(function (err) {
            _callbacks.onError('Exceção não tratada: ' + err.message);
            _running = false;
        });
    }

    function stop() {
        _running = false;
    }

    // ================================================================
    // LOG / CALLBACKS INTERNOS
    // ================================================================

    function _log(msg, type) {
        if (_callbacks) _callbacks.onLog(msg, type || 'info');
    }

    function _phase(text, color) {
        if (_callbacks) _callbacks.onPhase(text, color);
    }

    function _progress(cur, total) {
        if (_callbacks) _callbacks.onProgress(cur, total);
    }

    function _pushStats() {
        if (_callbacks) _callbacks.onStats({
            'Pedidos':    _stats.requests,
            'Processados':_stats.processed,
            'Players':    _stats.players,
            'Salvos DB':  _stats.saved,
            'Erros':      _stats.errors
        });
    }

    function _sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function _randomDelay() {
        var d = Math.random() * (CFG.RANDOM_DELAY_MAX - CFG.RANDOM_DELAY_MIN) + CFG.RANDOM_DELAY_MIN;
        return _sleep(d);
    }

    // ================================================================
    // NORMALIZAÇÃO DE PREÇO (formato Futbin: "197K", "1.54M", "900")
    // ================================================================

    function _normalizePrice(str) {
        if (!str) return 0;
        var s = String(str).trim().toUpperCase().replace(/[^\d.KM]/g, '');
        if (!s || s === '0') return 0;
        try {
            if (s.indexOf('M') !== -1) return Math.round(parseFloat(s) * 1000000);
            if (s.indexOf('K') !== -1) return Math.round(parseFloat(s) * 1000);
            return parseInt(s, 10) || 0;
        } catch(e) { return 0; }
    }

    function _formatPriceRange(min, max) {
        return min + '-' + max;
    }

    // ================================================================
    // HELPERS DE PARSE (idênticos ao SbcScraper — mesmo DOM do Futbin)
    // ================================================================

    function _txtOrNull(node) {
        if (!node) return null;
        var t = node.textContent.trim();
        return t || null;
    }

    function _normalizeName(str) {
        if (!str) return null;
        var s = String(str).replace(/\s+/g, ' ').trim();
        return s || null;
    }

    function _absUrl(src) {
        if (!src) return null;
        src = src.trim();
        if (src.indexOf('http') === 0) return src;
        if (src.charAt(0) === '/' && src.charAt(1) !== '/') return CFG.BASE + src;
        if (src.charAt(0) === '/' && src.charAt(1) === '/') return 'https:' + src;
        return src;
    }

    function _parseCssVars(style) {
        var out = {};
        if (!style) return out;
        var re = /--([a-zA-Z0-9\-]+)\s*:\s*([^;]+)/g;
        var m;
        while ((m = re.exec(style)) !== null) out[m[1]] = m[2].trim();
        return out;
    }

    function _simpleHash(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + c;
            hash |= 0;
        }
        return Math.abs(hash).toString(16).substring(0, 12);
    }

    function _svgToDict(svgEl) {
        if (!svgEl) return {};
        var raw      = svgEl.outerHTML;
        var h        = _simpleHash(raw);
        var st       = (svgEl.getAttribute('style') || '').trim();
        var classes  = svgEl.getAttribute('class') || '';
        var classList = classes.split(/\s+/).filter(function (c) { return c; });
        var primaryClass = '';
        for (var i = 0; i < classList.length; i++) {
            if (classList[i] && classList[i].toLowerCase() !== 'null') {
                primaryClass = classList[i]; break;
            }
        }
        if (!primaryClass && classList.length) primaryClass = classList[0];
        return {
            'class':   primaryClass,
            classes:   classList,
            viewBox:   svgEl.getAttribute('viewBox') || svgEl.getAttribute('viewbox') || null,
            width:     svgEl.getAttribute('width')   || null,
            height:    svgEl.getAttribute('height')  || null,
            style_raw: st,
            css_vars:  _parseCssVars(st),
            svg_raw:   raw,
            svg_hash:  h
        };
    }

    function _pickPlayerFaceImg(card) {
        var tag = card.querySelector('img.playercard-26-special-img')
               || card.querySelector('img.playercard-26-base-img');
        if (tag) return _absUrl(tag.getAttribute('src'));
        var imgs = card.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
            var cls = imgs[i].getAttribute('class') || '';
            if (/playercard-26-.*-img/.test(cls) && cls.indexOf('playercard-26-bg') === -1) {
                return _absUrl(imgs[i].getAttribute('src'));
            }
        }
        return null;
    }

    // ================================================================
    // PREÇOS (página de detalhe do jogador)
    // ================================================================

    function _extractPrices(doc) {
        function norm(txt) {
            if (!txt) return null;
            var t = String(txt).trim();
            if (t.length > 30) return null;
            var digits = t.replace(/\D/g, '');
            if (!digits) return null;
            try { if (parseInt(digits) === 0) return null; } catch(e) { return null; }
            return t;
        }
        function lastValid(els) {
            var last = null;
            for (var i = 0; i < els.length; i++) {
                var v = norm(els[i].textContent.trim());
                if (v) last = v;
            }
            return last;
        }

        var psBox = doc.querySelector('.price-box.platform-ps-only, .price-box.platform-ps');
        var pcBox = doc.querySelector('.price-box.platform-pc-only, .price-box.platform-pc');

        var console_price = null, pc = null, estimated = null;

        if (psBox) {
            console_price = lastValid(psBox.querySelectorAll('.lowest-price'))
                         || lastValid(psBox.querySelectorAll('.estimated-price'));
        }
        if (pcBox) {
            pc = lastValid(pcBox.querySelectorAll('.lowest-price'))
              || lastValid(pcBox.querySelectorAll('.estimated-price'));
        }
        if (!console_price) console_price = lastValid(doc.querySelectorAll('.lowest-price'));
        if (!estimated)     estimated     = lastValid(doc.querySelectorAll('.estimated-price'));
        if (!pc && estimated && !console_price) pc = estimated;

        return { console: console_price, pc: pc, estimated: estimated };
    }

    // ================================================================
    // PARSE: ALT SIDEBAR
    // ================================================================

    function _parseAltSidebarRight(card) {
        var right = card.querySelector('.playercard-26-alt-sidebar.right');
        if (!right) {
            var all = card.querySelectorAll('.playercard-26-alt-sidebar');
            if (all.length === 1) right = all[0];
        }
        if (!right) return {};

        var altPos = right.querySelector('.playercard-26-alt-pos');
        var rawSt  = altPos ? (altPos.getAttribute('style') || '').trim() : '';
        var css    = _parseCssVars(rawSt);
        var svgData = {};
        var svg    = altPos ? altPos.querySelector('svg') : null;
        if (svg) svgData = _svgToDict(svg);

        var positions = [];
        right.querySelectorAll('.playercard-26-alt-pos-sub').forEach(function (sub) {
            var label = null;
            for (var i = 0; i < sub.childNodes.length; i++) {
                var node = sub.childNodes[i];
                if (node.nodeType === 3) { var t = node.textContent.trim(); if (t) { label = t; break; } }
            }
            if (!label) label = sub.textContent.trim();
            var pp = sub.querySelector('.playercard-26-alt-pos-sub-plus-plus') !== null;
            positions.push({ pos: label, plus_plus: pp });
        });

        return {
            style_raw: rawSt, css_vars: css,
            styles: {
                alt_pos_background: css['alt-pos-background'] || null,
                alt_pos_border:     css['alt-pos-border']     || null
            },
            positions: positions, svg: svgData
        };
    }

    function _parseAltSidebarLeft(card) {
        var left = card.querySelector('.playercard-26-alt-sidebar.left');
        if (!left) return {};
        var wrap = left.querySelector('.playercard-26-playstyles-wrapper');
        if (!wrap) return { playstyles: { count: 0, classes: [], items: [] } };

        var items = [], classes = [];
        wrap.querySelectorAll('svg').forEach(function (svg) {
            var d   = _svgToDict(svg);
            var cls = (svg.getAttribute('class') || '').trim();
            classes.push(cls);
            items.push({ 'class': cls, style_raw: d.style_raw, css_vars: d.css_vars,
                viewBox: d.viewBox, width: d.width, height: d.height,
                svg_raw: d.svg_raw, svg_hash: d.svg_hash });
        });
        return { playstyles: { count: items.length, classes: classes, items: items } };
    }

    function _parseAltSidebar(card) {
        var r = _parseAltSidebarRight(card);
        var l = _parseAltSidebarLeft(card);
        return { right: r, left: l, positions: r.positions || [], styles: r.styles || {}, svg: r.svg || {} };
    }

    // ================================================================
    // PARSE: PLAYSTYLES
    // ================================================================

    function _parsePlaystyles(card) {
        var out  = { count: 0, classes: [], items: [], svgs: [] };
        var left = card.querySelector('.playercard-26-alt-sidebar.left');
        var wrap = left ? left.querySelector('.playercard-26-playstyles-wrapper') : null;
        if (!wrap) wrap = card.querySelector('.playercard-26-playstyles-wrapper');
        if (!wrap) return out;

        card.querySelectorAll('.playercard-26-alt-sidebar.left .playercard-26-playstyles-wrapper svg').forEach(function (svg) {
            var d   = _svgToDict(svg);
            var cls = (svg.getAttribute('class') || '').trim();
            out.classes.push(cls);
            out.svgs.push({ 'class': cls, viewBox: d.viewBox, svg_raw: d.svg_raw });
            out.items.push({ 'class': cls, style_raw: d.style_raw, css_vars: d.css_vars,
                viewBox: d.viewBox, width: d.width, height: d.height,
                svg_raw: d.svg_raw, svg_hash: d.svg_hash });
        });
        out.count = out.items.length;
        return out;
    }

    // ================================================================
    // PARSE: EXTRA INFO
    // ================================================================

    function _parseExtraInfo(card) {
        var root = card.querySelector('.playercard-26-extra-info');
        if (!root) return {};

        var styleRaw = (root.getAttribute('style') || '').trim();
        var css      = _parseCssVars(styleRaw);

        var futbinRating = _txtOrNull(root.querySelector('.playercard-26-futbin-rating'));
        var bannerSvg    = root.querySelector('svg.playercard-26-extra-info-svg');
        var bannerData   = bannerSvg ? _svgToDict(bannerSvg) : {};

        var footText = null, skillsNum = null, wfNum = null;

        var footDiv = root.querySelector('.playercard-26-right-foot');
        if (footDiv) { var ft = _txtOrNull(footDiv); footText = ft ? ft.charAt(0) : null; }

        var skillsDiv = root.querySelector('.playercard-26-right-skills');
        if (skillsDiv) {
            var st = _txtOrNull(skillsDiv);
            if (st) { var m = st.match(/\d+/); skillsNum = m ? parseInt(m[0]) : null; }
        }

        var wfDiv = root.querySelector('.playercard-26-right-wf');
        if (wfDiv) {
            var span = wfDiv.querySelector('span');
            if (span) { var sv = span.textContent.trim(); if (/^\d+$/.test(sv)) wfNum = parseInt(sv); }
        }
        if (wfNum === null) {
            var m2 = root.textContent.match(/(\d+)\s*★/);
            if (m2) wfNum = parseInt(m2[1]);
        }

        var basicItems = root.querySelectorAll('.playercard-26-extra-info-basic-item');
        var basicText  = [], basicStruct = [];
        basicItems.forEach(function (bi) {
            var bt = bi.textContent.replace(/\s+/g, ' ').trim();
            if (bt) basicText.push(bt);
            var biSvgs = [];
            bi.querySelectorAll('svg').forEach(function (s) { biSvgs.push(_svgToDict(s)); });
            basicStruct.push({ text: bt, svgs: biSvgs });
        });

        if (footText === null && basicText.length >= 1) {
            var t0 = (basicText[0] || '').trim().toUpperCase();
            if (t0 === 'R' || t0 === 'L') footText = t0;
        }
        if (skillsNum === null) {
            for (var i = 0; i < basicText.length; i++) {
                var m3 = basicText[i].match(/\d+/);
                if (m3) { var n = parseInt(m3[0]); if (n >= 1 && n <= 5) { skillsNum = n; break; } }
            }
        }

        var footSvgTag = root.querySelector('svg.playercard-26-foot-svg')
                      || root.querySelector('svg.playercard-26-right-foot-svg');
        var footSvg    = footSvgTag ? _svgToDict(footSvgTag) : {};

        if (wfNum === null && footSvgTag) {
            var pi = footSvgTag.closest('.playercard-26-extra-info-basic-item');
            if (pi) { var m4 = pi.textContent.replace(/\s+/g, ' ').trim().match(/\d+/); if (m4) wfNum = parseInt(m4[0]); }
        }

        return {
            style_raw: styleRaw, css_vars: css,
            styles: {
                extra_info_bg:     css['extra-info-bg']     || null,
                extra_info_border: css['extra-info-border'] || null
            },
            banner_svg:        bannerData,
            futbin_rating:     futbinRating,
            foot_svg:          footSvg,
            basic_items:       basicStruct,
            basic_items_count: basicText.length,
            basic_items_text:  basicText,
            foot:              footText,
            skill_moves:       skillsNum,
            weak_foot:         wfNum
        };
    }

    // ================================================================
    // PARSE: PÁGINA DE DETALHE DO JOGADOR
    // ================================================================

    function _parsePlayerPage(doc, playerUrl) {
        var card = doc.querySelector('.playercard-26');
        if (!card) {
            _log('Card não encontrado: ' + playerUrl, 'warning');
            return null;
        }

        var cardStyleRaw = (card.getAttribute('style') || '').trim();
        var cardCssVars  = _parseCssVars(cardStyleRaw);

        var rating   = _txtOrNull(card.querySelector('.playercard-26-rating'));
        var position = _txtOrNull(card.querySelector('.playercard-26-position'));
        var rolePlus = _txtOrNull(card.querySelector('.playercard-26-role-plus'));
        var name     = _normalizeName(_txtOrNull(card.querySelector('.playercard-26-name')));

        var bg    = card.querySelector('img.playercard-26-bg');
        var bgSrc = _absUrl(bg ? bg.getAttribute('src') : null);
        var face  = _pickPlayerFaceImg(card);

        var statsObj = {};
        card.querySelectorAll('.playercard-26-extended-stats .playercard-26-stats').forEach(function (it) {
            var key = _txtOrNull(it.querySelector('.playercard-26-stat-value'));
            var val = _txtOrNull(it.querySelector('.playercard-26-stat-number'));
            if (key && val) statsObj[key.toUpperCase()] = val;
        });

        var info = {};
        var row  = card.querySelector('.playercard-26-info-row, .playercard-info-row');
        if (row) {
            row.querySelectorAll('img').forEach(function (img) {
                var alt   = (img.getAttribute('alt')   || '').trim().toLowerCase();
                var title = (img.getAttribute('title') || '').trim();
                var src   = _absUrl(img.getAttribute('src'));
                var cls   = (img.getAttribute('class') || '').toLowerCase();
                var key   = null;
                if      (alt.indexOf('nation') !== -1 || cls.indexOf('nation') !== -1) key = 'nation';
                else if (alt.indexOf('league') !== -1 || cls.indexOf('league') !== -1) key = 'league';
                else if (alt.indexOf('club')   !== -1 || cls.indexOf('club')   !== -1) key = 'club';
                if (key) info[key] = { title: title, src: src };
            });
        }

        var prices = _extractPrices(doc);

        _log('   └─ ' + name + ' | ' + rating + ' ' + position +
            ' | Console=' + (prices.console || 'N/A') +
            ' PC='        + (prices.pc      || 'N/A'), 'success');

        return {
            player_url:     playerUrl,
            name:           name,
            rating:         rating,
            position:       position,
            role_plus:      rolePlus,
            images:         { bg: bgSrc, face: face },
            stats:          statsObj,
            info:           info,
            prices:         prices,
            card_style_raw: cardStyleRaw,
            card_css_vars:  cardCssVars,
            alt_sidebar:    _parseAltSidebar(card),
            playstyles:     _parsePlaystyles(card),
            extra_info:     _parseExtraInfo(card)
        };
    }

    // ================================================================
    // PARSE: LISTAGEM DE JOGADORES (futbin.com/players?ps_price=MIN-MAX)
    // Extrai candidatos de uma página de listagem
    // ================================================================

    function _extractCandidates(doc, minPrice, maxPrice, platform) {
        var candidates = [];

        // Seletores de linha — Futbin usa tbody > tr.player-row
        var rows = doc.querySelectorAll('tbody.with-border tr.player-row, tbody tr.player-row, tr.player-row');
        if (!rows || !rows.length) return candidates;

        var priceClass = platform === 'pc' ? 'platform-pc-only' : 'platform-ps-only';

        rows.forEach(function (row) {
            try {
                // ── Link do jogador ──────────────────────────────
                var linkEl = row.querySelector('td.table-name a.player-row-playercard')
                          || row.querySelector('td.table-name .table-player-info a.table-player-name')
                          || row.querySelector('td.table-name a[href*="/player/"]');

               if (!linkEl) return;

        // ── Filtro: ignora cards SBC ────────────────────────
        var revisionEl   = row.querySelector('.table-player-revision');
        var revisionText = revisionEl ? revisionEl.textContent.trim().toUpperCase() : '';
        if (revisionText === 'SBC') return;
        // ────────────────────────────────────────────────────

        var href = linkEl.getAttribute('href') || '';
                var match = href.match(/\/\d+\/player\/(\d+)\/([^\/\?]+)/);
                if (!match) return;

                var playerId   = match[1];
                var playerSlug = match[2];
                var playerUrl  = href.indexOf('http') === 0 ? href : CFG.BASE + href;

                // ── Preço ─────────────────────────────────────────
                var priceEl = row.querySelector('.table-price.' + priceClass + ' .price')
                           || row.querySelector('.table-price .price');

                var priceText    = priceEl ? priceEl.textContent.trim() : null;
                var priceNumeric = _normalizePrice(priceText);

                // Valida se está dentro da faixa
                if (priceNumeric > 0 && (priceNumeric < minPrice || priceNumeric > maxPrice)) {
                    return;
                }

                candidates.push({
                    id:           playerId,
                    slug:         playerSlug,
                    url:          playerUrl,
                    price:        priceText,
                    price_numeric: priceNumeric,
                    requested_range: { min: minPrice, max: maxPrice }
                });

            } catch(e) {
                // linha inválida, ignora
            }
        });

        return candidates;
    }

    // ================================================================
    // BUSCA DE CANDIDATOS POR FAIXA (páginas aleatórias + fallback)
    // ================================================================

    async function _getCandidatesForRange(minPrice, maxPrice, count, platform) {
        var priceParam = platform === 'pc' ? 'pc_price' : 'ps_price';
        var priceRange = _formatPriceRange(minPrice, maxPrice);
        var all        = [];

        // Embaralha pool de páginas e pega as primeiras CFG.MAX_PAGES_RANDOM
        var pool = CFG.PAGES_POOL.slice();
        for (var p = pool.length - 1; p > 0; p--) {
            var j    = Math.floor(Math.random() * (p + 1));
            var tmp  = pool[p]; pool[p] = pool[j]; pool[j] = tmp;
        }
        var pagesToTry = pool.slice(0, CFG.MAX_PAGES_RANDOM);

        _log('  ○ Faixa ' + priceRange + ' | Páginas: ' + pagesToTry.join(', '), 'info');

        for (var pi = 0; pi < pagesToTry.length; pi++) {
            if (!_running) break;

            var url = CFG.PLAYERS_LIST + '?page=' + pagesToTry[pi] + '&' + priceParam + '=' + priceRange;
            var doc = await _fetchPage(url);

            if (doc) {
                var found = _extractCandidates(doc, minPrice, maxPrice, platform);
                all = all.concat(found);
                _log('  ○ Página ' + pagesToTry[pi] + ': ' + found.length + ' candidatos', 'info');
                if (all.length >= count * 3) break; // margem suficiente
            }

            await _sleep(CFG.NAV_DELAY);
        }

        // Fallback: página 1 se candidatos insuficientes
        if (_running && all.length < count) {
            _log('  ○ Fallback página 1 para faixa ' + priceRange, 'warning');
            var urlP1 = CFG.PLAYERS_LIST + '?page=1&' + priceParam + '=' + priceRange;
            var docP1 = await _fetchPage(urlP1);
            if (docP1) {
                var foundP1 = _extractCandidates(docP1, minPrice, maxPrice, platform);
                all = all.concat(foundP1);
                _log('  ○ Página 1 (fallback): ' + foundP1.length + ' candidatos', 'info');
            }
        }

        // Deduplicação por ID
        var unique = {}, deduped = [];
        for (var ci = 0; ci < all.length; ci++) {
            if (!unique[all[ci].id]) {
                unique[all[ci].id] = true;
                deduped.push(all[ci]);
            }
        }

        // Embaralha e retorna com margem
        for (var di = deduped.length - 1; di > 0; di--) {
            var dj   = Math.floor(Math.random() * (di + 1));
            var dtmp = deduped[di]; deduped[di] = deduped[dj]; deduped[dj] = dtmp;
        }

        return deduped.slice(0, count * 2);
    }

    // ================================================================
    // PROCESSAMENTO DE UM PEDIDO DA FILA
    // ================================================================

    async function _processRequest(req) {
        var startTime  = Date.now();
        var ranges     = req.ranges   || [];
        var platform   = req.platform || 'ps';
        var queueId    = req.queue_id;

        _log('▶ Processando pedido ' + queueId + ' | ' + req.requested_total + ' jogadores | platform=' + platform, 'info');

        // ── Coleta candidatos de todas as faixas ──────────────────
        var allCandidates = [];

        for (var ri = 0; ri < ranges.length; ri++) {
            if (!_running) break;

            var range = ranges[ri];
            _log(' ➤ Faixa ' + (ri + 1) + '/' + ranges.length +
                ': min=' + range.min + ' max=' + range.max + ' count=' + range.count, 'info');

            var candidates = await _getCandidatesForRange(
                range.min, range.max, range.count, platform
            );

            _log(' ✓ ' + candidates.length + ' candidatos encontrados na faixa', 'success');
            allCandidates = allCandidates.concat(candidates);
        }

        if (!allCandidates.length) {
            _log('Nenhum candidato encontrado para o pedido ' + queueId, 'warning');
            await _saveResults(queueId, [], '0s', 'failed', 'Nenhum candidato encontrado nas faixas solicitadas');
            return 0;
        }

        // Deduplicação global
        var seen = {}, deduped = [];
        for (var ci = 0; ci < allCandidates.length; ci++) {
            if (!seen[allCandidates[ci].id]) {
                seen[allCandidates[ci].id] = true;
                deduped.push(allCandidates[ci]);
            }
        }

        // Embaralha e seleciona total solicitado
        for (var si = deduped.length - 1; si > 0; si--) {
            var sj   = Math.floor(Math.random() * (si + 1));
            var stmp = deduped[si]; deduped[si] = deduped[sj]; deduped[sj] = stmp;
        }

        var selected = deduped.slice(0, req.requested_total);
        _log('Selecionados ' + selected.length + '/' + req.requested_total + ' jogadores para detalhe', 'info');

        // ── Busca detalhes de cada jogador selecionado ────────────
        var detailedPlayers = [];

        _progress(0, selected.length);

        for (var ii = 0; ii < selected.length; ii++) {
            if (!_running) break;

            var candidate = selected[ii];
            _log(' 👤 ' + (ii + 1) + '/' + selected.length + ': ' + candidate.url.substring(0, 60) + '...', 'info');

            var playerDoc = await _fetchPage(candidate.url);
            if (!playerDoc) {
                _log('  Player não carregou, pulando...', 'warning');
                _stats.errors++;
                _progress(ii + 1, selected.length);
                continue;
            }

            var playerDetails = _parsePlayerPage(playerDoc, candidate.url);
            if (!playerDetails) {
                _log('  Card não encontrado na página, pulando...', 'warning');
                _stats.errors++;
                _progress(ii + 1, selected.length);
                continue;
            }

            // Monta objeto final no mesmo formato do scraper Python
            var playerObj = {
                id:         candidate.id,
                slug:       candidate.slug,
                price_info: {
                    price:           candidate.price,
                    price_numeric:   candidate.price_numeric,
                    requested_range: candidate.requested_range
                }
            };

            // Mescla dados de detalhe
            for (var key in playerDetails) {
                if (playerDetails.hasOwnProperty(key)) playerObj[key] = playerDetails[key];
            }

            detailedPlayers.push(playerObj);
            _stats.players++;
            _pushStats();
            _progress(ii + 1, selected.length);

            if (ii < selected.length - 1 && _running) await _sleep(CFG.NAV_DELAY);
        }

        var execTime = ((Date.now() - startTime) / 1000).toFixed(2) + 's';
        _log('✅ Pedido ' + queueId + ': ' + detailedPlayers.length + ' players em ' + execTime, 'success');

        await _saveResults(queueId, detailedPlayers, execTime, 'completed', '');
        return detailedPlayers.length;
    }

    // ================================================================
    // FETCH COM PROXIES + RETRY
    // ================================================================

    async function _fetchPage(url, retryCount) {
        retryCount = retryCount || 0;

        _log('  Buscando (via background): ' + url.substring(0, 70) + '...', 'info');

        try {
            await _randomDelay();

            var result = await new Promise(function (resolve, reject) {
                var requestId = 'fhub_' + Date.now() + '_' + Math.random().toString(36).slice(2);

                var timer = setTimeout(function () {
                    window.removeEventListener('message', handler);
                    reject(new Error('Timeout aguardando resposta do background'));
                }, 15000);

                function handler(event) {
                    if (event.source !== window) return;
                    if (!event.data || event.data.type !== 'FHUB_FETCH_RESPONSE') return;
                    if (event.data.requestId !== requestId) return;

                    clearTimeout(timer);
                    window.removeEventListener('message', handler);
                    resolve(event.data.response);
                }

                window.addEventListener('message', handler);
                window.postMessage({ type: 'FHUB_FETCH_REQUEST', requestId: requestId, url: url }, '*');
            });

            if (!result || !result.ok) {
                throw new Error('HTTP ' + (result ? result.status : 'sem resposta'));
            }

            var html = result.text;

            if (html.indexOf('cf-challenge') !== -1 || html.indexOf('Just a moment') !== -1) {
                throw new Error('Cloudflare challenge');
            }

            if (html.length < 50000) {
                throw new Error('Resposta pequena demais: ' + (html.length / 1024).toFixed(1) + ' KB');
            }

            _log('  Recebido: ' + (html.length / 1024).toFixed(1) + ' KB', 'success');

            var parser = new DOMParser();
            var doc    = parser.parseFromString(html, 'text/html');

            var baseOrigin;
            try { baseOrigin = new URL(url).origin; } catch(e) { baseOrigin = CFG.BASE; }

            doc.querySelectorAll('[href]').forEach(function (el) {
                var h = el.getAttribute('href');
                if (h && h.charAt(0) === '/' && h.charAt(1) !== '/') el.setAttribute('href', baseOrigin + h);
            });
            doc.querySelectorAll('[src]').forEach(function (el) {
                var s = el.getAttribute('src');
                if (s && s.charAt(0) === '/' && s.charAt(1) !== '/') el.setAttribute('src', baseOrigin + s);
            });

            return doc;

        } catch (err) {
            _log('  Falhou: ' + err.message, 'error');

            if (retryCount < CFG.MAX_RETRIES) {
                _log('  Retry ' + (retryCount + 1) + '/' + CFG.MAX_RETRIES + ' para: ' + url.substring(0, 50), 'warning');
                await _sleep(CFG.RETRY_DELAY);
                return _fetchPage(url, retryCount + 1);
            }

            _log('  Desistindo: ' + url.substring(0, 60), 'error');
            return null;
        }
    }

    // ================================================================
    // LEITURA DA FILA (GET REST)
    // ================================================================

    async function _fetchQueue() {
        try {
            var url      = _params.apiBase + '/queue?status=pending';
            var response = await fetch(url, {
                method:  'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) throw new Error('HTTP ' + response.status);

            var data = await response.json();
            return (data && data.items) ? data.items : [];

        } catch (err) {
            _log('Erro ao ler fila: ' + err.message, 'error');
            return [];
        }
    }

    // ================================================================
    // SALVAMENTO DO RESULTADO (AJAX fhub_random_save)
    // ================================================================

    async function _saveResults(queueId, players, executionTime, status, errorMessage) {
        _log('Salvando resultado do pedido ' + queueId + '...', 'info');

        try {
            var payload = JSON.stringify({
                queue_id:       queueId,
                players:        players,
                execution_time: executionTime,
                status:         status,
                error_message:  errorMessage || '',
                nonce:          _params.nonce
            });

            var response = await fetch(_params.ajaxUrl + '?action=' + _params.ajaxAction, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    payload
            });

            if (!response.ok) throw new Error('HTTP ' + response.status);

            var result = await response.json();

            if (result.success) {
                _stats.saved += result.data.inserted || 0;
                _pushStats();
                _log('Salvo: ' + result.data.inserted + ' players | status=' + result.data.status, 'success');
            } else {
                _log('Erro ao salvar: ' + (result.data || 'desconhecido'), 'error');
            }

        } catch (err) {
            _log('Erro de rede ao salvar: ' + err.message, 'error');
        }
    }

    // ================================================================
    // FLUXO PRINCIPAL
    // ================================================================

    async function _run() {

        // ── Fase 1: Lê fila pendente ──────────────────────────────
        _phase('📋 Lendo fila de pedidos...', '#3182ce');
        _log('═════ FASE 1: LEITURA DA FILA ═════', 'info');

        var queue = await _fetchQueue();
        _stats.requests = queue.length;
        _pushStats();

        if (!queue.length) {
            _log('Nenhum pedido pendente na fila.', 'warning');
            _running = false;
            _callbacks.onComplete({ 'Pedidos pendentes': 0 });
            return;
        }

        _log('✅ ' + queue.length + ' pedido(s) pendente(s)', 'success');

        // ── Fase 2: Processa cada pedido ──────────────────────────
        _phase('🔍 Processando pedidos...', '#e67e22');
        _log('═════ FASE 2: PROCESSAMENTO ═════', 'info');
        _progress(0, queue.length);

        for (var i = 0; i < queue.length; i++) {
            if (!_running) break;

            var req = queue[i];
            _log('━━━ Pedido ' + (i + 1) + '/' + queue.length + ' ━━━', 'info');

            try {
                var found = await _processRequest(req);
                _stats.processed++;
            } catch (err) {
                _log('Erro no pedido ' + req.queue_id + ': ' + err.message, 'error');
                _stats.errors++;
                await _saveResults(req.queue_id, [], '0s', 'failed', err.message);
            }

            _pushStats();
            _progress(i + 1, queue.length);

            if (i < queue.length - 1 && _running) await _sleep(CFG.NAV_DELAY);
        }

        // ── Conclusão ─────────────────────────────────────────────
        _running = false;

        _log('═════ CONCLUÍDO ═════', 'success');
        _log('Pedidos: ' + _stats.requests +
            ' | Processados: ' + _stats.processed +
            ' | Players: ' + _stats.players +
            ' | Salvos: ' + _stats.saved, 'success');

        _callbacks.onComplete({
            'Pedidos':     _stats.requests,
            'Processados': _stats.processed,
            'Players':     _stats.players,
            'Salvos DB':   _stats.saved,
            'Erros':       _stats.errors
        });
    }

    // ================================================================
    // EXPORT PÚBLICO
    // ================================================================

    return { start: start, stop: stop };

})();