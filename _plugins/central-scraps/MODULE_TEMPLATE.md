# Como Criar um Novo Módulo — Futbin Hub

## Visão Geral

Cada módulo é composto por **3 arquivos** dentro de `modules/{id}/`.
Após criá-los, o Hub detecta e exibe automaticamente — sem tocar em nenhum arquivo existente.

```
modules/
└── meu_modulo/
    ├── meu-modulo-config.php       ← constantes
    ├── class-meu-modulo-module.php ← PHP: tabela, AJAX, API REST
    └── meu-modulo-scraper.js       ← JS: runner com start() e stop()
```

---

## Checklist Rápido

- [ ] Criar os 3 arquivos com nomes seguindo o padrão
- [ ] Definir constantes com prefixo `FHUB_{ID}_*`
- [ ] Chamar `FutbinHubRegistry::register()` dentro do `init()`
- [ ] Implementar `start(params, callbacks)` e `stop()` no JS
- [ ] Comunicar com o Hub **somente via callbacks** (nunca acessar DOM diretamente)
- [ ] Registrar o AJAX action `fhub_{id}_save` e `fhub_{id}_clear`
- [ ] Registrar endpoints REST em `fhub/v1/{id}/data` e `fhub/v1/{id}/stats`
- [ ] Ativar o plugin no WordPress (ou desativar e reativar para criar a tabela)

---

## Arquivo 1 — `{id}-config.php`

```php
<?php
if ( ! defined( 'ABSPATH' ) ) exit;

define( 'FHUB_{ID}_VERSION',   '1.0.0' );
define( 'FHUB_{ID}_TABLE',     'fhub_{id}' );
define( 'FHUB_{ID}_CACHE_KEY', 'fhub_{id}_cache_v1' );
```

**Regra:** Sempre prefixar com `FHUB_{ID}_` para evitar colisão.

---

## Arquivo 2 — `class-{id}-module.php`

```php
<?php
if ( ! defined( 'ABSPATH' ) ) exit;

require_once dirname( __FILE__ ) . '/{id}-config.php';

class FutbinHub{Id}Module {

    public static function init() {
        self::create_table();

        // ── Registro no Hub ───────────────────────────────────────────
        FutbinHubRegistry::register( array(
            'id'          => '{id}',
            'label'       => 'Meu Módulo',
            'description' => 'Descrição curta do que este módulo coleta.',
            'version'     => FHUB_{ID}_VERSION,
            'js_object'   => '{Id}Scraper',          // nome do objeto JS global
            'js_handle'   => 'fhub-module-{id}',
            'js_path'     => FHUB_DIR . 'modules/{id}/{id}-scraper.js',
            'ajax_action' => 'fhub_{id}_save',
            'api_base'    => 'fhub/v1/{id}',
            'table'       => FHUB_{ID}_TABLE,
            'has_input'   => false,   // true se o módulo precisar de campo de busca
        ) );

        // ── AJAX ──────────────────────────────────────────────────────
        add_action( 'wp_ajax_fhub_{id}_save',        array( __CLASS__, 'ajax_save' ) );
        add_action( 'wp_ajax_nopriv_fhub_{id}_save', array( __CLASS__, 'ajax_save' ) );
        add_action( 'wp_ajax_fhub_{id}_clear',       array( __CLASS__, 'ajax_clear' ) );

        // ── REST API ──────────────────────────────────────────────────
        add_action( 'rest_api_init', array( __CLASS__, 'register_rest_routes' ) );
    }

    // ── Criar tabela ─────────────────────────────────────────────────
    public static function create_table() {
        global $wpdb;
        $table           = $wpdb->prefix . FHUB_{ID}_TABLE;
        $charset_collate = $wpdb->get_charset_collate();

        $sql = "CREATE TABLE IF NOT EXISTS {$table} (
            id         bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            detail_url varchar(500)        NOT NULL,
            // ... seus campos aqui ...
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY idx_detail_url (detail_url)
        ) {$charset_collate};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta( $sql );
    }

    // ── AJAX: salvar ─────────────────────────────────────────────────
    public static function ajax_save() {
        $raw     = file_get_contents( 'php://input' );
        $request = json_decode( $raw, true );

        // Verifica nonce
        $nonce = sanitize_text_field( $request['nonce'] ?? '' );
        if ( ! wp_verify_nonce( $nonce, 'fhub_nonce' ) ) {
            error_log( 'FutbinHub {id}: nonce inválido.' );
        }

        $items    = $request['items']    ?? array();
        $meta     = $request['meta']     ?? array();
        $is_final = $request['is_final'] ?? false;

        // ... lógica de insert/update usando FutbinHubCore::sanitize_* ...

        if ( $is_final ) {
            FutbinHubCore::set_module_meta( '{id}', array(
                'timestamp'   => $meta['timestamp'] ?? gmdate( 'c' ),
                'status'      => 'completed',
                'total_items' => $meta['total'] ?? 0,
            ) );
            delete_transient( FHUB_{ID}_CACHE_KEY );
        }

        wp_send_json_success( array( 'inserted' => 0, 'updated' => 0, 'errors' => 0 ) );
    }

    // ── AJAX: limpar ─────────────────────────────────────────────────
    public static function ajax_clear() {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_send_json_error( array( 'message' => 'Permissão negada' ) );
            return;
        }
        check_ajax_referer( 'fhub_nonce', 'nonce' );

        global $wpdb;
        $wpdb->query( 'TRUNCATE TABLE ' . $wpdb->prefix . FHUB_{ID}_TABLE );
        delete_transient( FHUB_{ID}_CACHE_KEY );

        FutbinHubCore::set_module_meta( '{id}', array(
            'timestamp' => gmdate( 'c' ), 'status' => 'cleared', 'total_items' => 0,
        ) );

        wp_send_json_success( array( 'message' => 'Dados limpos.' ) );
    }

    // ── REST API ─────────────────────────────────────────────────────
    public static function register_rest_routes() {
        register_rest_route( 'fhub/v1', '/{id}/data', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'api_get_data' ),
            'permission_callback' => '__return_true',
        ) );
        register_rest_route( 'fhub/v1', '/{id}/stats', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'api_get_stats' ),
            'permission_callback' => '__return_true',
        ) );
    }

    public static function api_get_data( $request ) {
        global $wpdb;
        $cached = get_transient( FHUB_{ID}_CACHE_KEY );
        if ( $cached !== false ) return new WP_REST_Response( $cached, 200 );

        $table = $wpdb->prefix . FHUB_{ID}_TABLE;
        $rows  = $wpdb->get_results( "SELECT * FROM {$table} ORDER BY created_at ASC", ARRAY_A );
        $data  = array_map( array( __CLASS__, 'format_item' ), $rows );
        $body  = array( 'meta' => FutbinHubCore::get_module_meta( '{id}' ), 'data' => $data );

        set_transient( FHUB_{ID}_CACHE_KEY, $body, 5 * MINUTE_IN_SECONDS );
        return new WP_REST_Response( $body, 200 );
    }

    public static function api_get_stats( $request ) {
        global $wpdb;
        $table = $wpdb->prefix . FHUB_{ID}_TABLE;
        return new WP_REST_Response( array(
            'meta'  => FutbinHubCore::get_module_meta( '{id}' ),
            'total' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" ),
        ), 200 );
    }

    public static function format_item( $row ) {
        if ( ! $row ) return null;
        // ... formata e retorna o item ...
        return $row;
    }
}

// Auto-init
FutbinHub{Id}Module::init();
```

---

## Arquivo 3 — `{id}-scraper.js`

```javascript
/**
 * {Id}Scraper — Módulo {Id} para Futbin Hub
 *
 * Contrato obrigatório:
 *   start(params, callbacks)
 *   stop()
 */
var {Id}Scraper = (function () {
    'use strict';

    var _running   = false;
    var _callbacks = null;
    var _params    = null;

    // ── Interface pública ────────────────────────────────────────
    function start(params, callbacks) {
        if (_running) { callbacks.onLog('Já em execução.', 'warning'); return; }
        _running   = true;
        _callbacks = callbacks;
        _params    = params;
        _run().catch(function (err) { callbacks.onError(err.message); _running = false; });
    }

    function stop() { _running = false; }

    // ── Helpers de log ───────────────────────────────────────────
    function _log(msg, type)   { if (_callbacks) _callbacks.onLog(msg, type || 'info'); }
    function _phase(txt, clr)  { if (_callbacks) _callbacks.onPhase(txt, clr); }
    function _progress(c, t)   { if (_callbacks) _callbacks.onProgress(c, t); }
    function _stats(obj)       { if (_callbacks) _callbacks.onStats(obj); }

    // ── Fluxo principal ──────────────────────────────────────────
    async function _run() {
        _phase('Iniciando...', '#3182ce');
        _log('Módulo {id} iniciado.', 'info');

        // ... sua lógica de scraping aqui ...
        // Ao final de cada passo: _log(), _progress(), _stats()
        // Ao salvar: chamar _saveToDatabase(items, isFinal)
        // Ao terminar: _callbacks.onComplete({ 'Total': 0 })

        _running = false;
        _callbacks.onComplete({ 'Total': 0 });
    }

    // ── Salvar no banco ──────────────────────────────────────────
    async function _saveToDatabase(items, isFinal) {
        var response = await fetch(_params.ajaxUrl + '?action=' + _params.ajaxAction, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ items: items, meta: {}, is_final: isFinal, nonce: _params.nonce })
        });
        var result = await response.json();
        if (result.success) {
            _log('Salvos: ' + result.data.inserted + ' novos, ' + result.data.updated + ' atualizados.', 'success');
        } else {
            _log('Erro ao salvar: ' + (result.data || 'desconhecido'), 'error');
        }
    }

    return { start: start, stop: stop };
})();
```

---

## Helpers disponíveis do Core

Use `FutbinHubCore` em todo o código PHP do módulo — sem redefinir sanitização:

```php
FutbinHubCore::sanitize_price($value)       // valida e limpa preços
FutbinHubCore::sanitize_varchar($value, $maxlen)
FutbinHubCore::normalize_name($value, $maxlen)
FutbinHubCore::json_encode_safe($value)
FutbinHubCore::set_module_meta($id, $data)  // grava metadados de execução
FutbinHubCore::get_module_meta($id)         // lê metadados de execução
```

---

## Convenções de Nomenclatura

| Elemento         | Padrão                          | Exemplo (id=players)      |
|------------------|---------------------------------|---------------------------|
| Diretório        | `modules/{id}/`                 | `modules/players/`        |
| Config PHP       | `{id}-config.php`               | `players-config.php`      |
| Classe PHP       | `FutbinHub{Id}Module`           | `FutbinHubPlayersModule`  |
| JS file          | `{id}-scraper.js`               | `players-scraper.js`      |
| JS objeto global | `{Id}Scraper`                   | `PlayersScraper`          |
| Tabela           | `fhub_{id}` (sem prefixo WP)    | `fhub_players`            |
| AJAX save        | `fhub_{id}_save`                | `fhub_players_save`       |
| AJAX clear       | `fhub_{id}_clear`               | `fhub_players_clear`      |
| REST namespace   | `fhub/v1/{id}/data`             | `fhub/v1/players/data`    |
| Cache key        | `fhub_{id}_cache_v1`            | `fhub_players_cache_v1`   |
| Constantes PHP   | `FHUB_{ID}_*`                   | `FHUB_PLAYERS_TABLE`      |

---

## O que NÃO fazer no JS do módulo

```javascript
// ❌ ERRADO — acesso direto ao DOM do Hub
$('#fhub-log-entries').prepend(...)
$('#fhub-progress-bar').css(...)

// ✅ CORRETO — comunicação via callbacks
callbacks.onLog('mensagem', 'info')
callbacks.onProgress(atual, total)
```

O módulo não deve conhecer nada sobre a estrutura HTML do Hub.
Toda atualização de UI é responsabilidade do Hub, acionada pelos callbacks.

---

## Módulos interativos (has_input: true)

Se o módulo precisar de um campo de busca (ex: buscar jogador por nome):

1. Registre com `'has_input' => true`
2. O Hub renderiza automaticamente um `<input>` na aba
3. O Hub passa o valor digitado em `params.query` no `start()`
4. O módulo usa `params.query` para iniciar a busca

O Hub trata o fluxo em dois estágios como interno ao módulo — o `start()` pode chamar `callbacks.onLog()` com resultados intermediários e aguardar uma segunda chamada de `start()` com `params.selectedUrl` para o segundo estágio.
