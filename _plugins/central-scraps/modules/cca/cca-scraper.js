/**
 * CcaScraper — Módulo CCA para Futbin Hub
 * Versão: 1.0.0
 *
 * Coleta todos os Correspondentes Caixa (CCAs) do site:
 *   https://www.caixa.gov.br/atendimento/Paginas/encontre-a-caixa.aspx
 *
 * Estratégia:
 *   1. Abre a página de busca em uma aba gerenciada pela extensão
 *   2. Itera por todos os estados (UFs) disponíveis no select
 *   3. Para cada UF, itera por todas as cidades
 *   4. Seleciona "Correspondente Caixa" como tipo, submete e extrai os resultados
 *   5. Salva em batch no WordPress via AJAX
 *
 * Contrato obrigatório:
 *   start(params, callbacks)
 *   stop()
 *
 * Toda comunicação com a UI é feita exclusivamente via callbacks.
 */

var CcaScraper = (function () {
    'use strict';

    // ================================================================
    // ESTADO INTERNO
    // ================================================================

    var _running   = false;
    var _callbacks = null;
    var _params    = null;
    var _tabId     = null;

    var _stats = {
        ufs:      0,
        cidades:  0,
        ccas:     0,
        saved:    0,
        erros:    0
    };

    var _meta = {
        timestamp: null,
        total:     0
    };

    // ================================================================
    // CONFIGURAÇÃO
    // ================================================================

    var CFG = {
        URL:            'https://www.caixa.gov.br/atendimento/Paginas/encontre-a-caixa.aspx',
        TIPO_VALUE:     'correspondente',        // valor do option "Correspondente Caixa"
        NAV_DELAY:      2000,                    // ms entre navegações
        SUBMIT_DELAY:   3000,                    // ms aguardar resultado após submit
        RETRY_DELAY:    5000,
        MAX_RETRIES:    3,
        BATCH_SIZE:     50,                      // CCAs por batch enviado ao WP
        PAGE_TIMEOUT:   15000,                   // ms timeout para carregar página
    };

    // ================================================================
    // INTERFACE PÚBLICA
    // ================================================================

    function start(params, callbacks) {
        if (_running) {
            callbacks.onLog('CCA Scraper já está em execução.', 'warning');
            return;
        }

        _running   = true;
        _callbacks = callbacks;
        _params    = params;

        _stats = { ufs: 0, cidades: 0, ccas: 0, saved: 0, erros: 0 };
        _meta  = { timestamp: new Date().toISOString(), total: 0 };

        _log('═══ CCA Scraper v1.0.0 iniciado ═══', 'info');
        _run().catch(function (err) {
            _callbacks.onError('Exceção não tratada: ' + err.message);
            _running = false;
            _closeTab();
        });
    }

    function stop() {
        _running = false;
        _log('Scraper interrompido pelo usuário.', 'warning');
        _closeTab();
    }

    // ================================================================
    // FLUXO PRINCIPAL
    // ================================================================

    async function _run() {
        _phase('Abrindo página da Caixa...', '#3182ce');

        // Abre (ou reutiliza) a aba da Caixa
        _tabId = await _openTab(CFG.URL);
        if (!_tabId) {
            _callbacks.onError('Não foi possível abrir a aba da Caixa.');
            _running = false;
            return;
        }

        await _delay(CFG.NAV_DELAY * 2);

        // Lê a lista de UFs disponíveis no select
        _phase('Lendo UFs disponíveis...', '#3182ce');
        var ufs = await _getUfs();

        if (!ufs || ufs.length === 0) {
            _callbacks.onError('Nenhuma UF encontrada. Verifique se a página carregou corretamente.');
            _running = false;
            _closeTab();
            return;
        }

        _log('UFs encontradas: ' + ufs.map(function(u){ return u.value; }).join(', '), 'info');
        _phase('Iniciando coleta de ' + ufs.length + ' estados...', '#805ad5');

        var allItems = [];

        for (var i = 0; i < ufs.length; i++) {
            if (!_running) break;

            var uf = ufs[i];
            if (!uf.value || uf.value === '' || uf.value === '0') continue;

            _log('━━━ Processando UF: ' + uf.value + ' (' + (i+1) + '/' + ufs.length + ') ━━━', 'info');
            _stats.ufs++;

            // Seleciona a UF e aguarda carregar as cidades
            var cidades = await _selectUfAndGetCidades(uf.value);

            if (!cidades || cidades.length === 0) {
                _log('Nenhuma cidade encontrada para ' + uf.value, 'warning');
                continue;
            }

            _log('Cidades em ' + uf.value + ': ' + cidades.length, 'info');

            for (var j = 0; j < cidades.length; j++) {
                if (!_running) break;

                var cidade = cidades[j];
                if (!cidade.value || cidade.value === '' || cidade.value === '0') continue;

                _stats.cidades++;
                _progress(_stats.cidades, _stats.ufs * cidades.length);

                var items = await _scrapeCidade(uf.value, cidade.value, cidade.text);

                if (items && items.length > 0) {
                    _log(
                        cidade.text + ' (' + uf.value + '): ' + items.length + ' CCAs encontrados',
                        'success'
                    );
                    allItems = allItems.concat(items);
                    _stats.ccas += items.length;
                } else {
                    _log(cidade.text + ': nenhum CCA.', 'info');
                }

                _stats_update();

                // Salva em batch quando atingir o tamanho definido
                if (allItems.length >= CFG.BATCH_SIZE) {
                    await _saveToDatabase(allItems, false);
                    _stats.saved += allItems.length;
                    allItems = [];
                }

                await _delay(CFG.NAV_DELAY);
            }
        }

        // Salva restantes
        if (allItems.length > 0) {
            await _saveToDatabase(allItems, true);
            _stats.saved += allItems.length;
        } else {
            // Batch final vazio — envia is_final=true com array vazio pra gravar meta
            await _saveToDatabase([], true);
        }

        _closeTab();
        _running = false;
        _phase('Concluído!', '#38a169');
        _callbacks.onComplete({
            'UFs':     _stats.ufs,
            'Cidades': _stats.cidades,
            'CCAs':    _stats.ccas,
            'Salvos':  _stats.saved,
            'Erros':   _stats.erros
        });
    }

    // ================================================================
    // INTERAÇÃO COM A PÁGINA (via chrome.tabs.executeScript)
    // ================================================================

    /**
     * Lê os options do select de UF.
     * Retorna [{value, text}, ...]
     */
    async function _getUfs() {
        return _execInTab(function() {
            var sel = document.querySelector('select[id*="UF"], select[name*="UF"], #ddlUF, select[id$="UF"]');
            if (!sel) {
                // Tenta pelo label
                var labels = document.querySelectorAll('label');
                for (var i = 0; i < labels.length; i++) {
                    if (/estado|uf/i.test(labels[i].textContent)) {
                        var id = labels[i].getAttribute('for');
                        if (id) sel = document.getElementById(id);
                        if (sel) break;
                    }
                }
            }
            if (!sel) return [];
            return Array.from(sel.options).map(function(o) {
                return { value: o.value, text: o.text.trim() };
            }).filter(function(o) { return o.value && o.value !== '0' && o.value !== ''; });
        });
    }

    /**
     * Seleciona uma UF no select e retorna as cidades disponíveis.
     * Aguarda o select de cidades atualizar via AJAX interno da página.
     */
    async function _selectUfAndGetCidades(ufValue) {
        // Seleciona a UF e dispara change
        await _execInTab(function(uf) {
            var sel = document.querySelector('select[id*="UF"], #ddlUF, select[id$="UF"]');
            if (!sel) return;
            sel.value = uf;
            var evt = new Event('change', { bubbles: true });
            sel.dispatchEvent(evt);
            // Compatibilidade com jQuery
            if (window.jQuery) window.jQuery(sel).trigger('change');
        }, [ufValue]);

        // Aguarda o select de cidades recarregar
        await _delay(CFG.SUBMIT_DELAY);

        return _execInTab(function() {
            var sel = document.querySelector(
                'select[id*="Municipio"], select[id*="Cidade"], #ddlCidade, #ddlMunicipio, select[id$="Municipio"]'
            );
            if (!sel) return [];
            return Array.from(sel.options).map(function(o) {
                return { value: o.value, text: o.text.trim() };
            }).filter(function(o) { return o.value && o.value !== '0' && o.value !== ''; });
        });
    }

    /**
     * Para uma UF+cidade, seleciona "Correspondente Caixa",
     * submete o formulário e extrai os resultados.
     */
    async function _scrapeCidade(ufValue, cidadeValue, cidadeText) {
        // Seleciona tipo "Correspondente Caixa"
        await _execInTab(function(params) {
            // Select de tipo de atendimento
            var selTipo = document.querySelector(
                'select[id*="Tipo"], select[id*="Atendimento"], #ddlTipo, #ddlTipoAtendimento'
            );
            if (selTipo) {
                // Tenta encontrar o option pelo texto
                var found = false;
                Array.from(selTipo.options).forEach(function(o) {
                    if (/correspondente/i.test(o.text)) {
                        selTipo.value = o.value;
                        found = true;
                    }
                });
                if (!found && params.tipoValue) {
                    selTipo.value = params.tipoValue;
                }
                var evt = new Event('change', { bubbles: true });
                selTipo.dispatchEvent(evt);
                if (window.jQuery) window.jQuery(selTipo).trigger('change');
            }

            // Garante UF selecionada
            var selUF = document.querySelector('select[id*="UF"], #ddlUF, select[id$="UF"]');
            if (selUF && selUF.value !== params.uf) {
                selUF.value = params.uf;
                var evtUF = new Event('change', { bubbles: true });
                selUF.dispatchEvent(evtUF);
                if (window.jQuery) window.jQuery(selUF).trigger('change');
            }
        }, [{ uf: ufValue, tipoValue: CFG.TIPO_VALUE }]);

        await _delay(CFG.SUBMIT_DELAY);

        // Seleciona cidade
        await _execInTab(function(cidade) {
            var sel = document.querySelector(
                'select[id*="Municipio"], select[id*="Cidade"], #ddlCidade, #ddlMunicipio, select[id$="Municipio"]'
            );
            if (!sel) return;
            sel.value = cidade;
            var evt = new Event('change', { bubbles: true });
            sel.dispatchEvent(evt);
            if (window.jQuery) window.jQuery(sel).trigger('change');
        }, [cidadeValue]);

        await _delay(1000);

        // Clica no botão de pesquisa
        await _execInTab(function() {
            var btn = document.querySelector(
                'input[type="submit"][id*="Pesquisar"], input[type="submit"][value*="Pesquisar"], ' +
                'button[id*="Pesquisar"], a[id*="Pesquisar"], input[type="button"][value*="Pesquisar"]'
            );
            if (!btn) {
                // Fallback: qualquer submit no formulário principal
                var form = document.querySelector('form');
                if (form) {
                    var submits = form.querySelectorAll('[type="submit"], [type="button"]');
                    for (var i = 0; i < submits.length; i++) {
                        if (/pesquis|buscar|search/i.test(submits[i].value + ' ' + submits[i].textContent)) {
                            btn = submits[i];
                            break;
                        }
                    }
                    if (!btn && submits.length > 0) btn = submits[submits.length - 1];
                }
            }
            if (btn) btn.click();
        });

        // Aguarda resultados carregarem
        await _delay(CFG.SUBMIT_DELAY);

        // Extrai os resultados da tabela/lista
        var items = await _execInTab(function(params) {
            var results = [];

            // --- Tentativa 1: tabela de resultados ---
            var table = document.querySelector(
                'table[id*="resultado"], table[id*="grid"], table[id*="Result"], ' +
                '.resultado table, #divResultado table, table.tabela-resultado'
            );

            if (table) {
                var rows = table.querySelectorAll('tr');
                var headers = [];
                rows.forEach(function(row, rowIdx) {
                    var cells = row.querySelectorAll('th, td');
                    if (rowIdx === 0 || row.querySelector('th')) {
                        headers = Array.from(cells).map(function(c) {
                            return c.textContent.trim().toLowerCase();
                        });
                        return;
                    }
                    if (cells.length < 2) return;

                    var item = {
                        nome:        '',
                        tipo:        'Correspondente Caixa',
                        endereco:    '',
                        complemento: '',
                        bairro:      '',
                        cidade:      params.cidade,
                        uf:          params.uf,
                        cep:         '',
                        telefone:    '',
                        latitude:    '',
                        longitude:   ''
                    };

                    cells.forEach(function(cell, idx) {
                        var h   = headers[idx] || '';
                        var txt = cell.textContent.trim();
                        if      (/nome|estabelecimento/i.test(h))  item.nome        = txt;
                        else if (/endere/i.test(h))                item.endereco    = txt;
                        else if (/bairro/i.test(h))                item.bairro      = txt;
                        else if (/cep/i.test(h))                   item.cep         = txt;
                        else if (/fone|telefone|tel\b/i.test(h))   item.telefone    = txt;
                        else if (/complem/i.test(h))               item.complemento = txt;
                        else if (/tipo/i.test(h))                  item.tipo        = txt || item.tipo;
                    });

                    // Fallback posicional se não mapeou por header
                    if (!item.nome && cells[0]) item.nome     = cells[0].textContent.trim();
                    if (!item.endereco && cells[1]) item.endereco = cells[1].textContent.trim();

                    if (item.nome) results.push(item);
                });
            }

            // --- Tentativa 2: lista de divs/cards (layout alternativo) ---
            if (results.length === 0) {
                var cards = document.querySelectorAll(
                    '.resultado-item, .item-agencia, .card-correspondente, [class*="resultado"] li, ' +
                    '#divResultado .item, .lista-resultado li'
                );
                cards.forEach(function(card) {
                    var text = card.textContent.trim();
                    if (!text) return;
                    // Extrai linhas
                    var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
                    results.push({
                        nome:        lines[0] || '',
                        tipo:        'Correspondente Caixa',
                        endereco:    lines[1] || '',
                        complemento: '',
                        bairro:      lines[2] || '',
                        cidade:      params.cidade,
                        uf:          params.uf,
                        cep:         (text.match(/\d{5}-\d{3}/) || [''])[0],
                        telefone:    (text.match(/\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4}/) || [''])[0],
                        latitude:    '',
                        longitude:   ''
                    });
                });
            }

            // --- Tentativa 3: resposta JSON embutida no DOM (alguns portais gov) ---
            if (results.length === 0) {
                var scripts = document.querySelectorAll('script');
                for (var s = 0; s < scripts.length; s++) {
                    var src = scripts[s].textContent || '';
                    var match = src.match(/var\s+\w*[Rr]esultado\w*\s*=\s*(\[.*?\]);/s);
                    if (match) {
                        try {
                            var parsed = JSON.parse(match[1]);
                            parsed.forEach(function(p) {
                                results.push({
                                    nome:        p.NOME || p.nome || p.NomeEstabelecimento || '',
                                    tipo:        'Correspondente Caixa',
                                    endereco:    p.ENDERECO || p.endereco || p.Logradouro || '',
                                    complemento: p.COMPLEMENTO || p.complemento || '',
                                    bairro:      p.BAIRRO || p.bairro || '',
                                    cidade:      p.MUNICIPIO || p.cidade || params.cidade,
                                    uf:          p.UF || p.uf || params.uf,
                                    cep:         p.CEP || p.cep || '',
                                    telefone:    p.TELEFONE || p.telefone || p.Fone || '',
                                    latitude:    p.LATITUDE || p.lat || '',
                                    longitude:   p.LONGITUDE || p.lng || ''
                                });
                            });
                        } catch(e) {}
                        if (results.length > 0) break;
                    }
                }
            }

            // Gera hash único por nome+endereco+uf
            results.forEach(function(item) {
                var raw = (item.nome + '|' + item.endereco + '|' + item.uf + '|' + item.cidade)
                    .toLowerCase().replace(/\s+/g, ' ').trim();
                // Hash simples (djb2) — não precisa ser criptográfico
                var hash = 0;
                for (var i = 0; i < raw.length; i++) {
                    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
                    hash |= 0;
                }
                item.hash = 'cca_' + Math.abs(hash).toString(36);
            });

            return results;
        }, [{ uf: ufValue, cidade: cidadeText }]);

        return items || [];
    }

    // ================================================================
    // HELPERS DE ABA (chrome.tabs API)
    // ================================================================

    function _openTab(url) {
        return new Promise(function(resolve) {
            chrome.tabs.create({ url: url, active: false }, function(tab) {
                if (chrome.runtime.lastError || !tab) {
                    resolve(null);
                    return;
                }
                // Aguarda a aba carregar completamente
                var timeout = setTimeout(function() {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve(tab.id);
                }, CFG.PAGE_TIMEOUT);

                function listener(tabId, info) {
                    if (tabId === tab.id && info.status === 'complete') {
                        clearTimeout(timeout);
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve(tab.id);
                    }
                }
                chrome.tabs.onUpdated.addListener(listener);
            });
        });
    }

    function _closeTab() {
        if (_tabId) {
            chrome.tabs.remove(_tabId, function() {});
            _tabId = null;
        }
    }

    /**
     * Executa uma função no contexto da aba gerenciada.
     * @param {Function} fn       - Função a injetar (será serializada)
     * @param {Array}    args     - Argumentos passados para fn
     */
    function _execInTab(fn, args) {
        return new Promise(function(resolve) {
            if (!_tabId) { resolve(null); return; }

            var fnStr   = '(' + fn.toString() + ')';
            var argsStr = args ? JSON.stringify(args[0]) : 'undefined';
            var code    = fnStr + '(' + (args ? argsStr : '') + ')';

            chrome.tabs.executeScript(_tabId, { code: code }, function(results) {
                if (chrome.runtime.lastError) {
                    _log('executeScript erro: ' + chrome.runtime.lastError.message, 'warning');
                    resolve(null);
                    return;
                }
                resolve(results ? results[0] : null);
            });
        });
    }

    // ================================================================
    // SALVAR NO BANCO
    // ================================================================

    async function _saveToDatabase(items, isFinal) {
        if (!_params || !_params.ajaxUrl) return;

        _meta.total = _stats.ccas;

        try {
            var response = await fetch(
                _params.ajaxUrl + '?action=' + (_params.ajaxAction || 'fhub_cca_save'),
                {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        items:    items,
                        meta:     _meta,
                        is_final: isFinal,
                        nonce:    _params.nonce || ''
                    })
                }
            );

            var result = await response.json();
            if (result.success) {
                _log(
                    'Salvos: +' + result.data.inserted + ' novos | ' +
                    result.data.updated + ' atualizados | ' +
                    result.data.errors + ' erros',
                    result.data.errors > 0 ? 'warning' : 'success'
                );
            } else {
                _log('Erro ao salvar batch: ' + (result.data || 'desconhecido'), 'error');
                _stats.erros++;
            }
        } catch (err) {
            _log('Falha na requisição AJAX: ' + err.message, 'error');
            _stats.erros++;
        }
    }

    // ================================================================
    // HELPERS DE UI / LOG
    // ================================================================

    function _log(msg, type)  { if (_callbacks) _callbacks.onLog(msg, type || 'info'); }
    function _phase(txt, clr) { if (_callbacks) _callbacks.onPhase(txt, clr); }
    function _progress(c, t)  { if (_callbacks) _callbacks.onProgress(c, t); }

    function _stats_update() {
        if (_callbacks) _callbacks.onStats({
            'UFs':     _stats.ufs,
            'Cidades': _stats.cidades,
            'CCAs':    _stats.ccas,
            'Salvos':  _stats.saved,
            'Erros':   _stats.erros
        });
    }

    function _delay(ms) {
        return new Promise(function(resolve) { setTimeout(resolve, ms); });
    }

    // ================================================================
    // EXPORT
    // ================================================================

    return { start: start, stop: stop };

})();
