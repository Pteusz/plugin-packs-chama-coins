<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class CC_Packs_API {

    public static function init(): void {
        add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
    }

    public static function register_routes(): void {
        register_rest_route( CC_PACKS_API_NS, '/packs', array(
            array( 'methods' => 'GET',  'callback' => array( __CLASS__, 'get_packs' ),   'permission_callback' => array( __CLASS__, 'public_permission' ) ),
            array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'create_pack' ), 'permission_callback' => array( __CLASS__, 'admin_permission' ) ),
        ) );
        register_rest_route( CC_PACKS_API_NS, '/packs/(?P<id>\d+)', array(
            array( 'methods' => 'PUT',    'callback' => array( __CLASS__, 'update_pack' ), 'permission_callback' => array( __CLASS__, 'admin_permission' ) ),
            array( 'methods' => 'DELETE', 'callback' => array( __CLASS__, 'delete_pack' ), 'permission_callback' => array( __CLASS__, 'admin_permission' ) ),
        ) );
        register_rest_route( CC_PACKS_API_NS, '/session', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'create_session' ),
            'permission_callback' => array( __CLASS__, 'public_permission' ),
        ) );
        register_rest_route( CC_PACKS_API_NS, '/session/(?P<token>[a-f0-9]+)', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'get_session' ),
            'permission_callback' => array( __CLASS__, 'public_permission' ),
        ) );
        register_rest_route( CC_PACKS_API_NS, '/session/(?P<id>\d+)/status', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'update_session_status' ),
            'permission_callback' => array( __CLASS__, 'admin_permission' ),
        ) );
        // Renderiza cards de DMEs via FC_Card_Visual_Renderer (PHP-only)
        register_rest_route( CC_PACKS_API_NS, '/render-cards', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'render_cards' ),
            'permission_callback' => array( __CLASS__, 'public_permission' ),
        ) );
    }

    public static function get_packs( object $request ): object {
        return new WP_REST_Response( [ 'data' => CC_Packs_CRUD::get_all() ], 200 );
    }

    public static function create_pack( object $request ): object {
        $body = $request->get_json_params();
        if ( empty( $body['name'] ) || ! isset( $body['price'] ) || empty( $body['dme_ids'] ) ) {
            return new WP_REST_Response( [ 'error' => 'name, price e dme_ids são obrigatórios' ], 400 );
        }
        $id = CC_Packs_CRUD::create( [
            'name'    => $body['name'],
            'price'   => $body['price'],
            'dme_ids' => $body['dme_ids'],
            'adm_id'  => get_current_user_id(),
        ] );
        if ( ! $id ) return new WP_REST_Response( [ 'error' => 'Erro ao criar pack' ], 500 );
        return new WP_REST_Response( [ 'id' => $id ], 201 );
    }

    public static function update_pack( object $request ): object {
        $id  = intval( $request->get_param( 'id' ) );
        $ok  = CC_Packs_CRUD::update( $id, $request->get_json_params() );
        return new WP_REST_Response( [ 'success' => $ok ], $ok ? 200 : 500 );
    }

    public static function delete_pack( object $request ): object {
        $id = intval( $request->get_param( 'id' ) );
        $ok = CC_Packs_CRUD::delete( $id );
        return new WP_REST_Response( [ 'success' => $ok ], $ok ? 200 : 500 );
    }

    public static function create_session( object $request ): object {
        $body = $request->get_json_params();
        if ( empty( $body['composition'] ) || ! is_array( $body['composition'] ) ) {
            return new WP_REST_Response( [ 'error' => 'composition é obrigatório' ], 400 );
        }
        $composition = [];
        foreach ( $body['composition'] as $item ) {
            $pid = intval( $item['pack_id'] ?? 0 );
            $qty = intval( $item['qty'] ?? 1 );
            if ( $pid > 0 ) $composition[ $pid ] = ( $composition[ $pid ] ?? 0 ) + $qty;
        }
        $token = CC_Packs_Session::create( get_current_user_id(), $composition );
        if ( ! $token ) return new WP_REST_Response( [ 'error' => 'Erro ao criar sessão' ], 500 );
        return new WP_REST_Response( [ 'token' => $token, 'redirect' => add_query_arg( 'token', $token, CC_PACKS_FORM_BASE_URL ) ], 201 );
    }

    public static function get_session( object $request ): object {
        $session = CC_Packs_Session::get_by_token( sanitize_text_field( $request->get_param( 'token' ) ) );
        if ( ! $session ) return new WP_REST_Response( [ 'error' => 'Sessão não encontrada' ], 404 );
        return new WP_REST_Response( [ 'data' => $session ], 200 );
    }

    public static function update_session_status( object $request ): object {
        $id     = intval( $request->get_param( 'id' ) );
        $status = sanitize_text_field( $request->get_json_params()['status'] ?? '' );
        $ok     = CC_Packs_Session::update_status( $id, $status );
        return new WP_REST_Response( [ 'success' => $ok ], $ok ? 200 : 400 );
    }

    /**
     * POST /cc/v1/render-cards
     * Body: { items: [ { id, is_player, player_details, reward_img, name, challenges } ] }
     * Retorna: { css: string, cards: { "<id>": "<html>" } }
     */
    public static function render_cards( object $request ): object {
        $body  = $request->get_json_params();
        $items = $body['items'] ?? [];

        if ( ! class_exists( 'FC_Card_Visual_Renderer' ) ) {
            return new WP_REST_Response( [ 'error' => 'fc-card-renderer não está ativo' ], 500 );
        }

        $cards = [];
        foreach ( $items as $item ) {
            $id = (string) ( $item['id'] ?? '' );
            if ( ! $id ) continue;

            if ( ! empty( $item['is_player'] ) && ! empty( $item['player_details'] ) ) {
                // Jogador: usa fc_card_get_player (mesmo filtro do CPS_Plugin)
                $normalized = null;
                if ( has_filter( 'fc_card_get_player' ) ) {
                    $normalized = apply_filters( 'fc_card_get_player', null, $item['player_details'], [
                        'default_mode'     => 'lance',
                        'default_platform' => 'ps',
                        'convert_prices'   => true,
                    ] );
                }
                if ( $normalized && empty( $normalized['error'] ) ) {
                    $cards[ $id ] = FC_Card_Visual_Renderer::render_card( $normalized, [
                        'width'           => 220,
                        'show_playstyles' => true,
                        'show_extra_info' => true,
                        'responsive'      => true,
                    ] );
                } else {
                    $cards[ $id ] = self::render_reward_fallback( $item );
                }
            } else {
                // Recompensa: card visual simples
                $cards[ $id ] = self::render_reward_fallback( $item );
            }
        }

        return new WP_REST_Response( [
            'css'   => FC_Card_Visual_Renderer::get_card_css(),
            'cards' => $cards,
        ], 200 );
    }

    private static function render_reward_fallback( array $item ): string {
        $name = esc_html( $item['name'] ?? '' );
        $img  = esc_url( $item['reward_img'] ?? '' );
        $html = '<div class="cc-reward-card">';
        if ( $img ) $html .= '<img src="' . $img . '" alt="' . $name . '">';
        $html .= '<p class="cc-reward-name">' . $name . '</p></div>';
        return $html;
    }

    public static function admin_permission( object $request ): bool {
        return current_user_can( 'manage_options' );
    }

    public static function public_permission( object $request ): bool {
        return true;
    }
}
