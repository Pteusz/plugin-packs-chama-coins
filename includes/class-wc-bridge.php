<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class CC_Packs_WC_Bridge {

    public static function init(): void {
        add_action( 'woocommerce_before_calculate_totals', array( __CLASS__, 'inject_dynamic_price' ), 20 );
        add_filter( 'woocommerce_cart_item_name', array( __CLASS__, 'set_cart_item_name' ), 10, 3 );
        add_action( 'woocommerce_checkout_create_order_line_item', array( __CLASS__, 'set_order_item_meta' ), 10, 4 );
    }

    public static function get_or_create_product(): int {
        $id = self::get_product_id();
        if ( $id && get_post_status( $id ) === 'publish' ) return $id;
        CC_Packs_Activator::register_wc_product();
        return self::get_product_id();
    }

    public static function get_product_id(): int {
        return intval( get_option( CC_PACKS_PRODUCT_OPTION, 0 ) );
    }

    public static function inject_dynamic_price( object $cart ): void {
        if ( is_admin() && ! defined( 'DOING_AJAX' ) ) return;
        foreach ( $cart->get_cart() as $item ) {
            if ( ! empty( $item['cc_pack_price'] ) && $item['data'] instanceof WC_Product ) {
                $item['data']->set_price( floatval( $item['cc_pack_price'] ) );
            }
        }
    }

    public static function set_cart_item_name( string $name, array $cart_item, string $key ): string {
        return ! empty( $cart_item['cc_pack_name'] ) ? esc_html( $cart_item['cc_pack_name'] ) : $name;
    }

    public static function set_order_item_meta( object $item, string $key, array $values, object $order ): void {
        if ( ! empty( $values['cc_pack_name'] ) )  $item->set_name( $values['cc_pack_name'] );
        if ( ! empty( $values['cc_pack_desc'] ) )  $item->add_meta_data( 'Descrição', $values['cc_pack_desc'], true );
        if ( ! empty( $values['cc_pack_token'] ) ) $item->add_meta_data( 'Token', $values['cc_pack_token'], true );
    }
}
