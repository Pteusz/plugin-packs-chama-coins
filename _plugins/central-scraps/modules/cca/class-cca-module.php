<?php
if ( ! defined( 'ABSPATH' ) ) exit;

require_once dirname( __FILE__ ) . '/cca-config.php';

/**
 * FutbinHubCcaModule
 *
 * Coleta Correspondentes Caixa (CCAs) do site da Caixa Econômica Federal.
 * Tabela: fhub_cca | Namespace REST: fhub/v1/cca | Cache: fhub_cca_cache_v1
 *
 * Campos coletados:
 *   nome, endereco, bairro, cidade, uf, cep, telefone, latitude, longitude
 */
class FutbinHubCcaModule {

    public static function init() {
        self::create_table();

        FutbinHubRegistry::register( array(
            'id'          => 'cca',
            'label'       => 'CCA Scraper',
            'description' => 'Coleta Correspondentes Caixa (CCAs) de todos os estados do Brasil',
            'version'     => FHUB_CCA_VERSION,
            'js_object'   => 'CcaScraper',
            'js_handle'   => 'fhub-module-cca',
            'js_path'     => FHUB_DIR . 'modules/cca/cca-scraper.js',
            'ajax_action' => 'fhub_cca_save',
            'api_base'    => 'fhub/v1/cca',
            'table'       => FHUB_CCA_TABLE,
            'has_input'   => false,
        ) );

        add_action( 'wp_ajax_fhub_cca_save',        array( __CLASS__, 'ajax_save' ) );
        add_action( 'wp_ajax_nopriv_fhub_cca_save', array( __CLASS__, 'ajax_save' ) );
        add_action( 'wp_ajax_fhub_cca_clear',       array( __CLASS__, 'ajax_clear' ) );
        add_action( 'rest_api_init',                 array( __CLASS__, 'register_rest_routes' ) );
    }

    // ============================================================
    // TABELA fhub_cca
    // ============================================================

    public static function create_table() {
        global $wpdb;

        $table           = $wpdb->prefix . FHUB_CCA_TABLE;
        $charset_collate = $wpdb->get_charset_collate();

        // Nota: sem ON UPDATE CURRENT_TIMESTAMP — dbDelta do WP não suporta essa cláusula.
        // Colunas com espaço único entre tipo e modificador (dbDelta é sensível a isso).
        $sql = "CREATE TABLE IF NOT EXISTS {$table} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            nome varchar(300) NOT NULL DEFAULT '',
            tipo varchar(100) DEFAULT NULL,
            endereco varchar(500) DEFAULT NULL,
            complemento varchar(200) DEFAULT NULL,
            bairro varchar(200) DEFAULT NULL,
            cidade varchar(200) NOT NULL DEFAULT '',
            uf varchar(2) NOT NULL DEFAULT '',
            cep varchar(10) DEFAULT NULL,
            telefone varchar(50) DEFAULT NULL,
            latitude varchar(30) DEFAULT NULL,
            longitude varchar(30) DEFAULT NULL,
            hash varchar(64) NOT NULL DEFAULT '',
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            updated_at datetime DEFAULT '0000-00-00 00:00:00',
            PRIMARY KEY  (id),
            UNIQUE KEY idx_hash (hash),
            KEY idx_uf (uf),
            KEY idx_cidade (cidade),
            KEY idx_created (created_at)
        ) {$charset_collate};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta( $sql );
    }

    // ============================================================
    // AJAX: salvar batch
    // ============================================================

    public static function ajax_save() {
        $raw     = file_get_contents( 'php://input' );
        $request = json_decode( $raw, true );

        // Nonce check (soft — não bloqueia, apenas loga)
        $nonce = sanitize_text_field( $request['nonce'] ?? '' );
        if ( ! wp_verify_nonce( $nonce, 'fhub_nonce' ) ) {
            error_log( 'FutbinHub CCA: nonce inválido.' );
        }

        $items    = $request['items']    ?? array();
        $meta     = $request['meta']     ?? array();
        $is_final = $request['is_final'] ?? false;

        global $wpdb;
        $table = $wpdb->prefix . FHUB_CCA_TABLE;

        $inserted = 0;
        $updated  = 0;
        $errors   = 0;

        foreach ( $items as $item ) {
            $nome   = FutbinHubCore::sanitize_varchar( $item['nome']   ?? '', 300 );
            $cidade = FutbinHubCore::sanitize_varchar( $item['cidade'] ?? '', 200 );
            $uf     = strtoupper( substr( sanitize_text_field( $item['uf'] ?? '' ), 0, 2 ) );

            if ( empty( $nome ) || empty( $cidade ) || empty( $uf ) ) {
                $errors++;
                continue;
            }

            $data = array(
                'nome'        => $nome,
                'tipo'        => FutbinHubCore::sanitize_varchar( $item['tipo']        ?? '', 100 ),
                'endereco'    => FutbinHubCore::sanitize_varchar( $item['endereco']    ?? '', 500 ),
                'complemento' => FutbinHubCore::sanitize_varchar( $item['complemento'] ?? '', 200 ),
                'bairro'      => FutbinHubCore::sanitize_varchar( $item['bairro']      ?? '', 200 ),
                'cidade'      => $cidade,
                'uf'          => $uf,
                'cep'         => FutbinHubCore::sanitize_varchar( $item['cep']         ?? '', 10 ),
                'telefone'    => FutbinHubCore::sanitize_varchar( $item['telefone']    ?? '', 50 ),
                'latitude'    => FutbinHubCore::sanitize_varchar( $item['latitude']    ?? '', 30 ),
                'longitude'   => FutbinHubCore::sanitize_varchar( $item['longitude']   ?? '', 30 ),
                'hash'        => sanitize_text_field( $item['hash'] ?? '' ),
            );

            // Tenta inserir; em duplicata (hash), atualiza campos variáveis
            $existing = $wpdb->get_var( $wpdb->prepare(
                "SELECT id FROM {$table} WHERE hash = %s LIMIT 1",
                $data['hash']
            ) );

            if ( $existing ) {
                $wpdb->update( $table, $data, array( 'id' => $existing ) );
                $updated++;
            } else {
                $result = $wpdb->insert( $table, $data );
                if ( $result ) {
                    $inserted++;
                } else {
                    $errors++;
                }
            }
        }

        if ( $is_final ) {
            FutbinHubCore::set_module_meta( 'cca', array(
                'timestamp'   => $meta['timestamp'] ?? gmdate( 'c' ),
                'status'      => 'completed',
                'total_items' => $meta['total'] ?? 0,
            ) );
            delete_transient( FHUB_CCA_CACHE_KEY );
        }

        wp_send_json_success( array(
            'inserted' => $inserted,
            'updated'  => $updated,
            'errors'   => $errors,
        ) );
    }

    // ============================================================
    // AJAX: limpar tabela
    // ============================================================

    public static function ajax_clear() {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_send_json_error( array( 'message' => 'Permissão negada' ) );
            return;
        }
        check_ajax_referer( 'fhub_nonce', 'nonce' );

        global $wpdb;
        $wpdb->query( 'TRUNCATE TABLE ' . $wpdb->prefix . FHUB_CCA_TABLE );
        delete_transient( FHUB_CCA_CACHE_KEY );

        FutbinHubCore::set_module_meta( 'cca', array(
            'timestamp'   => gmdate( 'c' ),
            'status'      => 'cleared',
            'total_items' => 0,
        ) );

        wp_send_json_success( array( 'message' => 'Dados limpos com sucesso.' ) );
    }

    // ============================================================
    // REST API
    // ============================================================

    public static function register_rest_routes() {
        register_rest_route( 'fhub/v1', '/cca/data', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'api_get_data' ),
            'permission_callback' => '__return_true',
        ) );
        register_rest_route( 'fhub/v1', '/cca/stats', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'api_get_stats' ),
            'permission_callback' => '__return_true',
        ) );
    }

    public static function api_get_data( $request ) {
        global $wpdb;

        $cached = get_transient( FHUB_CCA_CACHE_KEY );
        if ( $cached !== false ) {
            return new WP_REST_Response( $cached, 200 );
        }

        $table = $wpdb->prefix . FHUB_CCA_TABLE;

        // Filtros opcionais via query string: ?uf=RJ&cidade=Rio+de+Janeiro
        $where  = '1=1';
        $values = array();

        if ( ! empty( $request['uf'] ) ) {
            $where   .= ' AND uf = %s';
            $values[] = strtoupper( sanitize_text_field( $request['uf'] ) );
        }
        if ( ! empty( $request['cidade'] ) ) {
            $where   .= ' AND cidade LIKE %s';
            $values[] = '%' . $wpdb->esc_like( sanitize_text_field( $request['cidade'] ) ) . '%';
        }

        $sql  = "SELECT * FROM {$table} WHERE {$where} ORDER BY uf, cidade, nome ASC";
        $rows = empty( $values )
            ? $wpdb->get_results( $sql, ARRAY_A )
            : $wpdb->get_results( $wpdb->prepare( $sql, ...$values ), ARRAY_A );

        $data = array_map( array( __CLASS__, 'format_item' ), $rows );
        $body = array(
            'meta' => FutbinHubCore::get_module_meta( 'cca' ),
            'data' => $data,
        );

        // Só cacheia se não tiver filtros
        if ( empty( $request['uf'] ) && empty( $request['cidade'] ) ) {
            set_transient( FHUB_CCA_CACHE_KEY, $body, 5 * MINUTE_IN_SECONDS );
        }

        return new WP_REST_Response( $body, 200 );
    }

    public static function api_get_stats( $request ) {
        global $wpdb;
        $table = $wpdb->prefix . FHUB_CCA_TABLE;
        return new WP_REST_Response( array(
            'meta'       => FutbinHubCore::get_module_meta( 'cca' ),
            'total'      => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" ),
            'total_ufs'  => (int) $wpdb->get_var( "SELECT COUNT(DISTINCT uf) FROM {$table}" ),
            'por_uf'     => $wpdb->get_results(
                "SELECT uf, COUNT(*) as total FROM {$table} GROUP BY uf ORDER BY uf",
                ARRAY_A
            ),
        ), 200 );
    }

    public static function format_item( $row ) {
        if ( ! $row ) return null;
        return array(
            'id'         => (int) $row['id'],
            'nome'       => $row['nome'],
            'tipo'       => $row['tipo'],
            'endereco'   => $row['endereco'],
            'complemento'=> $row['complemento'],
            'bairro'     => $row['bairro'],
            'cidade'     => $row['cidade'],
            'uf'         => $row['uf'],
            'cep'        => $row['cep'],
            'telefone'   => $row['telefone'],
            'latitude'   => $row['latitude'],
            'longitude'  => $row['longitude'],
            'hash'       => $row['hash'],
            'created_at' => $row['created_at'],
        );
    }
}

// Auto-init
FutbinHubCcaModule::init();
