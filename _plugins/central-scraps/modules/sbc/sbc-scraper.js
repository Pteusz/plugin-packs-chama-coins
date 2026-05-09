/**
 * SbcScraper — Módulo SBC para Futbin Hub
 * Versão: 1.0.7
 *
 * Implementa o contrato do Hub:
 *   start(params, callbacks)  → inicia o scraping
 *   stop()                    → interrompe o scraping
 *
 * Toda comunicação com a UI é feita exclusivamente via callbacks.
 * Nenhum acesso direto ao DOM.
 *
 * Callbacks disponíveis:
 *   callbacks.onLog(message, type)         type: 'info'|'success'|'warning'|'error'
 *   callbacks.onProgress(current, total)
 *   callbacks.onStats(statsObject)         { Páginas, SBCs, Players, Recompensas, 'Salvos DB' }
 *   callbacks.onPhase(text, color)
 *   callbacks.onComplete(summary)
 *   callbacks.onError(message)
 */

var SbcScraper = (function () {
    'use strict';

    // ================================================================
    // ESTADO INTERNO
    // ================================================================

    var _running      = false;
    var _callbacks    = null;
    var _params       = null;
    var _scrapeToken  = null;

    var _stats = {
        pages:   0,
        sbcs:    0,
        players: 0,
        rewards: 0,
        saved:   0
    };

    var _meta = {
        timestamp:   null,
        pages:       0,
        cards_total: 0,
        jogadores:   0,
        recompensas: 0
    };

    // ================================================================
    // CONFIGURAÇÃO (pode ser sobrescrita via params no futuro)
    // ================================================================

    var CFG = {
        BASE:             'https://www.futbin.com',
        LIST:             'https://www.futbin.com/squad-building-challenges',
        MAX_PAGES:        8,
        NAV_DELAY:        2500,
        RETRY_DELAY:      5000,
        MAX_RETRIES:      3,
        BATCH_SIZE:       5,
        RANDOM_DELAY_MIN: 500,
        RANDOM_DELAY_MAX: 1500
    };

    var CORS_PROXIES = [
        'http://localhost:8765/'
     
 
    ];

    // ================================================================
    // INTERFACE PÚBLICA
    // ================================================================

    function start(params, callbacks) {
        if (_running) {
            callbacks.onLog('Módulo já está em execução.', 'warning');
            return;
        }

        _running     = true;
        _callbacks   = callbacks;
        _params      = params;
        _scrapeToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

        _stats = { pages: 0, sbcs: 0, players: 0, rewards: 0, saved: 0 };
        _meta  = {
            timestamp:    new Date().toISOString(),
            scrape_token: _scrapeToken,
            pages:        0,
            cards_total:  0,
            jogadores:    0,
            recompensas:  0
        };

        _log('═══ SBC Scraper v1.0.0 iniciado ═══', 'info');
        _run().catch(function (err) {
            _callbacks.onError('Exceção não tratada: ' + err.message);
            _running = false;
        });
    }

    function stop() {
        _running = false;
    }

    // ================================================================
    // HELPERS INTERNOS
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
            'Páginas':    _stats.pages,
            'SBCs':       _stats.sbcs,
            'Players':    _stats.players,
            'Recompensas':_stats.rewards,
            'Salvos DB':  _stats.saved
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
    // HELPERS DE PARSE
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
    // PREÇOS
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

        if (psBox) console_price = lastValid(psBox.querySelectorAll('.lowest-price'))
                                || lastValid(psBox.querySelectorAll('.estimated-price'));
        if (pcBox) pc = lastValid(pcBox.querySelectorAll('.lowest-price'))
                     || lastValid(pcBox.querySelectorAll('.estimated-price'));
        if (!console_price) console_price = lastValid(doc.querySelectorAll('.lowest-price'));
        if (!estimated)     estimated     = lastValid(doc.querySelectorAll('.estimated-price'));
        if (!pc && estimated && !console_price) pc = estimated;

        return { console: console_price, pc: pc, estimated: estimated };
    }

    // ================================================================
    // PARSE: CABEÇALHO DO SBC (reward_name + reward_image)
    // ================================================================

    var REWARD_NAME_SEL = [
        '.sbc-set-title', '.sbc-header-title', '.sbc-challenge-title',
        '.page-title h1', 'h1.title', 'h1', '.sbc-name'
    ];

    function _parseRewardHeader(doc) {
        var rewardName = null;
        for (var i = 0; i < REWARD_NAME_SEL.length; i++) {
            var el = doc.querySelector(REWARD_NAME_SEL[i]);
            if (el) { var c = _normalizeName(el.textContent); if (c) { rewardName = c; break; } }
        }
        var rewardImage = null;
        var setEl = doc.querySelector('img.sbc-set-image')
                 || doc.querySelector('img.sbc-set.sbc-set-image')
                 || doc.querySelector('.sbc-rewards-area img.sbc-set')
                 || doc.querySelector('img.sbc-set');
        if (setEl) rewardImage = _absUrl(setEl.getAttribute('src'));
        return { reward_name: rewardName, reward_image: rewardImage };
    }

    // ================================================================
    // PARSE: CARD NA LISTAGEM
    // ================================================================

    var LISTING_NAME_SEL = [
        '.sbc-card-name', '.sbc-set-name', '.sbc-card-title',
        '.sbc-title', '.card-title', '.name', 'h2', 'h3'
    ];

    function _parseListingCard(card) {
        var cardName = null;
        for (var i = 0; i < LISTING_NAME_SEL.length; i++) {
            var el = card.querySelector(LISTING_NAME_SEL[i]);
            if (el) { var c = _normalizeName(el.textContent); if (c) { cardName = c; break; } }
        }
        var cardImage = null;
        var setImg = card.querySelector('img.sbc-set-image')
                  || card.querySelector('img.sbc-set.sbc-set-image');
        if (setImg) cardImage = _absUrl(setImg.getAttribute('src'));
        if (!cardImage) {
            var bg = card.querySelector('img.playercard-26-bg');
            if (bg) cardImage = _absUrl(bg.getAttribute('src'));
        }
        return { card_name: cardName, card_image: cardImage };
    }

    // ================================================================
    // PARSE: ALT SIDEBAR (posições alternativas + playstyles)
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
        var svg = altPos ? altPos.querySelector('svg') : null;
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

        return { style_raw: rawSt, css_vars: css, styles: {
            alt_pos_background: css['alt-pos-background'] || null,
            alt_pos_border:     css['alt-pos-border']     || null
        }, positions: positions, svg: svgData };
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
                viewBox: d.viewBox, width: d.width, height: d.height, svg_raw: d.svg_raw, svg_hash: d.svg_hash });
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
                viewBox: d.viewBox, width: d.width, height: d.height, svg_raw: d.svg_raw, svg_hash: d.svg_hash });
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
    // PARSE: PÁGINA DE PLAYER
    // ================================================================

    function _parsePlayerPage(doc, playerUrl) {
        var card = doc.querySelector('.playercard-26');
        if (!card) {
            _log('Card não encontrado: ' + playerUrl, 'warning');
            return { player_url: playerUrl };
        }

        var cardStyleRaw = (card.getAttribute('style') || '').trim();
        var cardCssVars  = _parseCssVars(cardStyleRaw);

        var rating   = _txtOrNull(card.querySelector('.playercard-26-rating'));
        var position = _txtOrNull(card.querySelector('.playercard-26-position'));
        var rolePlus = _txtOrNull(card.querySelector('.playercard-26-role-plus'));
        var name     = _normalizeName(_txtOrNull(card.querySelector('.playercard-26-name')));

        var bg      = card.querySelector('img.playercard-26-bg');
        var bgSrc   = _absUrl(bg ? bg.getAttribute('src') : null);
        var faceSrc = _pickPlayerFaceImg(card);

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

        _log('└─ Player: ' + name + ' | ' + rating + ' ' + position +
            ' | Console=' + (prices.console || 'N/A') +
            ' PC='        + (prices.pc      || 'N/A'), 'success');

        return {
            player_url:     playerUrl,
            name:           name,
            rating:         rating,
            position:       position,
            role_plus:      rolePlus,
            images:         { bg: bgSrc, face: faceSrc },
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
    // PARSE: DETALHE DO SBC
    // ================================================================

    function _parseSbcDetail(doc, detailUrl, includePlatformPrice) {
        var prices = _extractPrices(doc);
        var header = _parseRewardHeader(doc);
        var boxes  = [];

        doc.querySelectorAll('div.sbc-box-wrapper').forEach(function (box) {
            var nameTag = box.querySelector('.og-card-wrapper-top .xxs-font.bold')
                       || box.querySelector('.xs-font.text-ellipsis.bold')
                       || box.querySelector('.font-extra-small.text-ellipsis.bold')
                       || box.querySelector('.font-extra-extra-small.bold');
            var bname = _normalizeName(_txtOrNull(nameTag));

            var imgTag = box.querySelector('.sbc-box-front-info img')
                      || box.querySelector('img.sbc-set')
                      || box.querySelector('img');
            var bimg  = _absUrl(imgTag ? imgTag.getAttribute('src') : null);

            var bprice_estimated = null;
            var est = box.querySelector('.estimated-price');
            if (est) bprice_estimated = _txtOrNull(est);

            var bprice_ps = null, bprice_pc = null;

            if (!bprice_estimated) {
                var rowPs = box.querySelector('.xxs-row.hide-not-ps.bold.centered');
                var rowPc = box.querySelector('.xxs-row.hide-not-pc.bold.centered');

                function cleanRow(row) {
                    if (!row) return null;
                    var clone = row.cloneNode(true);
                    clone.querySelectorAll('img').forEach(function (i) { i.remove(); });
                    var sp = clone.querySelector('span');
                    return _txtOrNull(sp) || clone.textContent.trim() || null;
                }

                bprice_ps = cleanRow(rowPs);
                bprice_pc = cleanRow(rowPc);
            }

            if (bprice_estimated && !bprice_ps) bprice_ps = bprice_estimated;
            if (bprice_estimated && !bprice_pc) bprice_pc = bprice_estimated;

            var bprice = bprice_ps || bprice_pc || null;

            if (bname || bimg || bprice || bprice_ps || bprice_pc) {
                boxes.push({ nome: bname, imagem: bimg, valor: bprice, valor_ps: bprice_ps, valor_pc: bprice_pc });
            }
        });

        var playerLink = null;

        // 1ª tentativa: link direto href com padrão /26/player/ID/
        var allLinks = doc.querySelectorAll('a[href]');
        for (var i = 0; i < allLinks.length; i++) {
            var href = allLinks[i].getAttribute('href') || '';
            if (/\/\d+\/player\/\d+\//.test(href)) {
                playerLink = href.indexOf('http') === 0 ? href : CFG.BASE + href;
                break;
            }
        }

        // 2ª tentativa: atributo data-player-hover-location (padrão real do Futbin)
        // Ex: data-player-hover-location="/26/playerhover/24786"
        if (!playerLink) {
            var hoverEl = doc.querySelector('[data-player-hover-location]');
            if (hoverEl) {
                var hoverPath = (hoverEl.getAttribute('data-player-hover-location') || '').trim();
                if (hoverPath) {
                    // Tenta montar a URL do player a partir do src da imagem de face
                    // Ex: src=".../players/p67385559.png" → ID externo do jogador
                    var faceImg = hoverEl.querySelector('img.playercard-26-special-img')
                               || hoverEl.querySelector('img[src*="/players/p"]');
                    var externalIdMatch = faceImg
                        ? (faceImg.getAttribute('src') || '').match(/\/players\/p(\d+)\./)
                        : null;

                    if (externalIdMatch) {
                        // Busca nome do jogador para compor a slug
                        var cardEl   = hoverEl.querySelector('.playercard-26');
                        var rawName  = cardEl ? (cardEl.getAttribute('title') || cardEl.querySelector('.playercard-26-name') && cardEl.querySelector('.playercard-26-name').textContent || '') : '';
                        var nameSlug = rawName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'player';
                        // URL no formato: /26/player/{externalId}/{slug}
                        var hoverYear = (hoverPath.match(/^\/(\d+)\//) || [])[1] || '26';
                        playerLink = CFG.BASE + '/' + hoverYear + '/player/' + externalIdMatch[1] + '/' + nameSlug;
                    } else {
                        // Fallback: usa a URL do playerhover diretamente
                        playerLink = hoverPath.indexOf('http') === 0 ? hoverPath : CFG.BASE + hoverPath;
                    }
                }
            }
        }

        return {
            prices:       includePlatformPrice ? prices : {},
            boxes:        boxes,
            player_url:   playerLink,
            reward_name:  header.reward_name,
            reward_image: header.reward_image
        };
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
        try { baseOrigin = new URL(url).origin; } catch(e) { baseOrigin = 'https://www.futbin.com'; }

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
            _log('  Retry ' + (retryCount + 1) + '/' + CFG.MAX_RETRIES, 'warning');
            await _sleep(CFG.RETRY_DELAY);
            return _fetchPage(url, retryCount + 1);
        }

        _log('  Desistindo: ' + url.substring(0, 60), 'error');
        return null;
    }
}

    // ================================================================
    // SALVAMENTO EM BATCH (envia para AJAX action do módulo)
    // ================================================================

    async function _saveToDatabase(items, isFinal) {
        if (items.length === 0 && !isFinal) return;

        _log('Salvando ' + items.length + ' item(s)...', 'info');

        try {
            var payload = JSON.stringify({
                items:    items,
                meta:     _meta,
                is_final: isFinal,
                nonce:    _params.nonce
            });

            var response = await fetch(_params.ajaxUrl + '?action=' + _params.ajaxAction, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    payload
            });

            if (!response.ok) {
                var errText = await response.text();
                throw new Error('HTTP ' + response.status + ': ' + errText);
            }

            var result = await response.json();

            if (result.success) {
                _stats.saved += result.data.inserted + result.data.updated;
                _pushStats();
                var msg = 'Salvos: ' + result.data.inserted + ' novos, ' + result.data.updated + ' atualizados';
                if (result.data.errors > 0) msg += ', ' + result.data.errors + ' erros';
                _log(msg, 'success');
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
        var allEntries = [];

        // ── Fase 1: Descoberta ────────────────────────────────────
        _phase('🔍 Descobrindo SBCs...', '#3182ce');
        _log('═════ FASE 1: DESCOBERTA ═════', 'info');

        var page = 1;
        while (page <= CFG.MAX_PAGES && _running) {
            var listUrl = page === 1 ? CFG.LIST : CFG.LIST + '?page=' + page;
            _log('Página ' + page, 'info');

            var listDoc = await _fetchPage(listUrl);
            if (!listDoc) {
                _log('Página ' + page + ' não carregou, pulando...', 'warning');
                page++;
                continue;
            }

            var cards = listDoc.querySelectorAll('.sbc-card-wrapper');
            if (!cards.length) cards = listDoc.querySelectorAll('.sbc_set_card, .card-wrapper, [class*="sbc-card"], [class*="sbc_card"]');
            if (!cards.length) {
                _log('Fim da paginação na página ' + page, 'success');
                break;
            }

            _log('└─ ' + cards.length + ' cards encontrados', 'success');

            cards.forEach(function (card) {
                var a = card.querySelector('a[href]');
                if (!a) return;
                var href      = a.getAttribute('href');
                var detailUrl = href.indexOf('http') === 0 ? href : CFG.BASE + href;
                var isPlayer  = card.querySelector('.playercard-26') !== null;
                var listing   = _parseListingCard(card);

                // Captura prévia do jogador direto da listagem:
                // O playercard-26 já existe aqui — guarda os dados básicos
                // para usar como fallback se o fetch da página de detalhe falhar.
                var listingPlayerPreview = null;
                if (isPlayer) {
                    var pc = card.querySelector('.playercard-26');
                    if (pc) {
                        var hoverWrap = card.querySelector('[data-player-hover-location]');
                        var hoverPath = hoverWrap ? (hoverWrap.getAttribute('data-player-hover-location') || '') : '';
                        var faceImg2  = pc.querySelector('img.playercard-26-special-img')
                                     || pc.querySelector('img[src*="/players/p"]');
                        var bgImg2    = pc.querySelector('img.playercard-26-bg');
                        listingPlayerPreview = {
                            name:       _normalizeName(_txtOrNull(pc.querySelector('.playercard-26-name')))
                                     || (pc.getAttribute('title') || '').trim() || null,
                            rating:     _txtOrNull(pc.querySelector('.playercard-26-rating')),
                            position:   _txtOrNull(pc.querySelector('.playercard-26-position')),
                            role_plus:  _txtOrNull(pc.querySelector('.playercard-26-role-plus')),
                            images: {
                                face: _absUrl(faceImg2 ? faceImg2.getAttribute('src') : null),
                                bg:   _absUrl(bgImg2   ? bgImg2.getAttribute('src')   : null)
                            },
                            hover_path: hoverPath || null
                        };
                    }
                }

                allEntries.push({
                    url:                   detailUrl,
                    type:                  isPlayer ? 'jogador' : 'recompensa',
                    card_name:             listing.card_name,
                    card_image:            listing.card_image,
                    listing_player_preview: listingPlayerPreview
                });
            });

            _stats.pages++;
            _pushStats();
            page++;
            if (page <= CFG.MAX_PAGES) await _sleep(CFG.NAV_DELAY);
        }

        _meta.pages = _stats.pages;
        var total   = allEntries.length;

        _log('✅ ' + total + ' SBCs em ' + _stats.pages + ' página(s)', 'success');

        if (total === 0 || !_running) {
            _callbacks.onComplete({ 'SBCs encontrados': 0 });
            _running = false;
            return;
        }

        // ── Fase 2: Processamento ─────────────────────────────────
        _phase('📦 Processando ' + total + ' SBCs...', '#e67e22');
        _log('═════ FASE 2: PROCESSAMENTO ═════', 'info');
        _progress(0, total);

        var batch = [];

        for (var i = 0; i < allEntries.length; i++) {
            if (!_running) break;

            var entry    = allEntries[i];
            var isPlayer = entry.type === 'jogador';
            var isFinal  = (i === allEntries.length - 1) && _running;

            _log('📦 ' + (i + 1) + '/' + total + ' [' + entry.type + ']: ' +
                entry.url.substring(0, 55) + '...', 'info');

            var doc = await _fetchPage(entry.url);
            if (!doc) {
                _log('SBC não carregou, pulando...', 'warning');
                _progress(i + 1, total);
                continue;
            }

            var sbcDetail   = _parseSbcDetail(doc, entry.url, isPlayer);
            var rewardName  = sbcDetail.reward_name  || entry.card_name  || null;
            var rewardImage = entry.card_image       || sbcDetail.reward_image || null;

            _log('└─ "' + (rewardName || 'N/A') + '"' +
                ' | Console=' + (sbcDetail.prices.console || 'N/A') +
                ' PC='        + (sbcDetail.prices.pc      || 'N/A') +
                ' | Boxes: '  + sbcDetail.boxes.length +
                (sbcDetail.player_url ? ' | Player: ✅' : ''), 'success');

            var playerBlock = {};
            if (isPlayer) {
                // Tenta carregar a página completa do jogador
                if (sbcDetail.player_url) {
                    _log('👤 Carregando player: ' + sbcDetail.player_url.substring(0, 60), 'info');
                    var playerDoc = await _fetchPage(sbcDetail.player_url);
                    if (playerDoc) {
                        playerBlock = _parsePlayerPage(playerDoc, sbcDetail.player_url);
                        _stats.players++;
                    } else {
                        _log('Player não carregou — usando dados da listagem como fallback', 'warning');
                    }
                } else {
                    _log('👤 player_url não encontrado — usando dados da listagem como fallback', 'warning');
                }

                // Fallback: dados básicos capturados na fase de listagem
                if (!playerBlock.name && entry.listing_player_preview) {
                    var prev = entry.listing_player_preview;
                    playerBlock = {
                        player_url: sbcDetail.player_url || null,
                        name:       prev.name     || null,
                        rating:     prev.rating   || null,
                        position:   prev.position || null,
                        role_plus:  prev.role_plus || null,
                        images:     prev.images   || {},
                        stats:      {},
                        info:       {},
                        prices:     { console: null, pc: null, estimated: null }
                    };
                    _log('👤 Fallback OK: ' + (prev.name || 'N/A') + ' ' + (prev.rating || '') + ' ' + (prev.position || ''), 'success');
                    _stats.players++;
                }
            }

            if (isPlayer) {
                _meta.jogadores++;
            } else {
                _meta.recompensas++;
                _stats.rewards++;
            }

            var item = {
                type:         entry.type,
                sort_index:   i,
                scrape_token: _scrapeToken,
                detail_url:   entry.url,
                reward_name:  rewardName,
                reward_image: rewardImage,
                sbc: {
                    top_prices: sbcDetail.prices,
                    boxes:      sbcDetail.boxes
                },
                player: playerBlock
            };

            _meta.cards_total++;
            _stats.sbcs++;
            batch.push(item);
            _pushStats();
            _progress(i + 1, total);

            if (batch.length >= CFG.BATCH_SIZE || isFinal) {
                await _saveToDatabase(batch, isFinal);
                batch = [];
            }

            if (!isFinal && _running) await _sleep(CFG.NAV_DELAY);
        }

        // ── Conclusão ─────────────────────────────────────────────
        _running = false;

        _log('═════ CONCLUÍDO ═════', 'success');
        _log('SBCs: ' + _stats.sbcs + ' | Players: ' + _stats.players +
            ' | Recompensas: ' + _stats.rewards + ' | Salvos: ' + _stats.saved, 'success');

        _callbacks.onComplete({
            'Páginas':     _stats.pages,
            'SBCs':        _stats.sbcs,
            'Players':     _stats.players,
            'Recompensas': _stats.rewards,
            'Salvos DB':   _stats.saved
        });
    }

    // ================================================================
    // EXPORT PÚBLICO
    // ================================================================

    return { start: start, stop: stop };

})();
