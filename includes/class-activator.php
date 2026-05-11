<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class CC_Packs_Activator {

    public static function activate(): void {
        self::create_tables();
        self::maybe_migrate();
        self::register_wc_product();
    }

    private static function create_tables(): void {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        $t1 = $wpdb->prefix . CC_PACKS_TABLE;
        $t2 = $wpdb->prefix . CC_PACKS_SESSIONS_TABLE;
        $sql1 = "CREATE TABLE IF NOT EXISTS {$t1} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL,
            price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            dme_ids JSON NOT NULL,
            coins_amount   BIGINT UNSIGNED NOT NULL DEFAULT 0,
            coins_platform VARCHAR(10)     NOT NULL DEFAULT 'ps',
            adm_id INT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_adm (adm_id)
        ) {$charset};";
        $sql2 = "CREATE TABLE IF NOT EXISTS {$t2} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            token VARCHAR(64) NOT NULL,
            user_id INT UNSIGNED NOT NULL,
            composition JSON NOT NULL,
            total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY idx_token (token),
            KEY idx_user (user_id),
            KEY idx_status (status)
        ) {$charset};";
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta( $sql1 );
        dbDelta( $sql2 );
    }

    private static function maybe_migrate(): void {
        global $wpdb;
        $table = $wpdb->prefix . CC_PACKS_TABLE;
        $cols  = $wpdb->get_col( "SHOW COLUMNS FROM {$table}" );
        if ( ! in_array( 'coins_amount', $cols, true ) ) {
            $wpdb->query( "ALTER TABLE {$table} ADD COLUMN coins_amount BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER dme_ids" );
        }
        if ( ! in_array( 'coins_platform', $cols, true ) ) {
            $wpdb->query( "ALTER TABLE {$table} ADD COLUMN coins_platform VARCHAR(10) NOT NULL DEFAULT 'ps' AFTER coins_amount" );
        }
    }

    public static function register_wc_product(): void {
        $product_id = get_option( CC_PACKS_PRODUCT_OPTION, 0 );
        if ( $product_id && get_post_status( $product_id ) === 'publish' ) return;
        $product = new WC_Product_Simple();
        $product->set_name( 'Packs' );
        $product->set_status( 'publish' );
        $product->set_catalog_visibility( 'hidden' );
        $product->set_price( 1 );
        $product->set_regular_price( 1 );
        $product->set_virtual( true );
        $product->set_sold_individually( false );
        $id = $product->save();
        update_option( CC_PACKS_PRODUCT_OPTION, $id );
    }
}
