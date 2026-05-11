<?php
/**
 * Patch: suporte ao tipo 'pack' no Formulário Geral
 *
 * Como aplicar:
 *   Copiar o conteúdo da função fg_load_pack_order_by_token() para
 *   formulario-geral-venda-integration.php, logo antes da função fg_load_order_by_token().
 *
 *   Em fg_load_order_by_token(), adicionar 'pack' => 5 ao array $type_priority e
 *   adicionar o bloco abaixo logo após o bloco do BuyNow (item 2):
 *
 *   // Pack
 *   $pack = fg_load_pack_order_by_token($token);
 *   if ($pack && !empty($pack['price'])) {
 *       $candidates[] = $pack;
 *   }
 */

if ( ! defined('ABSPATH') ) exit;

/**
 * Carrega pedido de Pack pelo token.
 * Lê wp_cc_pack_sessions e monta o shape esperado por fg_load_order_by_token().
 */
function fg_load_pack_order_by_token( $token ) {
    global $wpdb;

    $table = $wpdb->prefix . 'cc_pack_sessions';

    if ( ! fg_table_exists( $table ) ) return null;

    $row = $wpdb->get_row(
        $wpdb->prepare(
            "SELECT id, token, user_id, composition, description, total, status, created_at
             FROM {$table}
             WHERE token = %s
             LIMIT 1",
            $token
        ),
        ARRAY_A
    );

    if ( ! $row ) return null;

    $total = floatval( $row['total'] ?? 0 );
    if ( $total <= 0 ) return null;

    $composition = json_decode( $row['composition'] ?? '{}', true );
    if ( ! is_array( $composition ) ) $composition = [];

    $stored_desc = isset( $row['description'] ) ? trim( (string) $row['description'] ) : '';
    if ( $stored_desc !== '' ) {
        $desc = $stored_desc;
    } else {
        $parts = [];
        $packs_table = $wpdb->prefix . 'cc_packs';
        foreach ( $composition as $pack_id => $qty ) {
            $pack = $wpdb->get_row(
                $wpdb->prepare( "SELECT name FROM {$packs_table} WHERE id = %d", intval( $pack_id ) ),
                ARRAY_A
            );
            $name = $pack ? fg_sline( $pack['name'] ) : "Pack #{$pack_id}";
            $parts[] = "{$name} x{$qty}";
        }
        $desc = $parts ? implode( ', ', $parts ) : 'Packs selecionados';
    }

    $product_id = intval( get_option( 'cc_packs_product_id', 0 ) );
    if ( ! $product_id ) $product_id = intval( get_option( 'cc_packs_wc_product_id', 0 ) );

    $ts = strtotime( $row['created_at'] ?: 'now' );

    return [
        'type'         => 'pack',
        'price'        => $total,
        'product_id'   => $product_id,
        'display_name' => 'Packs Chama Coins',
        'desc'         => $desc,
        'elencos_str'  => null,
        'ts'           => $ts,
    ];
}
