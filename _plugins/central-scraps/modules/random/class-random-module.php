<?php
if ( ! defined( 'ABSPATH' ) ) exit;

require_once dirname( __FILE__ ) . '/random-config.php';

/**
 * FutbinHubRandomModule
 *
 * Responsabilidades:
 *  - Criar / atualizar as tabelas fhub_random_queue e fhub_random_results
 *  - Registrar o módulo no FutbinHubRegistry
 *  - Expor o AJAX action fhub_random_save (salva resultado de um pedido)
 *  - Expor o AJAX action fhub_random_clear (limpa tabelas)
 *  - Registrar endpoints REST:
 *      POST fhub/v1/random/request        → cria pedido na fila, retorna queue_id
 *      GET  fhub/v1/random/queue          → lista fila (uso interno do painel JS)
 *      GET  fhub/v1/random/result/{id}    → retorna resultado de um pedido
 *      GET  fhub/v1/random/data           → sumário da fila (link do painel)
 *
 * Isolamento total: tabelas fhub_random_*, namespace fhub/v1/random.
 * O módulo SBC e o plugin legado NÃO são afetados.
 */
class FutbinHubRandomModule {

    public static function init() {
        self::create_tables();

        FutbinHubRegistry::register( array(
            'id'          => 'random',
            'label'       => 'Random Player Scraper',
            'description' => 'Busca jogadores aleatórios por faixa de preço via fila de pedidos',
            'version'     => FHUB_RANDOM_VERSION,
            'js_object'   => 'RandomScraper',
            'js_handle'   => 'fhub-module-random',
            'js_path'     => FHUB_DIR . 'modules/random/random-scraper.js',
            'ajax_action' => 'fhub_random_save',
            'api_base'    => 'fhub/v1/random',
            'table'       => FHUB_RANDOM_QUEUE_TABLE,
            'has_input'   => false,
        ) );

        add_action( 'wp_ajax_fhub_random_save',        array( __CLASS__, 'ajax_save' ) );
        add_action( 'wp_ajax_nopriv_fhub_random_save', array( __CLASS__, 'ajax_save' ) );
        add_action( 'wp_ajax_fhub_random_clear',       array( __CLASS__, 'ajax_clear' ) );
        add_action( 'rest_api_init',                   array( __CLASS__, 'register_rest_routes' ) );
    }

    // ============================================================
    // TABELAS
    // ============================================================

    public static function create_tables() {
        global $wpdb;

        $charset_collate = $wpdb->get_charset_collate();

        $queue_table   = $wpdb->prefix . FHUB_RANDOM_QUEUE_TABLE;
        $results_table = $wpdb->prefix . FHUB_RANDOM_RESULTS_TABLE;

        $sql_queue = "CREATE TABLE IF NOT EXISTS {$queue_table} (
            id              bigint(20) unsigned  NOT NULL AUTO_INCREMENT,
            queue_id        varchar(36)          NOT NULL,
            platform        varchar(5)           NOT NULL DEFAULT 'ps',
            ranges          longtext             NOT NULL,
            status          varchar(20)          NOT NULL DEFAULT 'pending',
            requested_total int(11)              NOT NULL DEFAULT 0,
            found_total     int(11)              NOT NULL DEFAULT 0,
            execution_time  varchar(20)          DEFAULT NULL,
            error_message   varchar(500)         DEFAULT NULL,
            created_at      datetime             DEFAULT CURRENT_TIMESTAMP,
            processed_at    datetime             DEFAULT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY idx_queue_id (queue_id),
            KEY idx_status     (status),
            KEY idx_created    (created_at)
        ) {$charset_collate};";

        $sql_results = "CREATE TABLE IF NOT EXISTS {$results_table} (
            id          bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            queue_id    varchar(36)         NOT NULL,
            player_id   varchar(20)         NOT NULL,
            player_slug varchar(200)        DEFAULT NULL,
            player_data longtext            DEFAULT NULL,
            price_info  longtext            DEFAULT NULL,
            created_at  datetime            DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_queue_id  (queue_id),
            KEY idx_player_id (player_id)
        ) {$charset_collate};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta( $sql_queue );
        dbDelta( $sql_results );

        // Migrações defensivas — colunas adicionadas em versões futuras
        self::maybe_add_column( $queue_table,   'error_message', "ADD COLUMN error_message varchar(500) DEFAULT NULL AFTER execution_time" );
        self::maybe_add_column( $results_table, 'price_info',    "ADD COLUMN price_info longtext DEFAULT NULL AFTER player_data" );
    }

    private static function maybe_add_column( $table, $column, $alter_sql ) {
        global $wpdb;
        $exists = $wpdb->get_results( "SHOW COLUMNS FROM {$table} LIKE '{$column}'" );
        if ( empty( $exists ) ) {
            $wpdb->query( "ALTER TABLE {$table} {$alter_sql}" );
        }
    }

    // ============================================================
    // AJAX: SALVAR RESULTADO (fhub_random_save)
    // Payload: { queue_id, players[], execution_time, status, nonce }
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

        $nonce = sanitize_text_field( $request['nonce'] ?? '' );
        if ( ! wp_verify_nonce( $nonce, 'fhub_nonce' ) ) {
            error_log( 'FutbinHub Random ajax_save: nonce ausente ou inválido.' );
        }

        $queue_id      = sanitize_text_field( $request['queue_id']      ?? '' );
        $players       = $request['players']       ?? array();
        $execution_time = sanitize_text_field( $request['execution_time'] ?? '' );
        $status        = sanitize_text_field( $request['status']        ?? 'completed' );
        $error_message  = sanitize_text_field( $request['error_message']  ?? '' );

        if ( empty( $queue_id ) ) {
            wp_send_json_error( 'queue_id ausente' );
            return;
        }

        $queue_table   = $wpdb->prefix . FHUB_RANDOM_QUEUE_TABLE;
        $results_table = $wpdb->prefix . FHUB_RANDOM_RESULTS_TABLE;

        // Verifica se o pedido existe
        $queue_row = $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM {$queue_table} WHERE queue_id = %s",
            $queue_id
        ), ARRAY_A );

        if ( ! $queue_row ) {
            wp_send_json_error( 'queue_id não encontrado: ' . $queue_id );
            return;
        }

        $inserted = 0;
        $errors   = 0;
        $errs     = array();

        // Remove resultados anteriores deste pedido (re-processamento)
        $wpdb->delete( $results_table, array( 'queue_id' => $queue_id ), array( '%s' ) );

        foreach ( $players as $idx => $player ) {
            try {
                $player_id   = FutbinHubCore::sanitize_varchar( $player['id']   ?? null, 20  );
                $player_slug = FutbinHubCore::sanitize_varchar( $player['slug'] ?? null, 200 );

                if ( empty( $player_id ) ) {
                    $errors++;
                    $errs[] = "Player {$idx}: id vazio";
                    continue;
                }

                // Separa price_info do restante
                $price_info  = $player['price_info'] ?? null;
                $player_data = $player;
                // Remove campos que ficam em colunas próprias
                unset( $player_data['id'], $player_data['slug'], $player_data['price_info'] );

                $result = $wpdb->insert(
                    $results_table,
                    array(
                        'queue_id'    => $queue_id,
                        'player_id'   => $player_id,
                        'player_slug' => $player_slug,
                        'player_data' => FutbinHubCore::json_encode_safe( $player_data ),
                        'price_info'  => FutbinHubCore::json_encode_safe( $price_info ),
                    ),
                    array( '%s', '%s', '%s', '%s', '%s' )
                );

                if ( $result === false ) {
                    $errors++;
                    $errs[] = "Insert player {$idx}: " . $wpdb->last_error;
                } else {
                    $inserted++;
                }

            } catch ( Exception $e ) {
                $errors++;
                $errs[] = "Player {$idx}: " . $e->getMessage();
            }
        }

        // Atualiza status do pedido na fila
        $update_data = array(
            'status'         => in_array( $status, array( 'completed', 'failed', 'pending' ), true ) ? $status : 'completed',
            'found_total'    => $inserted,
            'execution_time' => $execution_time,
            'processed_at'   => current_time( 'mysql', true ),
        );

        if ( ! empty( $error_message ) ) {
            $update_data['error_message'] = substr( $error_message, 0, 500 );
        }

        $wpdb->update( $queue_table, $update_data, array( 'queue_id' => $queue_id ) );

        // Atualiza metadados do módulo
        $total_completed = (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM {$queue_table} WHERE status = 'completed'"
        );
        FutbinHubCore::set_module_meta( 'random', array(
            'timestamp'        => gmdate( 'c' ),
            'status'           => 'active',
            'total_items'      => $total_completed,
            'last_queue_id'    => $queue_id,
            'last_found_total' => $inserted,
        ) );

        $response = array(
            'queue_id' => $queue_id,
            'inserted' => $inserted,
            'errors'   => $errors,
            'status'   => $update_data['status'],
        );
        if ( ! empty( $errs ) ) $response['error_messages'] = $errs;

        wp_send_json_success( $response );
    }

    // ============================================================
    // AJAX: LIMPAR (fhub_random_clear)
    // ============================================================

    public static function ajax_clear() {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_send_json_error( array( 'message' => 'Permissão negada' ) );
            return;
        }

        check_ajax_referer( 'fhub_nonce', 'nonce' );

        global $wpdb;
        $wpdb->query( 'TRUNCATE TABLE ' . $wpdb->prefix . FHUB_RANDOM_QUEUE_TABLE );
        $wpdb->query( 'TRUNCATE TABLE ' . $wpdb->prefix . FHUB_RANDOM_RESULTS_TABLE );

        FutbinHubCore::set_module_meta( 'random', array(
            'timestamp'   => gmdate( 'c' ),
            'status'      => 'cleared',
            'total_items' => 0,
        ) );

        wp_send_json_success( array( 'message' => 'Fila e resultados limpos.' ) );
    }

    // ============================================================
    // REST API
    // ============================================================

    public static function register_rest_routes() {
        $ns = 'fhub/v1';

        // POST /request — consumidor externo envia pedido
        register_rest_route( $ns, '/random/request', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'api_post_request' ),
            'permission_callback' => '__return_true',
        ) );

        // GET /queue — painel JS lê pedidos pendentes
        register_rest_route( $ns, '/random/queue', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'api_get_queue' ),
            'permission_callback' => '__return_true',
            'args'                => array(
                'status' => array( 'default' => 'pending', 'sanitize_callback' => 'sanitize_text_field' ),
            ),
        ) );

        // GET /result/{queue_id} — consumidor retira resultado
        register_rest_route( $ns, '/random/result/(?P<queue_id>[a-zA-Z0-9\-]{8,36})', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'api_get_result' ),
            'permission_callback' => '__return_true',
        ) );

// GET /draw — endpoint síncrono para consumo interno (CPO e outros plugins)
        register_rest_route( $ns, '/random/draw', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'api_get_draw' ),
            'permission_callback' => '__return_true',
            'args'                => array(
                'platform' => array( 'default' => 'ps',  'sanitize_callback' => 'sanitize_text_field' ),
                'count'    => array( 'default' => 1,     'sanitize_callback' => 'absint' ),
                'min'      => array( 'default' => 0,     'sanitize_callback' => 'absint' ),
                'max'      => array( 'default' => 0,     'sanitize_callback' => 'absint' ),
            ),
        ) );

        // GET /proxy — proxy server-side para Futbin
        register_rest_route( $ns, '/random/proxy', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'api_proxy' ),
            'permission_callback' => '__return_true',
        ) );


        // GET /proxy — proxy server-side para Futbin
        register_rest_route( $ns, '/random/proxy', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'api_proxy' ),
            'permission_callback' => '__return_true',
        ) );

        // GET /data — sumário da fila (link do painel)
        register_rest_route( $ns, '/random/data', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'api_get_data' ),
            'permission_callback' => '__return_true',
        ) );
    }

    // ── POST /fhub/v1/random/request ─────────────────────────────
    // Body: { "players": [{"min":100000,"max":200000,"count":3}], "platform":"ps" }

    public static function api_post_request( $request ) {
        global $wpdb;

        $body = $request->get_json_params();

        if ( empty( $body ) ) {
            return new WP_REST_Response( array(
                'success' => false,
                'message' => 'Body vazio ou JSON inválido',
            ), 400 );
        }

        $ranges_raw = $body['players'] ?? array();
        $platform   = sanitize_text_field( $body['platform'] ?? 'ps' );

        if ( ! in_array( $platform, array( 'ps', 'pc' ), true ) ) {
            return new WP_REST_Response( array(
                'success' => false,
                'message' => "platform deve ser 'ps' ou 'pc'",
            ), 400 );
        }

        if ( ! is_array( $ranges_raw ) || empty( $ranges_raw ) ) {
            return new WP_REST_Response( array(
                'success' => false,
                'message' => "'players' deve ser uma lista não vazia",
            ), 400 );
        }

        $ranges         = array();
        $requested_total = 0;

        foreach ( $ranges_raw as $i => $r ) {
            if ( ! isset( $r['min'], $r['max'] ) ) {
                return new WP_REST_Response( array(
                    'success' => false,
                    'message' => "Range {$i} precisa de 'min' e 'max'",
                ), 400 );
            }

            $min   = (int) $r['min'];
            $max   = (int) $r['max'];
            $count = isset( $r['count'] ) ? (int) $r['count'] : 1;

            if ( $min <= 0 || $max <= 0 || $min >= $max ) {
                return new WP_REST_Response( array(
                    'success' => false,
                    'message' => "Range {$i}: min deve ser positivo e menor que max",
                ), 400 );
            }

            if ( $count < 1 || $count > 50 ) {
                return new WP_REST_Response( array(
                    'success' => false,
                    'message' => "Range {$i}: count deve estar entre 1 e 50",
                ), 400 );
            }

            $ranges[]         = array( 'min' => $min, 'max' => $max, 'count' => $count );
            $requested_total += $count;
        }

        if ( $requested_total > 50 ) {
            return new WP_REST_Response( array(
                'success' => false,
                'message' => 'Máximo de 50 jogadores por pedido',
            ), 400 );
        }

        $queue_id = self::generate_queue_id();
        $table    = $wpdb->prefix . FHUB_RANDOM_QUEUE_TABLE;

        $result = $wpdb->insert(
            $table,
            array(
                'queue_id'        => $queue_id,
                'platform'        => $platform,
                'ranges'          => wp_json_encode( $ranges ),
                'status'          => 'pending',
                'requested_total' => $requested_total,
            ),
            array( '%s', '%s', '%s', '%s', '%d' )
        );

        if ( $result === false ) {
            return new WP_REST_Response( array(
                'success' => false,
                'message' => 'Erro ao criar pedido: ' . $wpdb->last_error,
            ), 500 );
        }

        return new WP_REST_Response( array(
            'success'   => true,
            'queue_id'  => $queue_id,
            'status'    => 'pending',
            'platform'  => $platform,
            'requested' => $requested_total,
            'ranges'    => $ranges,
            'message'   => 'Pedido adicionado à fila com sucesso',
        ), 201 );
    }

    // ── GET /fhub/v1/random/queue ─────────────────────────────────

    public static function api_get_queue( $request ) {
        global $wpdb;

        $table  = $wpdb->prefix . FHUB_RANDOM_QUEUE_TABLE;
        $status = $request->get_param( 'status' );

        $allowed_statuses = array( 'pending', 'processing', 'completed', 'failed', 'all' );
        if ( ! in_array( $status, $allowed_statuses, true ) ) {
            $status = 'pending';
        }

        if ( $status === 'all' ) {
            $rows = $wpdb->get_results(
                "SELECT * FROM {$table} ORDER BY created_at DESC LIMIT 100",
                ARRAY_A
            );
        } else {
            $rows = $wpdb->get_results( $wpdb->prepare(
                "SELECT * FROM {$table} WHERE status = %s ORDER BY created_at ASC",
                $status
            ), ARRAY_A );
        }

        $items = array_map( function ( $row ) {
            return array(
                'queue_id'        => $row['queue_id'],
                'platform'        => $row['platform'],
                'ranges'          => json_decode( $row['ranges'], true ),
                'status'          => $row['status'],
                'requested_total' => (int) $row['requested_total'],
                'found_total'     => (int) $row['found_total'],
                'execution_time'  => $row['execution_time'],
                'created_at'      => $row['created_at'],
                'processed_at'    => $row['processed_at'],
            );
        }, $rows ?: array() );

        return new WP_REST_Response( array(
            'success' => true,
            'count'   => count( $items ),
            'status'  => $status,
            'items'   => $items,
        ), 200 );
    }

    // ── GET /fhub/v1/random/result/{queue_id} ────────────────────

    public static function api_get_result( $request ) {
        global $wpdb;

        $queue_id    = sanitize_text_field( $request->get_param( 'queue_id' ) );
        $queue_table = $wpdb->prefix . FHUB_RANDOM_QUEUE_TABLE;
        $res_table   = $wpdb->prefix . FHUB_RANDOM_RESULTS_TABLE;

        $queue_row = $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM {$queue_table} WHERE queue_id = %s",
            $queue_id
        ), ARRAY_A );

        if ( ! $queue_row ) {
            return new WP_REST_Response( array(
                'success' => false,
                'message' => 'queue_id não encontrado',
            ), 404 );
        }

        $response = array(
            'success'        => true,
            'queue_id'       => $queue_row['queue_id'],
            'status'         => $queue_row['status'],
            'platform'       => $queue_row['platform'],
            'ranges'         => json_decode( $queue_row['ranges'], true ),
            'requested'      => (int) $queue_row['requested_total'],
            'found'          => (int) $queue_row['found_total'],
            'execution_time' => $queue_row['execution_time'],
            'created_at'     => $queue_row['created_at'],
            'processed_at'   => $queue_row['processed_at'],
            'players'        => array(),
        );

        if ( $queue_row['status'] === 'completed' ) {
            $result_rows = $wpdb->get_results( $wpdb->prepare(
                "SELECT * FROM {$res_table} WHERE queue_id = %s ORDER BY id ASC",
                $queue_id
            ), ARRAY_A );

            $response['players'] = array_map(
                array( __CLASS__, 'format_player_row' ),
                $result_rows ?: array()
            );
        }

        if ( $queue_row['status'] === 'failed' && ! empty( $queue_row['error_message'] ) ) {
            $response['error'] = $queue_row['error_message'];
        }

        return new WP_REST_Response( $response, 200 );
    }

// ── GET /fhub/v1/random/draw ─────────────────────────────────
    // Endpoint síncrono: serve jogadores do pool já gravado.
    // Params: platform (ps|pc), count (int), min (int), max (int)
    // Resposta: { success, requested, found, platform, players[] }

    public static function api_get_draw( $request ) {
        global $wpdb;

        $platform = $request->get_param( 'platform' );
        $count    = max( 1, min( 50, (int) $request->get_param( 'count' ) ) );
        $min      = (int) $request->get_param( 'min' );
        $max      = (int) $request->get_param( 'max' );

        if ( ! in_array( $platform, array( 'ps', 'pc' ), true ) ) {
            $platform = 'ps';
        }

        $queue_table = $wpdb->prefix . FHUB_RANDOM_QUEUE_TABLE;
        $res_table   = $wpdb->prefix . FHUB_RANDOM_RESULTS_TABLE;

        // Busca todos os resultados de pedidos completed para a plataforma
        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT r.player_id, r.player_slug, r.player_data, r.price_info
             FROM {$res_table} r
             INNER JOIN {$queue_table} q ON q.queue_id = r.queue_id
             WHERE q.status = 'completed'
               AND q.platform = %s
             ORDER BY RAND()",
            $platform
        ), ARRAY_A );

        if ( empty( $rows ) ) {
            return new WP_REST_Response( array(
                'success'   => false,
                'message'   => 'Pool de jogadores vazio para a plataforma ' . $platform . '. Execute o scraper primeiro.',
                'requested' => $count,
                'found'     => 0,
                'platform'  => $platform,
                'players'   => array(),
            ), 200 );
        }

        // Filtra por faixa de preço em PHP (compatibilidade com MySQL < 5.7)
        $filtered = array();
        foreach ( $rows as $row ) {
            $price_info = $row['price_info'] ? json_decode( $row['price_info'], true ) : null;
            $price_numeric = isset( $price_info['price_numeric'] ) ? (int) $price_info['price_numeric'] : 0;

            // Se min/max não informados, aceita qualquer jogador
            if ( $min > 0 && $max > 0 ) {
                if ( $price_numeric < $min || $price_numeric > $max ) continue;
            }

            $filtered[] = $row;
        }

if ( empty( $filtered ) ) {
            // Fallback: faixa vazia, serve do pool geral da plataforma embaralhado
            error_log( '[FHub][draw] Faixa ' . $min . '-' . $max . ' vazia, usando fallback do pool geral.' );
            shuffle( $rows );
            $selected  = array_slice( $rows, 0, $count );
            $players   = array_map( array( __CLASS__, 'format_player_row' ), $selected );

            return new WP_REST_Response( array(
                'success'   => true,
                'requested' => $count,
                'found'     => count( $players ),
                'platform'  => $platform,
                'range'     => array( 'min' => $min, 'max' => $max ),
                'fallback'  => true,
                'players'   => $players,
            ), 200 );
        }
        

        // Embaralha e pega exatamente $count
        shuffle( $filtered );
        $selected = array_slice( $filtered, 0, $count );

        $players = array_map( array( __CLASS__, 'format_player_row' ), $selected );

        return new WP_REST_Response( array(
            'success'   => true,
            'requested' => $count,
            'found'     => count( $players ),
            'platform'  => $platform,
            'range'     => array( 'min' => $min, 'max' => $max ),
            'players'   => $players,
        ), 200 );
    }

    // ── GET /fhub/v1/random/data ─────────────────────────────────

    public static function api_get_data( $request ) {
        global $wpdb;

        $queue_table = $wpdb->prefix . FHUB_RANDOM_QUEUE_TABLE;
        $res_table   = $wpdb->prefix . FHUB_RANDOM_RESULTS_TABLE;

        $by_status = array();
        foreach ( $wpdb->get_results( "SELECT status, COUNT(*) as count FROM {$queue_table} GROUP BY status", ARRAY_A ) as $row ) {
            $by_status[ $row['status'] ] = (int) $row['count'];
        }

        $recent = $wpdb->get_results(
            "SELECT queue_id, platform, status, requested_total, found_total, execution_time, created_at, processed_at
             FROM {$queue_table}
             ORDER BY created_at DESC
             LIMIT 10",
            ARRAY_A
        );

        return new WP_REST_Response( array(
            'meta'          => FutbinHubCore::get_module_meta( 'random' ),
            'total_requests' => array_sum( $by_status ),
            'by_status'     => $by_status,
            'total_players' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$res_table}" ),
            'recent_queue'  => $recent ?: array(),
        ), 200 );
    }

    // ============================================================
    // HELPERS
    // ============================================================

    private static function generate_queue_id() {
        if ( function_exists( 'wp_generate_uuid4' ) ) {
            return wp_generate_uuid4();
        }
        return sprintf(
            '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
            mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff ),
            mt_rand( 0, 0xffff ),
            mt_rand( 0, 0x0fff ) | 0x4000,
            mt_rand( 0, 0x3fff ) | 0x8000,
            mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff )
        );
    }

    public static function format_player_row( $row ) {
        if ( ! $row ) return null;

        $player_data = $row['player_data'] ? json_decode( $row['player_data'], true ) : array();
        $price_info  = $row['price_info']  ? json_decode( $row['price_info'],  true ) : null;

        return array_merge(
            array(
                'id'         => $row['player_id'],
                'slug'       => $row['player_slug'],
                'price_info' => $price_info,
            ),
            is_array( $player_data ) ? $player_data : array()
        );
    }
}

FutbinHubRandomModule::init();