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
                'dme_ids'        => wp_json_encode( $data['dme_ids'] ?? [] ),
                'coins_amount'   => intval( $data['coins_amount'] ?? 0 ),
                'coins_platform' => in_array( $data['coins_platform'] ?? '', ['ps','xbox','pc'], true ) ? $data['coins_platform'] : 'ps',
                'adm_id'         => intval( $data['adm_id'] ?? get_current_user_id() ),
            ],
            [ '%s', '%f', '%s', '%d', '%s', '%d' ]
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
        if ( isset( $data['coins_amount'] ) )   { $fields['coins_amount']   = intval( $data['coins_amount'] );                                                                                             $formats[] = '%d'; }
        if ( isset( $data['coins_platform'] ) ) { $fields['coins_platform'] = in_array( $data['coins_platform'], ['ps','xbox','pc'], true ) ? $data['coins_platform'] : 'ps'; $formats[] = '%s'; }
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
        $row['dme_ids']      = json_decode( $row['dme_ids'], true ) ?: [];
        $row['coins_amount']   = intval(  $row['coins_amount']   ?? 0 );
        $row['coins_platform'] = (string)($row['coins_platform'] ?? 'ps');
        return $row;
    }

    public static function get_all(): array {
        global $wpdb;
        $table = $wpdb->prefix . CC_PACKS_TABLE;
        $rows  = $wpdb->get_results( "SELECT * FROM {$table} ORDER BY created_at DESC", ARRAY_A ) ?: [];
        return array_map( function ( $r ) {
            $r['dme_ids']        = json_decode( $r['dme_ids'], true ) ?: [];
            $r['coins_amount']   = intval(  $r['coins_amount']   ?? 0 );
            $r['coins_platform'] = (string)($r['coins_platform'] ?? 'ps');
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
            $r['dme_ids']        = json_decode( $r['dme_ids'], true ) ?: [];
            $r['coins_amount']   = intval(  $r['coins_amount']   ?? 0 );
            $r['coins_platform'] = (string)($r['coins_platform'] ?? 'ps');
            return $r;
        }, $rows );
    }

    public static function get_total_price( array $pack ): float {
        $dme_price    = floatval( $pack['price']        ?? 0 );
        $coins_amount = intval(   $pack['coins_amount'] ?? 0 );
        if ( $coins_amount <= 0 ) return $dme_price;
        $platform    = in_array( $pack['coins_platform'] ?? '', ['ps','xbox','pc'], true ) ? $pack['coins_platform'] : 'ps';
        $coins_price = 0.0;
        if ( class_exists( 'CS_Core' ) ) {
            $calc        = CS_Core::calc( 'lance', $platform, $coins_amount );
            $coins_price = floatval( $calc['price'] ?? 0 );
        }
        return $dme_price + $coins_price;
    }
}
