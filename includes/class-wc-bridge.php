<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class CC_Packs_WC_Bridge {

    public static function init(): void {}

    public static function get_or_create_product(): int {
        return 0;
    }

    public static function get_product_id(): int {
        return 0;
    }

    public static function inject_dynamic_price( object $cart ): void {}

    public static function set_cart_item_name( string $name, array $cart_item, string $key ): string {
        return '';
    }

    public static function set_order_item_meta( object $item, string $key, array $values, object $order ): void {}
}
