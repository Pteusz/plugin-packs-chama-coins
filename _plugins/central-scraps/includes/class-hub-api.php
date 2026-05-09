<?php
if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * FutbinHubApi
 *
 * Endpoints REST do Hub (namespace: fhub/v1)
 *
 * GET /wp-json/fhub/v1/status
 *   Retorna status geral do Hub: lista de módulos, total de itens,
 *   última execução de cada módulo.
 *
 * Cada módulo registra seus próprios endpoints adicionais
 * dentro do mesmo namespace fhub/v1 — ex: fhub/v1/sbc/data
 */
class FutbinHubApi {

    public static function init() {
        add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
    }

    // --------------------------------------------------------
    // REGISTRO DE ROTAS
    // --------------------------------------------------------

    public static function register_routes() {
        register_rest_route( 'fhub/v1', '/status', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'get_status' ),
            'permission_callback' => '__return_true',
        ) );
    }

    // --------------------------------------------------------
    // CALLBACK: GET /fhub/v1/status
    // --------------------------------------------------------

    public static function get_status() {
        global $wpdb;

        $modules = FutbinHubRegistry::getAll();
        $output  = array();

        foreach ( $modules as $module ) {
            $meta  = FutbinHubCore::get_module_meta( $module['id'] );
            $table = $wpdb->prefix . $module['table'];

            // Conta itens na tabela do módulo (se existir)
            $total = 0;
            $table_exists = $wpdb->get_var( "SHOW TABLES LIKE '{$table}'" );
            if ( $table_exists ) {
                $total = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
            }

            $output[] = array(
                'id'          => $module['id'],
                'label'       => $module['label'],
                'version'     => $module['version'],
                'api_base'    => $module['api_base'],
                'total_items' => $total,
                'last_run'    => $meta,
            );
        }

        return new WP_REST_Response( array(
            'hub_version' => FHUB_VERSION,
            'timestamp'   => gmdate( 'c' ),
            'modules'     => $output,
        ), 200 );
    }
}
