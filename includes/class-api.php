<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/* endpoints registrados em CC_PACKS_API_NS (cc/v1):
   GET  /packs           → get_packs()        permissão: public
   POST /session         → create_session()   permissão: is_user_logged_in()
   GET  /session/{token} → get_session()      permissão: public (token é o guard)
*/

class CC_Packs_API {

    public static function init(): void {
        add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
    }

    public static function register_routes(): void {
        register_rest_route( CC_PACKS_API_NS, '/packs', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'get_packs' ),
            'permission_callback' => array( __CLASS__, 'public_permission' ),
        ) );
        register_rest_route( CC_PACKS_API_NS, '/packs', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'create_pack' ),
            'permission_callback' => array( __CLASS__, 'admin_permission' ),
        ) );
        register_rest_route( CC_PACKS_API_NS, '/packs/(?P<id>\d+)', array(
            'methods'             => 'PUT',
            'callback'            => array( __CLASS__, 'update_pack' ),
            'permission_callback' => array( __CLASS__, 'admin_permission' ),
        ) );
        register_rest_route( CC_PACKS_API_NS, '/packs/(?P<id>\d+)', array(
            'methods'             => 'DELETE',
            'callback'            => array( __CLASS__, 'delete_pack' ),
            'permission_callback' => array( __CLASS__, 'admin_permission' ),
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
    }

    public static function get_packs( object $request ): object {
        $packs = CC_Packs_CRUD::get_all();
        return new WP_REST_Response( [ 'data' => $packs ], 200 );
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
        $id   = intval( $request->get_param( 'id' ) );
        $body = $request->get_json_params();
        $ok   = CC_Packs_CRUD::update( $id, $body );
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
        $user_id     = get_current_user_id();
        $composition = [];
        foreach ( $body['composition'] as $item ) {
            $pid = intval( $item['pack_id'] ?? $item[0] ?? 0 );
            $qty = intval( $item['qty'] ?? $item[1] ?? 1 );
            if ( $pid > 0 ) $composition[ $pid ] = ( $composition[ $pid ] ?? 0 ) + $qty;
        }
        $token = CC_Packs_Session::create( $user_id, $composition );
        if ( ! $token ) return new WP_REST_Response( [ 'error' => 'Erro ao criar sessão' ], 500 );
        $redirect = add_query_arg( 'token', $token, CC_PACKS_FORM_BASE_URL );
        return new WP_REST_Response( [ 'token' => $token, 'redirect' => $redirect ], 201 );
    }

    public static function get_session( object $request ): object {
        $token   = sanitize_text_field( $request->get_param( 'token' ) );
        $session = CC_Packs_Session::get_by_token( $token );
        if ( ! $session ) return new WP_REST_Response( [ 'error' => 'Sessão não encontrada' ], 404 );
        return new WP_REST_Response( [ 'data' => $session ], 200 );
    }

    public static function update_session_status( object $request ): object {
        $id     = intval( $request->get_param( 'id' ) );
        $body   = $request->get_json_params();
        $status = sanitize_text_field( $body['status'] ?? '' );
        $ok     = CC_Packs_Session::update_status( $id, $status );
        return new WP_REST_Response( [ 'success' => $ok ], $ok ? 200 : 400 );
    }

    public static function admin_permission( object $request ): bool {
        return current_user_can( 'manage_options' );
    }

    public static function public_permission( object $request ): bool {
        return true;
    }
}
