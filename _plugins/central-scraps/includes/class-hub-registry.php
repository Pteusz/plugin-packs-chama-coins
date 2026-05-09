<?php
if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * FutbinHubRegistry
 *
 * Registro central de módulos do Hub.
 * Cada módulo chama FutbinHubRegistry::register() no seu bootstrap PHP.
 * O Hub lê FutbinHubRegistry::getAll() para renderizar abas e enfileirar scripts.
 */
class FutbinHubRegistry {

    /** @var array Lista interna de módulos registrados */
    private static $modules = array();

    // --------------------------------------------------------
    // REGISTRO
    // --------------------------------------------------------

    /**
     * Registra um módulo no Hub.
     *
     * @param array $config {
     *   @type string $id           Identificador único (ex: 'sbc')
     *   @type string $label        Nome exibido no painel (ex: 'SBC Scraper')
     *   @type string $description  Descrição curta
     *   @type string $version      Versão do módulo
     *   @type string $js_object    Nome do objeto JS exposto globalmente (ex: 'SbcScraper')
     *   @type string $js_handle    Handle do wp_enqueue_script para o módulo
     *   @type string $js_path      Caminho absoluto do arquivo JS do módulo
     *   @type string $ajax_action  Action AJAX de save do módulo (ex: 'fhub_sbc_save')
     *   @type string $api_base     Base da API REST sem barra inicial (ex: 'fhub/v1/sbc')
     *   @type string $table        Nome da tabela SEM prefixo do WP (ex: 'fhub_sbcs')
     *   @type bool   $has_input    true para módulos interativos com campo de busca
     * }
     */
    public static function register( array $config ) {
        $required = array( 'id', 'label', 'js_object', 'ajax_action', 'api_base', 'table' );

        foreach ( $required as $field ) {
            if ( empty( $config[ $field ] ) ) {
                error_log( "FutbinHub: módulo sem campo obrigatório '{$field}' — registro ignorado." );
                return;
            }
        }

        // Defaults
        $config = array_merge( array(
            'description' => '',
            'version'     => '1.0',
            'has_input'   => false,
            'js_handle'   => 'fhub-module-' . sanitize_key( $config['id'] ),
            'js_path'     => '',
        ), $config );

        $id = sanitize_key( $config['id'] );

        if ( isset( self::$modules[ $id ] ) ) {
            error_log( "FutbinHub: módulo '{$id}' já registrado — ignorando duplicata." );
            return;
        }

        self::$modules[ $id ] = $config;
    }

    // --------------------------------------------------------
    // LEITURA
    // --------------------------------------------------------

    /**
     * Retorna todos os módulos registrados (array indexado).
     *
     * @return array
     */
    public static function getAll() {
        return array_values( self::$modules );
    }

    /**
     * Retorna um módulo específico ou null se não existir.
     *
     * @param string $id
     * @return array|null
     */
    public static function get( $id ) {
        return self::$modules[ sanitize_key( $id ) ] ?? null;
    }

    /**
     * Verifica se um módulo está registrado.
     *
     * @param string $id
     * @return bool
     */
    public static function exists( $id ) {
        return isset( self::$modules[ sanitize_key( $id ) ] );
    }
}
