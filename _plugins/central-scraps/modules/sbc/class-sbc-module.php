<?php
if ( ! defined( 'ABSPATH' ) ) exit;

require_once dirname( __FILE__ ) . '/sbc-config.php';

/**
 * FutbinHubSbcModule
 *
 * Responsabilidades:
 *  - Criar / atualizar a tabela fhub_sbcs
 *  - Registrar o módulo no FutbinHubRegistry
 *  - Expor o AJAX action fhub_sbc_save (salva itens em batch)
 *  - Expor o AJAX action fhub_sbc_clear (limpa tabela + cache)
 *  - Registrar endpoints REST:
 *      GET fhub/v1/sbc/data   → lista completa (equivalente ao legado futbin/v1/data)
 *      GET fhub/v1/sbc/stats  → estatísticas   (equivalente ao legado futbin/v1/stats)
 *
 * Isolamento total: tabela fhub_sbcs, namespace fhub/v1/sbc, cache fhub_sbc_cache_v1.
 * O plugin legado (futbin_sbcs / futbin/v1) NÃO é afetado.
 */
class FutbinHubSbcModule {

    public static function init() {
        // Cria a tabela na ativação (também no init, para garantir em updates)
        self::create_table();

        // Registra no Hub
        FutbinHubRegistry::register( array(
            'id'          => 'sbc',
            'label'       => 'SBC Scraper',
            'description' => 'Coleta Squad Building Challenges do Futbin',
            'version'     => FHUB_SBC_VERSION,
            'js_object'   => 'SbcScraper',
            'js_handle'   => 'fhub-module-sbc',
            'js_path'     => FHUB_DIR . 'modules/sbc/sbc-scraper.js',
            'ajax_action' => 'fhub_sbc_save',
            'api_base'    => 'fhub/v1/sbc',
            'table'       => FHUB_SBC_TABLE,
            'has_input'   => false,
        ) );

        // AJAX: salvar
        add_action( 'wp_ajax_fhub_sbc_save',        array( __CLASS__, 'ajax_save' ) );
        add_action( 'wp_ajax_nopriv_fhub_sbc_save', array( __CLASS__, 'ajax_save' ) );

        // AJAX: limpar dados
        add_action( 'wp_ajax_fhub_sbc_clear', array( __CLASS__, 'ajax_clear' ) );

        // REST API
        add_action( 'rest_api_init', array( __CLASS__, 'register_rest_routes' ) );
    }

    // ============================================================
    // TABELA fhub_sbcs
    // Mesma estrutura do plugin legado (futbin_sbcs), nome diferente.
    // ============================================================

    public static function create_table() {
        global $wpdb;

        $table           = $wpdb->prefix . FHUB_SBC_TABLE;
        $charset_collate = $wpdb->get_charset_collate();

        $sql = "CREATE TABLE IF NOT EXISTS {$table} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,

            sbc_type     varchar(20)  NOT NULL DEFAULT 'recompensa',
            detail_url   varchar(500) NOT NULL,

            reward_name  varchar(300) DEFAULT NULL,
            reward_image varchar(500) DEFAULT NULL,

            sbc_price_console   varchar(50) DEFAULT NULL,
            sbc_price_pc        varchar(50) DEFAULT NULL,
            sbc_price_estimated varchar(50) DEFAULT NULL,

            sbc_boxes longtext DEFAULT NULL,

            player_url       varchar(500) DEFAULT NULL,
            player_name      varchar(200) DEFAULT NULL,
            player_rating    varchar(10)  DEFAULT NULL,
            player_position  varchar(20)  DEFAULT NULL,
            player_role_plus varchar(100) DEFAULT NULL,

            player_price_console varchar(50) DEFAULT NULL,
            player_price_pc      varchar(50) DEFAULT NULL,

            player_image_bg   varchar(500) DEFAULT NULL,
            player_image_face varchar(500) DEFAULT NULL,

            player_stats  longtext DEFAULT NULL,
            player_info   longtext DEFAULT NULL,
            player_render longtext DEFAULT NULL,

            sort_index   int(11) unsigned NOT NULL DEFAULT 0,
            scrape_token varchar(32)      DEFAULT NULL,

            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

            PRIMARY KEY  (id),
            KEY idx_type        (sbc_type),
            KEY idx_player_name (player_name),
            KEY idx_created     (created_at),
            KEY idx_sort        (sort_index),
            UNIQUE KEY idx_detail_url (detail_url)
        ) {$charset_collate};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta( $sql );

        // Garante migração da coluna sort_index em tabelas já existentes
        // (dbDelta não é confiável para ALTER em todas as versões do WP)
        $columns = $wpdb->get_col( "SHOW COLUMNS FROM {$table} LIKE 'sort_index'" );
        if ( empty( $columns ) ) {
            $wpdb->query( "ALTER TABLE {$table} ADD COLUMN sort_index int(11) unsigned NOT NULL DEFAULT 0 AFTER player_render" );
            $wpdb->query( "ALTER TABLE {$table} ADD KEY idx_sort (sort_index)" );
        }

        $col_token = $wpdb->get_col( "SHOW COLUMNS FROM {$table} LIKE 'scrape_token'" );
        if ( empty( $col_token ) ) {
            $wpdb->query( "ALTER TABLE {$table} ADD COLUMN scrape_token varchar(32) DEFAULT NULL AFTER sort_index" );
        }
    }

    // ============================================================
    // AJAX: SALVAR (fhub_sbc_save)
    // Recebe JSON: { items: [...], meta: {...}, is_final: bool }
    // ============================================================

    public static function ajax_save() {
        global $wpdb;

        @ini_set( 'memory_limit',       '512M' );
        @ini_set( 'max_execution_time', '300'  );

        $raw = file_get_contents( 'php://input' );
        if ( ! $raw ) {
            wp_send_json_error( 'Nenhum dado recebido' );
            return;
        }

        $request = json_decode( $raw, true );
        if ( ! $request ) {
            wp_send_json_error( 'JSON inválido: ' . json_last_error_msg() );
            return;
        }

        // Verifica nonce (enviado pelo JS via params.nonce no payload)
        $nonce = sanitize_text_field( $request['nonce'] ?? '' );
        if ( ! wp_verify_nonce( $nonce, 'fhub_nonce' ) ) {
            // Loga mas não bloqueia — scraper roda como nopriv em sessão admin aberta.
            // Para restringir apenas a usuários logados, troque por wp_send_json_error('Nonce inválido', 403).
            error_log( 'FutbinHub SBC ajax_save: nonce ausente ou inválido.' );
        }

        if ( ! isset( $request['items'], $request['meta'] ) ) {
            wp_send_json_error( 'JSON incompleto — faltam campos: items ou meta' );
            return;
        }

        $items    = $request['items'];
        $meta     = $request['meta'];
        $is_final = $request['is_final'] ?? false;

        $table    = $wpdb->prefix . FHUB_SBC_TABLE;
        $inserted = 0;
        $updated  = 0;
        $errors   = 0;
        $errs     = array();

        foreach ( $items as $index => $item ) {
            try {
                $data = array(
                    'sort_index'   => isset( $item['sort_index'] ) ? (int) $item['sort_index'] : 0,
                    'scrape_token' => isset( $item['scrape_token'] ) ? sanitize_text_field( $item['scrape_token'] ) : null,
                    'sbc_type'     => FutbinHubCore::sanitize_varchar( $item['type']       ?? 'recompensa', 20 ),
                    'detail_url'   => FutbinHubCore::sanitize_varchar( $item['detail_url'] ?? '', 500 ),
                );

                if ( empty( $data['detail_url'] ) ) {
                    $errors++;
                    $errs[] = "Item {$index}: detail_url vazio";
                    continue;
                }

                $data['reward_name']  = FutbinHubCore::normalize_name(   $item['reward_name']  ?? null, 300 );
                $data['reward_image'] = FutbinHubCore::sanitize_varchar(  $item['reward_image'] ?? null, 500 );

                if ( isset( $item['sbc'] ) ) {
                    $sbc = $item['sbc'];
                    $data['sbc_price_console']   = FutbinHubCore::sanitize_price( $sbc['top_prices']['console']   ?? null );
                    $data['sbc_price_pc']        = FutbinHubCore::sanitize_price( $sbc['top_prices']['pc']        ?? null );
                    $data['sbc_price_estimated'] = FutbinHubCore::sanitize_price( $sbc['top_prices']['estimated'] ?? null );
                    $data['sbc_boxes']           = ! empty( $sbc['boxes'] )
                        ? FutbinHubCore::json_encode_safe( $sbc['boxes'] )
                        : null;
                }

                if ( isset( $item['player'] ) && ! empty( $item['player'] ) ) {
                    $p = $item['player'];

                    $data['player_url']       = FutbinHubCore::sanitize_varchar( $p['player_url'] ?? null, 500 );
                    $data['player_name']      = FutbinHubCore::normalize_name(   $p['name']       ?? null, 200 );
                    $data['player_rating']    = FutbinHubCore::sanitize_varchar( $p['rating']     ?? null, 10  );
                    $data['player_position']  = FutbinHubCore::sanitize_varchar( $p['position']   ?? null, 20  );
                    $data['player_role_plus'] = FutbinHubCore::sanitize_varchar( $p['role_plus']  ?? null, 100 );

                    if ( isset( $p['prices'] ) ) {
                        $data['player_price_console'] = FutbinHubCore::sanitize_price( $p['prices']['console'] ?? null );
                        $data['player_price_pc']      = FutbinHubCore::sanitize_price( $p['prices']['pc']      ?? null );
                    }

                    if ( isset( $p['images'] ) ) {
                        $data['player_image_bg']   = FutbinHubCore::sanitize_varchar( $p['images']['bg']   ?? null, 500 );
                        $data['player_image_face'] = FutbinHubCore::sanitize_varchar( $p['images']['face'] ?? null, 500 );
                    }

                    $data['player_stats']  = FutbinHubCore::json_encode_safe( $p['stats']  ?? null );
                    $data['player_info']   = FutbinHubCore::json_encode_safe( $p['info']   ?? null );
                    $data['player_render'] = FutbinHubCore::json_encode_safe( array(
                        'card_style_raw' => $p['card_style_raw'] ?? null,
                        'card_css_vars'  => $p['card_css_vars']  ?? null,
                        'alt_sidebar'    => $p['alt_sidebar']    ?? null,
                        'playstyles'     => $p['playstyles']     ?? null,
                        'extra_info'     => $p['extra_info']     ?? null,
                    ) );
                }

                $exists = $wpdb->get_var( $wpdb->prepare(
                    "SELECT id FROM {$table} WHERE detail_url = %s",
                    $data['detail_url']
                ) );

                if ( $exists ) {
                    $result = $wpdb->update( $table, $data, array( 'id' => $exists ) );
                    if ( $result === false ) { $errors++; $errs[] = "Update {$index}: " . $wpdb->last_error; }
                    else $updated++;
                } else {
                    $result = $wpdb->insert( $table, $data );
                    if ( $result === false ) { $errors++; $errs[] = "Insert {$index}: " . $wpdb->last_error; }
                    else $inserted++;
                }

            } catch ( Exception $e ) {
                $errors++;
                $errs[] = "Item {$index}: " . $e->getMessage();
            }
        }

        // Grava metadados globais ao finalizar
        if ( $is_final ) {
            // Remove itens obsoletos: linhas salvas em runs anteriores
            // que não existem mais no Futbin (scrape_token diferente do atual).
            $current_token = sanitize_text_field( $meta['scrape_token'] ?? '' );
            if ( $current_token ) {
                $deleted = $wpdb->query(
                    $wpdb->prepare(
                        "DELETE FROM {$table} WHERE scrape_token != %s OR scrape_token IS NULL",
                        $current_token
                    )
                );
                if ( $deleted > 0 ) {
                    error_log( "FutbinHub SBC: {$deleted} item(s) obsoleto(s) removido(s) (token anterior)." );
                }
            }

            FutbinHubCore::set_module_meta( 'sbc', array(
                'timestamp'   => $meta['timestamp']   ?? gmdate( 'c' ),
                'status'      => 'completed',
                'total_items' => $meta['cards_total'] ?? 0,
                'pages'       => $meta['pages']       ?? 0,
                'jogadores'   => $meta['jogadores']   ?? 0,
                'recompensas' => $meta['recompensas'] ?? 0,
            ) );

            // Invalida todos os transients de cache (com e sem filtro de tipo)
            delete_transient( FHUB_SBC_CACHE_KEY );
            delete_transient( FHUB_SBC_CACHE_KEY . '_jogador' );
            delete_transient( FHUB_SBC_CACHE_KEY . '_recompensa' );
        }

        $response = array(
            'inserted' => $inserted,
            'updated'  => $updated,
            'errors'   => $errors,
            'is_final' => $is_final,
        );
        if ( ! empty( $errs ) ) $response['error_messages'] = $errs;

        wp_send_json_success( $response );
    }

    // ============================================================
    // AJAX: LIMPAR (fhub_sbc_clear)
    // ============================================================

    public static function ajax_clear() {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_send_json_error( array( 'message' => 'Permissão negada' ) );
            return;
        }

        check_ajax_referer( 'fhub_nonce', 'nonce' );

        global $wpdb;
        $wpdb->query( 'TRUNCATE TABLE ' . $wpdb->prefix . FHUB_SBC_TABLE );

        // Invalida todos os transients de cache
        delete_transient( FHUB_SBC_CACHE_KEY );
        delete_transient( FHUB_SBC_CACHE_KEY . '_jogador' );
        delete_transient( FHUB_SBC_CACHE_KEY . '_recompensa' );

        // Atualiza metadados para refletir limpeza
        FutbinHubCore::set_module_meta( 'sbc', array(
            'timestamp'   => gmdate( 'c' ),
            'status'      => 'cleared',
            'total_items' => 0,
        ) );

        wp_send_json_success( array( 'message' => 'Dados limpos e cache invalidado.' ) );
    }

    // ============================================================
    // REST API
    // ============================================================

    public static function register_rest_routes() {
        $ns = 'fhub/v1';

        register_rest_route( $ns, '/sbc/data', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'api_get_data' ),
            'permission_callback' => '__return_true',
            'args'                => array(
                'type' => array( 'default' => '', 'sanitize_callback' => 'sanitize_text_field' ),
            ),
        ) );

// Adiciona APÓS o register de /sbc/stats
register_rest_route( $ns, '/sbc/feed', array(
    'methods'             => 'GET',
    'callback'            => array( __CLASS__, 'api_get_feed' ),
    'permission_callback' => '__return_true',
) );
        register_rest_route( $ns, '/sbc/stats', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'api_get_stats' ),
            'permission_callback' => '__return_true',
        ) );
    }

    // ── GET /fhub/v1/sbc/data ────────────────────────────────────

    public static function api_get_data( $request ) {
        global $wpdb;

        $table = $wpdb->prefix . FHUB_SBC_TABLE;
        $type  = $request->get_param( 'type' );

        // Cache separado por tipo para evitar retornar dados incorretos
        $cache_key = FHUB_SBC_CACHE_KEY;
        if ( $type && in_array( $type, array( 'jogador', 'recompensa' ), true ) ) {
            $cache_key = FHUB_SBC_CACHE_KEY . '_' . $type;
        }

        $cached = get_transient( $cache_key );
        if ( $cached !== false ) {
            return new WP_REST_Response( $cached, 200 );
        }

        // Ordenação exclusivamente por sort_index ASC — respeita a ordem
        // original do Futbin onde jogadores mais recentes têm sort_index menor
        if ( $type && in_array( $type, array( 'jogador', 'recompensa' ), true ) ) {
            $rows = $wpdb->get_results(
                $wpdb->prepare( "SELECT * FROM {$table} WHERE sbc_type = %s ORDER BY sort_index ASC", $type ),
                ARRAY_A
            );
        } else {
            $rows = $wpdb->get_results(
                "SELECT * FROM {$table} ORDER BY sort_index ASC",
                ARRAY_A
            );
        }

        $meta_raw = FutbinHubCore::get_module_meta( 'sbc' );

        $meta = array(
            'timestamp'   => $meta_raw['timestamp'] ?? gmdate( 'c' ),
            'pages'       => isset( $meta_raw['pages'] ) ? (int) $meta_raw['pages'] : 0,
            'cards_total' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" ),
            'jogadores'   => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table} WHERE sbc_type = 'jogador'" ),
            'recompensas' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table} WHERE sbc_type = 'recompensa'" ),
        );

        $data = array_values( array_filter( array_map(
            array( __CLASS__, 'format_item' ),
            $rows
        ) ) );

        $response_body = array( 'meta' => $meta, 'data' => $data );

        // Cache por 5 minutos — invalidado ao final do scraping
        set_transient( $cache_key, $response_body, 5 * MINUTE_IN_SECONDS );

        return new WP_REST_Response( $response_body, 200 );
    }

    // ── GET /fhub/v1/sbc/stats ───────────────────────────────────

    public static function api_get_stats( $request ) {
        global $wpdb;

        $table = $wpdb->prefix . FHUB_SBC_TABLE;

        $by_type = array();
        foreach ( $wpdb->get_results( "SELECT sbc_type, COUNT(*) as count FROM {$table} GROUP BY sbc_type", ARRAY_A ) as $row ) {
            $by_type[ $row['sbc_type'] ] = (int) $row['count'];
        }

        $top_players = $wpdb->get_results( "
            SELECT player_name, player_rating, player_position,
                   player_price_console, player_price_pc
            FROM {$table}
            WHERE sbc_type = 'jogador' AND player_rating IS NOT NULL
            ORDER BY CAST(player_rating AS UNSIGNED) DESC
            LIMIT 10
        ", ARRAY_A );

        return new WP_REST_Response( array(
            'meta'        => FutbinHubCore::get_module_meta( 'sbc' ),
            'total'       => array_sum( $by_type ),
            'by_type'     => $by_type,
            'top_players' => $top_players,
        ), 200 );
    }

public static function api_get_feed() {
    global $wpdb;
    $table = $wpdb->prefix . FHUB_SBC_TABLE;

    $rows = $wpdb->get_results(
        "SELECT * FROM {$table} ORDER BY sort_index ASC",
        ARRAY_A
    );

    $items = array_values( array_map( function( $row ) {
        $formatted  = FutbinHubSbcModule::format_item( $row );
        $is_player  = $row['sbc_type'] === 'jogador';
        $boxes      = $formatted['sbc']['boxes'] ?? array();
        $player     = $formatted['player']       ?? array();
        $top_prices = $formatted['sbc']['top_prices'] ?? array();

        // boxes → challenges no shape que o FC_DME_API::normalize_item() espera
        $challenges = array_map( function( $box ) {
            return array(
                'name'         => $box['nome']     ?? '',
                'img_url'      => $box['imagem']   ?? '',
                'reward'       => $box['nome']     ?? '',
                'description'  => '',
                'requirements' => array(),
                'price_ps'     => $box['valor_ps'] ?? $box['valor'] ?? '',
                'price_pc'     => $box['valor_pc'] ?? $box['valor'] ?? '',
            );
        }, $boxes );

        // player → player_details no shape que o FC_DME_API::normalize_item() espera
        $player_details = null;
        if ( $is_player && ! empty( $player ) ) {
            $player_details = array(
                'player_url'     => $player['player_url']     ?? '',
                'name'           => $player['name']           ?? '',
                'rating'         => $player['rating']         ?? '',
                'position'       => $player['position']       ?? '',
                'role_plus'      => $player['role_plus']      ?? '',
                'images'         => $player['images']         ?? array(),
                'stats'          => $player['stats']          ?? array(),
                'info'           => $player['info']           ?? array(),
                'card_style_raw' => $player['card_style_raw'] ?? null,
                'card_css_vars'  => $player['card_css_vars']  ?? null,
                'alt_sidebar'    => $player['alt_sidebar']    ?? null,
                'playstyles'     => $player['playstyles']     ?? null,
                'extra_info'     => $player['extra_info']     ?? null,
                'prices'         => array(
                    'console'   => $player['prices']['console']   ?? null,
                    'pc'        => $player['prices']['pc']        ?? null,
                    'estimated' => $player['prices']['estimated'] ?? null,
                ),
            );
        }

        return array(
            'id'             => $row['id'],
            'name'           => $row['reward_name']  ?? '',
            'is_player'      => $is_player,
            'full_url'       => $row['detail_url']   ?? '',
            'badge'          => '',
            'price_ps'       => $top_prices['console'] ?? '',
            'price_pc'       => $top_prices['pc']      ?? '',
            'reward_img'     => $row['reward_image'] ?? '',
            'reward_text'    => $row['reward_name']  ?? '',
            'challenges'     => $challenges,
            'player_details' => $player_details,
            'player_preview' => $is_player && ! empty( $player ) ? array(
                'name'       => $player['name']           ?? '',
                'rating'     => $player['rating']         ?? '',
                'position'   => $player['position']       ?? '',
                'bg_img'     => $player['images']['bg']   ?? '',
                'face_img'   => $player['images']['face'] ?? '',
                'player_url' => $player['player_url']     ?? '',
            ) : null,
            'expires_in'  => '',
            'repeatable'  => '',
            'completed'   => '',
            'scraped_at'  => $row['created_at'] ?? '',
            'votes'       => null,
        );
    }, $rows ?: array() ) );

    return new WP_REST_Response( array(
        'total'       => count( $items ),
        'last_update' => gmdate( 'c' ),
        'data'        => $items,
    ), 200 );
}
    // ============================================================
    // FORMATADOR DE ITEM (identico ao plugin legado, adaptado)
    // ============================================================

    public static function format_item( $row ) {
        if ( ! $row ) return null;

        // ── Boxes: normaliza valor_ps / valor_pc ─────────────────
        $raw_boxes = $row['sbc_boxes'] ? json_decode( $row['sbc_boxes'], true ) : array();
        if ( ! is_array( $raw_boxes ) ) $raw_boxes = array();

        $boxes = array_map( function ( $box ) {
            $valor    = $box['valor']    ?? null;
            $valor_ps = $box['valor_ps'] ?? null;
            $valor_pc = $box['valor_pc'] ?? null;

            // Retrocompatibilidade: formato antigo "15.000 | 12.000"
            if ( $valor !== null && strpos( $valor, ' | ' ) !== false && $valor_ps === null ) {
                $parts    = explode( ' | ', $valor, 2 );
                $valor_ps = trim( $parts[0] ) !== '' ? trim( $parts[0] ) : null;
                $valor_pc = trim( $parts[1] ) !== '' ? trim( $parts[1] ) : null;
                $valor    = $valor_ps;
            }

            if ( $valor === null ) $valor = $valor_ps ?? $valor_pc;

            return array(
                'nome'     => $box['nome']   ?? null,
                'imagem'   => $box['imagem'] ?? null,
                'valor'    => $valor,
                'valor_ps' => $valor_ps,
                'valor_pc' => $valor_pc,
            );
        }, $raw_boxes );

        // ── Injeta reward_name em boxes[0]['nome'] se vazio ───────
        if ( $row['sbc_type'] === 'recompensa' && ! empty( $row['reward_name'] ) ) {
            if ( ! empty( $boxes ) ) {
                if ( empty( $boxes[0]['nome'] ) ) $boxes[0]['nome'] = $row['reward_name'];
            } else {
                $boxes[] = array(
                    'nome'     => $row['reward_name'],
                    'imagem'   => $row['reward_image'] ?? null,
                    'valor'    => null,
                    'valor_ps' => null,
                    'valor_pc' => null,
                );
            }
        }

        // ── SBC ───────────────────────────────────────────────────
        $sbc = array(
            'top_prices' => array(
                'console'   => $row['sbc_price_console'],
                'pc'        => $row['sbc_price_pc'],
                'estimated' => $row['sbc_price_estimated'],
            ),
            'boxes' => $boxes,
        );

        // ── Player ────────────────────────────────────────────────
        $player = array();

        if ( $row['sbc_type'] === 'jogador' && ! empty( $row['player_name'] ) ) {
            $render = $row['player_render'] ? json_decode( $row['player_render'], true ) : array();

            $player = array(
                'player_url'     => $row['player_url'],
                'name'           => $row['player_name'],
                'rating'         => $row['player_rating'],
                'position'       => $row['player_position'],
                'role_plus'      => $row['player_role_plus'],
                'images'         => array(
                    'bg'   => $row['player_image_bg'],
                    'face' => $row['player_image_face'],
                ),
                'stats'          => $row['player_stats'] ? json_decode( $row['player_stats'], true ) : null,
                'info'           => $row['player_info']  ? json_decode( $row['player_info'],  true ) : null,
                'prices'         => array(
                    'console'   => $row['player_price_console'],
                    'pc'        => $row['player_price_pc'],
                    'estimated' => $row['sbc_price_estimated'] ?? null,
                ),
                'card_style_raw' => $render['card_style_raw'] ?? null,
                'card_css_vars'  => $render['card_css_vars']  ?? null,
                'alt_sidebar'    => $render['alt_sidebar']    ?? null,
                'playstyles'     => $render['playstyles']     ?? null,
                'extra_info'     => $render['extra_info']     ?? null,
            );
        }

        return array(
            'type'         => $row['sbc_type'],
            'detail_url'   => $row['detail_url'],
            'reward_name'  => $row['reward_name'],
            'reward_image' => $row['reward_image'],
            'sbc'          => $sbc,
            'player'       => $player,
        );
    }
}

// Auto-init ao carregar o arquivo
FutbinHubSbcModule::init();