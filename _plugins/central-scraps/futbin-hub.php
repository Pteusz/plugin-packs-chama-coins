<?php
/**
 * Plugin Name: Futbin Hub
 * Description: Painel centralizado de scrapers Futbin — isolado do plugin legado
 * Version:     1.0.5
 * Author:      ChamaCoins
 *
 * Namespace REST : fhub/v1          (legado usa futbin/v1)
 * Tabela principal: fhub_sbcs       (legado usa futbin_sbcs)
 * Tabela meta     : fhub_meta       (legado usa futbin_meta)
 * Shortcode       : [futbin_hub]    (legado usa [futbin_scraper_v3])
 */

if ( ! defined( 'ABSPATH' ) ) exit;

// ============================================================
// CONSTANTES GLOBAIS DO HUB
// ============================================================

define( 'FHUB_VERSION',    '1.0.5' );
define( 'FHUB_FILE',       __FILE__ );
define( 'FHUB_DIR',        plugin_dir_path( __FILE__ ) );
define( 'FHUB_URL',        plugin_dir_url( __FILE__ ) );
define( 'FHUB_META_TABLE', 'fhub_meta' );

// ============================================================
// INCLUDES
// ============================================================

require_once FHUB_DIR . 'includes/class-hub-core.php';
require_once FHUB_DIR . 'includes/class-hub-registry.php';
require_once FHUB_DIR . 'includes/class-hub-api.php';
require_once FHUB_DIR . 'admin/hub-panel.php';

// ============================================================
// ATIVAÇÃO
// ============================================================

register_activation_hook( __FILE__, array( 'FutbinHubCore', 'activate' ) );

// ============================================================
// INIT — carrega módulos e inicializa componentes
// ============================================================

add_action( 'plugins_loaded', 'fhub_init' );

function fhub_init() {
    // Carrega módulos registrados
    $modules_dir = FHUB_DIR . 'modules/';
    if ( is_dir( $modules_dir ) ) {
        foreach ( glob( $modules_dir . '*/class-*-module.php' ) as $module_file ) {
            require_once $module_file;
        }
    }

    // Inicializa API REST do Hub
    FutbinHubApi::init();

    // Inicializa painel admin
    FutbinHubPanel::init();
}

// ============================================================
// ADMIN MENU
// ============================================================

add_action( 'admin_menu', 'fhub_admin_menu' );

function fhub_admin_menu() {
    add_menu_page(
        'Futbin Hub',
        'Futbin Hub',
        'manage_options',
        'futbin-hub',
        'fhub_admin_page',
        'dashicons-networking',
        30
    );
}

function fhub_admin_page() {
    global $wpdb;

    $meta_table = $wpdb->prefix . FHUB_META_TABLE;
    $modules    = FutbinHubRegistry::getAll();

    ?>
    <div class="wrap">
        <h1>🌐 Futbin Hub <span style="font-size:14px; color:#999; font-weight:normal;">v<?php echo FHUB_VERSION; ?></span></h1>

        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px,1fr)); gap:20px; margin-top:20px;">
            <?php foreach ( $modules as $module ) :
                $last_raw  = $wpdb->get_var( $wpdb->prepare(
                    "SELECT meta_value FROM {$wpdb->prefix}{$meta_table} WHERE meta_key = %s",
                    'last_run_' . $module['id']
                ) );
                $last      = $last_raw ? json_decode( $last_raw, true ) : null;
                $status    = $last['status']      ?? 'Nunca executado';
                $total     = $last['total_items'] ?? 0;
                $timestamp = $last['timestamp']   ?? null;
            ?>
            <div class="card" style="padding:20px;">
                <h2 style="margin-top:0;"><?php echo esc_html( $module['label'] ); ?></h2>
                <p style="color:#666; font-size:13px;"><?php echo esc_html( $module['description'] ); ?></p>
                <table class="widefat" style="font-size:13px;">
                    <tr><td><strong>Versão:</strong></td><td><?php echo esc_html( $module['version'] ); ?></td></tr>
                    <tr><td><strong>Tabela:</strong></td><td><code><?php echo esc_html( $wpdb->prefix . $module['table'] ); ?></code></td></tr>
                    <tr><td><strong>API:</strong></td><td><code><?php echo esc_html( $module['api_base'] ); ?></code></td></tr>
                    <tr><td><strong>Total itens:</strong></td><td><?php echo intval( $total ); ?></td></tr>
                    <tr><td><strong>Status:</strong></td><td><?php echo esc_html( $status ); ?></td></tr>
                    <?php if ( $timestamp ) : ?>
                    <tr><td><strong>Última execução:</strong></td><td><?php echo esc_html( date( 'd/m/Y H:i', strtotime( $timestamp ) ) ); ?></td></tr>
                    <?php endif; ?>
                </table>
            </div>
            <?php endforeach; ?>

            <?php if ( empty( $modules ) ) : ?>
            <div class="card" style="padding:20px; color:#999;">
                <p>Nenhum módulo registrado ainda.</p>
            </div>
            <?php endif; ?>
        </div>

        <div class="card" style="max-width:800px; margin-top:20px; padding:20px;">
            <h2>🔌 API do Hub</h2>
            <ul style="font-family:monospace; font-size:13px; line-height:2;">
                <li><strong>Status geral:</strong> <code>GET <?php echo home_url( '/wp-json/fhub/v1/status' ); ?></code></li>
                <?php foreach ( $modules as $module ) : ?>
                <li><strong><?php echo esc_html( $module['label'] ); ?>:</strong>
                    <code>GET <?php echo home_url( '/wp-json/' . $module['api_base'] . '/data' ); ?></code>
                </li>
                <?php endforeach; ?>
            </ul>
        </div>
    </div>
    <?php
}
