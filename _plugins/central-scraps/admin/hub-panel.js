/**
 * FutbinHub — Orquestrador JS Central
 * Versão: 1.1.0
 *
 * Responsabilidades:
 *  - Gerenciar troca de abas (sem interromper módulo em execução)
 *  - Ao clicar Iniciar: chamar runner.start(params, callbacks)
 *  - Ao clicar Parar: chamar runner.stop()
 *  - Receber callbacks do módulo e atualizar a UI correspondente
 *  - Watchdog: detecta módulo travado (sem atividade por 3 min) e avisa
 *  - Ação de limpar dados por módulo (botão Limpar Dados)
 *  - Restaura estado visual do último run ao recarregar a página
 *
 * CONTRATO COM MÓDULOS:
 *   start(params, callbacks)  →  inicia o processo
 *   stop()                    →  interrompe o processo
 *
 *   callbacks:
 *     onLog(message, type)         type: 'info'|'success'|'warning'|'error'
 *     onProgress(current, total)
 *     onStats(statsObject)         { label: value, ... }
 *     onPhase(text, color)
 *     onComplete(summary)          { label: value, ... }
 *     onError(message)
 */

(function ($) {
    'use strict';

    // Watchdog: se nenhum callback chegar em WATCHDOG_MS, avisa o usuário
    var WATCHDOG_MS = 3 * 60 * 1000; // 3 minutos

    $(document).ready(function () {

        var HUB = window.fhubData || { modules: [], ajaxUrl: '', nonce: '', version: '?' };

        console.log(
            '%c═══ FUTBIN HUB v' + HUB.version + ' ═══',
            'color:#3182ce; font-size:15px; font-weight:bold;'
        );

        if (!HUB.modules.length) {
            console.warn('[FHub] Nenhum módulo disponível.');
            return;
        }

        // ── Estado por módulo ─────────────────────────────────────────────
        // running    : bool
        // runner     : objeto com start()/stop()
        // watchdogId : id do setInterval de watchdog
        // lastActivity: timestamp da última atividade (Date.now())
        var moduleState = {};
        HUB.modules.forEach(function (m) {
            moduleState[m.id] = { running: false, runner: null, watchdogId: null, lastActivity: 0 };
        });

        // ================================================================
        // HELPERS DE UI
        // ================================================================

        function getPanel(moduleId) {
            return $('#fhub-panel-' + moduleId);
        }

        function addLog(moduleId, message, type) {
            type = type || 'info';
            var colors = { info: '#63b3ed', success: '#68d391', warning: '#f6ad55', error: '#fc8181' };
            var icons  = { info: 'ℹ', success: '✓', warning: '⚠', error: '✗' };

            var time  = new Date().toLocaleTimeString('pt-BR');
            var color = colors[type] || colors.info;
            var icon  = icons[type]  || icons.info;

            getPanel(moduleId).find('.fhub-log-entries').prepend(
                $('<div>').css({ color: color, marginBottom: '3px', lineHeight: '1.4' })
                          .text('[' + time + '] ' + icon + ' ' + message)
            );
            console.log('%c[FHub:' + moduleId + ':' + type + '] ' + message, 'color:' + color);
        }

        function setProgress(moduleId, current, total) {
            var pct = total > 0 ? Math.round((current / total) * 100) : 0;
            getPanel(moduleId).find('.fhub-progress-bar').css('width', pct + '%');
            getPanel(moduleId).find('.fhub-progress-text').text(current + ' / ' + total);
        }

        function setPhase(moduleId, text, color) {
            getPanel(moduleId).find('.fhub-phase-badge')
                .text(text)
                .css({ background: color ? (color + '22') : '#ebf8ff', color: color || '#2b6cb0' })
                .show();
        }

        function renderStats(moduleId, statsObject) {
            var $grid   = getPanel(moduleId).find('.fhub-stats-grid');
            var colors  = ['#3182ce', '#e67e22', '#38a169', '#e91e63', '#9b59b6', '#16a085'];
            var idx     = 0;
            $grid.empty();

            $.each(statsObject, function (label, value) {
                var c = colors[idx++ % colors.length];
                $grid.append(
                    $('<div>').css({ background: '#fff', border: '1px solid #e2e8f0',
                        borderRadius: '8px', padding: '12px 16px', textAlign: 'center', minWidth: '90px' })
                    .append($('<div>').css({ fontSize: '22px', fontWeight: 'bold', color: c }).text(value))
                    .append($('<div>').css({ fontSize: '11px', color: '#718096', marginTop: '4px' }).text(label))
                );
            });

            getPanel(moduleId).find('.fhub-stats-area').show();
        }

        function setRunningState(moduleId, running) {
            var $panel = getPanel(moduleId);
            if (running) {
                $panel.find('.fhub-btn-start').hide();
                $panel.find('.fhub-btn-stop').show();
                $panel.find('.fhub-btn-clear').hide();
                $panel.find('.fhub-log-area').show();
                $panel.find('.fhub-progress-area').show();
                $panel.find('.fhub-summary-area').hide();
            } else {
                $panel.find('.fhub-btn-start').show();
                $panel.find('.fhub-btn-stop').hide();
                $panel.find('.fhub-btn-clear').show();
            }
        }

        function showSummary(moduleId, summary) {
            var $content = getPanel(moduleId).find('.fhub-summary-content').empty();
            var grid = $('<div>').css({
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px,1fr))', gap: '8px'
            });
            $.each(summary, function (label, value) {
                grid.append($('<div>').append($('<strong>').text(label + ': ')).append(document.createTextNode(value)));
            });
            $content.append(grid);
            getPanel(moduleId).find('.fhub-summary-area').show();
        }

        // ================================================================
        // WATCHDOG — detecta módulo travado (sem atividade por WATCHDOG_MS)
        // ================================================================

        function startWatchdog(moduleId) {
            stopWatchdog(moduleId);
            moduleState[moduleId].lastActivity = Date.now();

            moduleState[moduleId].watchdogId = setInterval(function () {
                var state    = moduleState[moduleId];
                var idle     = Date.now() - state.lastActivity;
                var idleMins = Math.round(idle / 60000);

                if (!state.running) { stopWatchdog(moduleId); return; }

                if (idle > WATCHDOG_MS) {
                    addLog(moduleId,
                        'Watchdog: nenhuma atividade há ' + idleMins + ' min. ' +
                        'O módulo pode estar travado. Use Parar se necessário.',
                        'warning'
                    );
                }
            }, 60000); // checa a cada 1 minuto
        }

        function stopWatchdog(moduleId) {
            if (moduleState[moduleId] && moduleState[moduleId].watchdogId) {
                clearInterval(moduleState[moduleId].watchdogId);
                moduleState[moduleId].watchdogId = null;
            }
        }

        function touchActivity(moduleId) {
            if (moduleState[moduleId]) moduleState[moduleId].lastActivity = Date.now();
        }

        // ================================================================
        // CONSTRUÇÃO DOS CALLBACKS
        // ================================================================

        function buildCallbacks(moduleId) {
            return {
                onLog: function (message, type) {
                    touchActivity(moduleId);
                    addLog(moduleId, message, type);
                },
                onProgress: function (current, total) {
                    touchActivity(moduleId);
                    setProgress(moduleId, current, total);
                },
                onStats: function (statsObject) {
                    touchActivity(moduleId);
                    renderStats(moduleId, statsObject);
                },
                onPhase: function (text, color) {
                    touchActivity(moduleId);
                    setPhase(moduleId, text, color);
                },
                onComplete: function (summary) {
                    stopWatchdog(moduleId);
                    moduleState[moduleId].running = false;
                    setRunningState(moduleId, false);
                    setPhase(moduleId, '✅ Concluído!', '#38a169');
                    if (summary) showSummary(moduleId, summary);
                    addLog(moduleId, 'Processo concluído com sucesso.', 'success');
                },
                onError: function (message) {
                    stopWatchdog(moduleId);
                    moduleState[moduleId].running = false;
                    setRunningState(moduleId, false);
                    setPhase(moduleId, '❌ Erro', '#e53e3e');
                    addLog(moduleId, 'ERRO: ' + message, 'error');
                    // Exibe alerta visual no painel
                    getPanel(moduleId).find('.fhub-error-alert')
                        .text('⚠ ' + message)
                        .show();
                }
            };
        }

        // ================================================================
        // TROCA DE ABAS (módulo em execução não é interrompido)
        // ================================================================

        $(document).on('click', '.fhub-tab-btn', function () {
            var targetId = $(this).data('module');

            $('.fhub-tab-btn').each(function () {
                var active = $(this).data('module') === targetId;
                $(this).css({
                    background:   active ? '#fff'            : 'transparent',
                    color:        active ? '#3182ce'         : '#718096',
                    fontWeight:   active ? '600'             : '400',
                    borderBottom: active ? '2px solid #3182ce' : '2px solid transparent'
                });
            });

            $('.fhub-tab-panel').each(function () {
                $(this).css('display', $(this).data('module') === targetId ? 'block' : 'none');
            });
        });

        // ================================================================
        // BOTÃO INICIAR
        // ================================================================

        $(document).on('click', '.fhub-btn-start', function () {
            var moduleId   = $(this).data('module');
            var moduleConf = HUB.modules.find(function (m) { return m.id === moduleId; });

            if (!moduleConf) { console.error('[FHub] Módulo não encontrado:', moduleId); return; }

            var runner = window[moduleConf.jsObject];
            if (!runner || typeof runner.start !== 'function') {
                addLog(moduleId, 'Runner "' + moduleConf.jsObject + '" não encontrado. Verifique se o JS do módulo carregou.', 'error');
                return;
            }

            if (moduleState[moduleId].running) {
                addLog(moduleId, 'Módulo já está em execução.', 'warning');
                return;
            }

            var params = {
                ajaxUrl:    HUB.ajaxUrl,
                ajaxAction: moduleConf.ajaxAction,
                nonce:      HUB.nonce,
                apiBase:    moduleConf.apiBase,
                moduleId:   moduleId
            };

            if (moduleConf.hasInput) {
                var query = getPanel(moduleId).find('.fhub-search-input').val().trim();
                if (!query) { addLog(moduleId, 'Digite um termo de busca antes de iniciar.', 'warning'); return; }
                params.query = query;
            }

            // Reset visual
            moduleState[moduleId].running = true;
            moduleState[moduleId].runner  = runner;
            setRunningState(moduleId, true);
            setPhase(moduleId, 'Iniciando...', '#3182ce');
            getPanel(moduleId).find('.fhub-log-entries').empty();
            getPanel(moduleId).find('.fhub-stats-grid').empty();
            getPanel(moduleId).find('.fhub-stats-area').hide();
            getPanel(moduleId).find('.fhub-summary-area').hide();
            getPanel(moduleId).find('.fhub-error-alert').hide();
            setProgress(moduleId, 0, 0);

            addLog(moduleId, 'Iniciando "' + moduleConf.label + '"...', 'info');
            startWatchdog(moduleId);

            var callbacks = buildCallbacks(moduleId);
            try {
                runner.start(params, callbacks);
            } catch (err) {
                callbacks.onError('Exceção ao iniciar runner: ' + err.message);
            }
        });

        // ================================================================
        // BOTÃO PARAR
        // ================================================================

        $(document).on('click', '.fhub-btn-stop', function () {
            var moduleId = $(this).data('module');
            var state    = moduleState[moduleId];
            if (!state || !state.running) return;

            addLog(moduleId, 'Parando módulo...', 'warning');
            setPhase(moduleId, '⏹ Parando...', '#dd6b20');
            stopWatchdog(moduleId);

            if (state.runner && typeof state.runner.stop === 'function') {
                try { state.runner.stop(); } catch (e) { addLog(moduleId, 'Erro no stop(): ' + e.message, 'error'); }
            }

            state.running = false;
            setRunningState(moduleId, false);
            setPhase(moduleId, '⏹ Parado', '#e53e3e');
        });

        // ================================================================
        // BOTÃO LIMPAR DADOS
        // Chama o AJAX action de clear do módulo via Hub
        // ================================================================

        $(document).on('click', '.fhub-btn-clear', function () {
            var moduleId   = $(this).data('module');
            var moduleConf = HUB.modules.find(function (m) { return m.id === moduleId; });
            if (!moduleConf) return;

            if (!confirm('Limpar todos os dados do módulo "' + moduleConf.label + '"?\nEssa ação não pode ser desfeita.')) return;

            addLog(moduleId, 'Limpando dados...', 'warning');

            $.post(HUB.ajaxUrl, {
                action:    moduleConf.ajaxAction + '_clear',
                nonce:     HUB.nonce,
                module_id: moduleId
            }, function (response) {
                if (response && response.success) {
                    addLog(moduleId, 'Dados limpos com sucesso.', 'success');
                    setPhase(moduleId, '🗑 Dados limpos', '#718096');
                    getPanel(moduleId).find('.fhub-summary-area').hide();
                } else {
                    var msg = response && response.data && response.data.message
                        ? response.data.message : 'Erro desconhecido.';
                    addLog(moduleId, 'Erro ao limpar: ' + msg, 'error');
                }
            }).fail(function () {
                addLog(moduleId, 'Falha de rede ao limpar dados.', 'error');
            });
        });

        // ================================================================
        // RESTAURA ESTADO VISUAL do último run (PHP → fhubData.modules[].lastRun)
        // ================================================================

        HUB.modules.forEach(function (moduleConf) {
            var lr = moduleConf.lastRun;
            if (!lr) return;

            if (lr.status === 'completed') {
                // Formata timestamp legível
                var ts = '';
                if (lr.timestamp) {
                    try { ts = new Date(lr.timestamp).toLocaleString('pt-BR'); } catch(e) { ts = lr.timestamp; }
                }
                setPhase(moduleConf.id, '✅ Último run: ' + ts, '#38a169');

                // Reconstrói o resumo do último run
                var summary = {};
                if (lr.total_items !== undefined) summary['Total itens'] = lr.total_items;
                if (lr.pages       !== undefined) summary['Páginas']     = lr.pages;
                if (lr.jogadores   !== undefined) summary['Players']     = lr.jogadores;
                if (lr.recompensas !== undefined) summary['Recompensas'] = lr.recompensas;

                if (Object.keys(summary).length) {
                    showSummary(moduleConf.id, summary);
                    getPanel(moduleConf.id).find('.fhub-log-area').show();
                    addLog(moduleConf.id, 'Resumo do último scraping restaurado.', 'info');
                }
            } else if (lr.status === 'error') {
                setPhase(moduleConf.id, '❌ Último run com erro', '#e53e3e');
                if (lr.error_message) {
                    getPanel(moduleConf.id).find('.fhub-log-area').show();
                    addLog(moduleConf.id, lr.error_message, 'error');
                }
            }
        });

        console.log('[FHub] Pronto. ' + HUB.modules.length + ' módulo(s) disponível(is).');
    });

})(jQuery);
