<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class CC_Packs_CRUD {

    public static function create( array $data ): mixed {
        return null;
    }

    public static function update( int $id, array $data ): bool {
        return false;
    }

    public static function delete( int $id ): bool {
        return false;
    }

    public static function get( int $id ): mixed {
        return null;
    }

    public static function get_all(): array {
        return array();
    }

    public static function get_by_adm( int $adm_id ): array {
        return array();
    }
}
