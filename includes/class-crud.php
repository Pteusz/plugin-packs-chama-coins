<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class CC_Packs_CRUD {

    public static function create( array $data ): mixed {
        global $wpdb;
        $table  = $wpdb->prefix . CC_PACKS_TABLE;
        $result = $wpdb->insert(
            $table,
            [
                'name'    => sanitize_text_field( $data['name'] ?? '' ),
                'price'   => floatval( $data['price'] ?? 0 ),
                'dme_ids' => wp_json_encode( $data['dme_ids'] ?? [] ),
                'adm_id'  => intval( $data['adm_id'] ?? get_current_user_id() ),
            ],
            [ '%s', '%f', '%s', '%d' ]
        );
        return $result ? $wpdb->insert_id : false;
    }

    public static function update( int $id, array $data ): bool {
        global $wpdb;
        $table   = $wpdb->prefix . CC_PACKS_TABLE;
        $fields  = [];
        $formats = [];
        if ( isset( $data['name'] ) )    { $fields['name']    = sanitize_text_field( $data['name'] ); $formats[] = '%s'; }
        if ( isset( $data['price'] ) )   { $fields['price']   = floatval( $data['price'] );            $formats[] = '%f'; }
        if ( isset( $data['dme_ids'] ) ) { $fields['dme_ids'] = wp_json_encode( $data['dme_ids'] );    $formats[] = '%s'; }
        if ( empty( $fields ) ) return false;
        return $wpdb->update( $table, $fields, [ 'id' => $id ], $formats, [ '%d' ] ) !== false;
    }

    public static function delete( int $id ): bool {
        global $wpdb;
        return $wpdb->delete( $wpdb->prefix . CC_PACKS_TABLE, [ 'id' => $id ], [ '%d' ] ) !== false;
    }

    public static function get( int $id ): mixed {
        global $wpdb;
        $table = $wpdb->prefix . CC_PACKS_TABLE;
        $row   = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $id ), ARRAY_A );
        if ( ! $row ) return null;
        $row['dme_ids'] = json_decode( $row['dme_ids'], true ) ?: [];
        return $row;
    }

    public static function get_all(): array {
        global $wpdb;
        $table = $wpdb->prefix . CC_PACKS_TABLE;
        $rows  = $wpdb->get_results( "SELECT * FROM {$table} ORDER BY created_at DESC", ARRAY_A ) ?: [];
        return array_map( function ( $r ) {
            $r['dme_ids'] = json_decode( $r['dme_ids'], true ) ?: [];
            return $r;
        }, $rows );
    }

    public static function get_by_adm( int $adm_id ): array {
        global $wpdb;
        $table = $wpdb->prefix . CC_PACKS_TABLE;
        $rows  = $wpdb->get_results(
            $wpdb->prepare( "SELECT * FROM {$table} WHERE adm_id = %d ORDER BY created_at DESC", $adm_id ),
            ARRAY_A
        ) ?: [];
        return array_map( function ( $r ) {
            $r['dme_ids'] = json_decode( $r['dme_ids'], true ) ?: [];
            return $r;
        }, $rows );
    }
}
