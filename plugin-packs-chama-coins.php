<?php
/**
 * Plugin Name: Plugin Packs Chama Coins
 * Description: Curadoria e comercialização de packs de DMEs via WooCommerce.
 * Version: 1.0.0
 * Author: Chama Coins
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'CC_PACKS_VERSION', '1.0.0' );
define( 'CC_PACKS_DIR', plugin_dir_path( __FILE__ ) );
define( 'CC_PACKS_URL', plugin_dir_url( __FILE__ ) );
define( 'CC_PACKS_PRODUCT_OPTION', 'cc_packs_product_id' );

require_once CC_PACKS_DIR . 'includes/class-activator.php';
require_once CC_PACKS_DIR . 'includes/class-crud.php';
require_once CC_PACKS_DIR . 'includes/class-session.php';
require_once CC_PACKS_DIR . 'includes/class-wc-bridge.php';
require_once CC_PACKS_DIR . 'includes/class-api.php';
require_once CC_PACKS_DIR . 'admin/class-admin-page.php';
require_once CC_PACKS_DIR . 'public/class-store-page.php';

register_activation_hook( __FILE__, array( 'CC_Packs_Activator', 'activate' ) );

add_action( 'plugins_loaded', 'cc_packs_init' );

function cc_packs_init(): void {
    new CC_Packs_Admin_Page();
    new CC_Packs_Store_Page();
    CC_Packs_WC_Bridge::init();
    CC_Packs_API::init();
}
