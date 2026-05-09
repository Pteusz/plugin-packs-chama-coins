<?php
if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * FutbinHubCore
 *
 * Responsabilidades:
 *  - Criação / atualização da tabela fhub_meta (metadados globais do Hub)
 *  - Helpers de sanitização reutilizáveis por todos os módulos
 *  - Gravação e leitura de metadados por módulo
 */
class FutbinHubCore {

    // --------------------------------------------------------
    // ATIVAÇÃO DO PLUGIN
    // --------------------------------------------------------

    public static function activate() {
        self::create_meta_table();
        error_log( 'FutbinHub: ativado — v' . FHUB_VERSION );
    }

    // --------------------------------------------------------
    // TABELA fhub_meta
    // Armazena metadados de execução de cada módulo:
    //   meta_key  = 'last_run_{module_id}'
    //   meta_value = JSON { timestamp, status, total_items, ... }
    // --------------------------------------------------------

    public static function create_meta_table() {
        global $wpdb;

        $table           = $wpdb->prefix . FHUB_META_TABLE;
        $charset_collate = $wpdb->get_charset_collate();

        $sql = "CREATE TABLE IF NOT EXISTS {$table} (
            id         bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            meta_key   varchar(100)        NOT NULL,
            meta_value longtext            NOT NULL,
            updated_at datetime            DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY idx_meta_key (meta_key)
        ) {$charset_collate};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta( $sql );
    }

    // --------------------------------------------------------
    // METADADOS: GRAVAÇÃO
    // --------------------------------------------------------

    /**
     * Salva ou atualiza um metadado de módulo.
     *
     * @param string $module_id  ID do módulo (ex: 'sbc')
     * @param array  $data       Dados a persistir
     */
    public static function set_module_meta( $module_id, array $data ) {
        global $wpdb;

        $table = $wpdb->prefix . FHUB_META_TABLE;
        $key   = 'last_run_' . sanitize_key( $module_id );

        $wpdb->replace(
            $table,
            array(
                'meta_key'   => $key,
                'meta_value' => wp_json_encode( $data ),
            ),
            array( '%s', '%s' )
        );
    }

    // --------------------------------------------------------
    // METADADOS: LEITURA
    // --------------------------------------------------------

    /**
     * Retorna metadados de um módulo ou null se inexistente.
     *
     * @param string $module_id
     * @return array|null
     */
    public static function get_module_meta( $module_id ) {
        global $wpdb;

        $table = $wpdb->prefix . FHUB_META_TABLE;
        $key   = 'last_run_' . sanitize_key( $module_id );

        $raw = $wpdb->get_var( $wpdb->prepare(
            "SELECT meta_value FROM {$table} WHERE meta_key = %s",
            $key
        ) );

        return $raw ? json_decode( $raw, true ) : null;
    }

    // ============================================================
    // HELPERS DE SANITIZAÇÃO (disponíveis a todos os módulos)
    // ============================================================

    /**
     * Sanitiza um campo de preço.
     * Regras: máx 30 chars, precisa ter dígito, sem caracteres especiais.
     *
     * @param mixed  $value
     * @param int    $maxlen
     * @return string|null
     */
    public static function sanitize_price( $value, $maxlen = 50 ) {
        if ( $value === null || $value === '' ) return null;

        $str = (string) $value;
        if ( strlen( $str ) > 30 ) return null;
        if ( preg_match( '/[<>{}\[\]\\\\;]/', $str ) ) return null;
        if ( ! preg_match( '/\d/', $str ) ) return null;

        return substr( trim( $str ), 0, $maxlen );
    }

    /**
     * Sanitiza um campo varchar genérico.
     *
     * @param mixed  $value
     * @param int    $maxlen
     * @return string|null
     */
    public static function sanitize_varchar( $value, $maxlen = 255 ) {
        if ( $value === null || $value === '' ) return null;
        return substr( trim( (string) $value ), 0, $maxlen );
    }

    /**
     * Normaliza um nome: colapsa espaços múltiplos, trim.
     *
     * @param mixed  $value
     * @param int    $maxlen
     * @return string|null
     */
    public static function normalize_name( $value, $maxlen = 300 ) {
        if ( $value === null || $value === '' ) return null;

        $str = preg_replace( '/\s+/', ' ', (string) $value );
        $str = trim( $str );

        return $str !== '' ? substr( $str, 0, $maxlen ) : null;
    }

    /**
     * Encode JSON padronizado para armazenamento.
     *
     * @param mixed $value
     * @return string|null
     */
    public static function json_encode_safe( $value ) {
        if ( empty( $value ) ) return null;
        $encoded = wp_json_encode( $value, JSON_UNESCAPED_UNICODE );
        return $encoded !== false ? $encoded : null;
    }
}
