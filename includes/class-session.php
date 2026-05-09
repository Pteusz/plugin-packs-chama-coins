<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class CC_Packs_Session {

    public static function create( int $user_id, array $composition ): mixed {
        return null;
    }

    public static function get_by_token( string $token ): mixed {
        return null;
    }

    public static function update_status( int $id, string $status ): bool {
        return false;
    }

    public static function get_by_adm( int $adm_id ): array {
        return array();
    }

    public static function calculate_total( array $composition ): float {
        return 0.0;
    }

    private static function generate_token(): string {
        return '';
    }
}
