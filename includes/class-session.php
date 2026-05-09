<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/* shape composition (JSON armazenado):
   { "<pack_id>": <qty_int>, ... }
   Exemplo: { "3": 2, "7": 1 }
*/

class CC_Packs_Session {

    public static function create( int $user_id, array $composition ): mixed {
        global $wpdb;
        $table  = $wpdb->prefix . CC_PACKS_SESSIONS_TABLE;
        $token  = self::generate_token();
        $total  = self::calculate_total( $composition );
        $result = $wpdb->insert(
            $table,
            [
                'token'       => $token,
                'user_id'     => $user_id,
                'composition' => wp_json_encode( $composition ),
                'total'       => $total,
                'status'      => CC_PACKS_STATUS_PENDING,
            ],
            [ '%s', '%d', '%s', '%f', '%s' ]
        );
        return $result ? $token : false;
    }

    public static function get_by_token( string $token ): mixed {
        global $wpdb;
        $table = $wpdb->prefix . CC_PACKS_SESSIONS_TABLE;
        $row   = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE token = %s", $token ), ARRAY_A );
        if ( ! $row ) return null;
        $row['composition'] = json_decode( $row['composition'], true ) ?: [];
        return $row;
    }

    public static function update_status( int $id, string $status ): bool {
        global $wpdb;
        $allowed = [ CC_PACKS_STATUS_PENDING, CC_PACKS_STATUS_APPROVED, CC_PACKS_STATUS_REJECTED ];
        if ( ! in_array( $status, $allowed, true ) ) return false;
        return $wpdb->update(
            $wpdb->prefix . CC_PACKS_SESSIONS_TABLE,
            [ 'status' => $status ],
            [ 'id' => $id ],
            [ '%s' ],
            [ '%d' ]
        ) !== false;
    }

    /**
     * Retorna todas as sessões que contêm ao menos um pack do admin informado.
     * Usa filtragem em PHP para evitar problemas com JSON_CONTAINS no MySQL
     * (a composition é um objeto JSON cujas chaves são os pack_ids — não valores).
     */
    public static function get_by_adm( int $adm_id ): array {
        global $wpdb;
        $pt = $wpdb->prefix . CC_PACKS_TABLE;
        $st = $wpdb->prefix . CC_PACKS_SESSIONS_TABLE;

        // IDs dos packs que pertencem a este admin
        $pack_ids = $wpdb->get_col(
            $wpdb->prepare( "SELECT id FROM {$pt} WHERE adm_id = %d", $adm_id )
        );

        if ( empty( $pack_ids ) ) return [];

        $pack_ids_str = array_map( 'strval', $pack_ids );

        // Todas as sessões (volume geralmente pequeno em contexto B2B)
        $rows = $wpdb->get_results(
            "SELECT * FROM {$st} ORDER BY created_at DESC",
            ARRAY_A
        ) ?: [];

        // Filtra: sessão contém ao menos um pack_id do admin
        $filtered = array_filter( $rows, function ( $row ) use ( $pack_ids_str ) {
            $comp = json_decode( $row['composition'], true );
            if ( ! is_array( $comp ) ) return false;
            foreach ( $pack_ids_str as $pid ) {
                if ( array_key_exists( $pid, $comp ) ) return true;
            }
            return false;
        } );

        return array_values( array_map( function ( $r ) {
            $r['composition'] = json_decode( $r['composition'], true ) ?: [];
            return $r;
        }, $filtered ) );
    }

    public static function calculate_total( array $composition ): float {
        $total = 0.0;
        foreach ( $composition as $pack_id => $qty ) {
            $pack = CC_Packs_CRUD::get( intval( $pack_id ) );
            if ( $pack ) $total += floatval( $pack['price'] ) * intval( $qty );
        }
        return $total;
    }

    private static function generate_token(): string {
        return bin2hex( random_bytes( 16 ) );
    }
}
