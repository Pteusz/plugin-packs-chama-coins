<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/* shape composition (JSON armazenado):
   { "<pack_id>": <qty_int>, ... }
   Exemplo: { "3": 2, "7": 1 }
   calculate_total() itera esse shape, busca price de cada pack_id em wp_cc_packs e soma price * qty.
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

    public static function get_by_adm( int $adm_id ): array {
        global $wpdb;
        $st   = $wpdb->prefix . CC_PACKS_SESSIONS_TABLE;
        $pt   = $wpdb->prefix . CC_PACKS_TABLE;
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT DISTINCT s.* FROM {$st} s
                 JOIN {$pt} p ON JSON_CONTAINS(s.composition, CAST(p.id AS JSON), '$')
                 WHERE p.adm_id = %d
                 ORDER BY s.created_at DESC",
                $adm_id
            ),
            ARRAY_A
        ) ?: [];
        return array_map( function ( $r ) {
            $r['composition'] = json_decode( $r['composition'], true ) ?: [];
            return $r;
        }, $rows );
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
