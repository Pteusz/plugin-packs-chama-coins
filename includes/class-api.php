<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class CC_Packs_API {

    public static function init(): void {}

    public static function register_routes(): void {}

    public static function get_packs( object $request ): object {
        return new stdClass();
    }

    public static function create_session( object $request ): object {
        return new stdClass();
    }

    public static function admin_permission( object $request ): bool {
        return false;
    }

    public static function public_permission( object $request ): bool {
        return false;
    }
}
