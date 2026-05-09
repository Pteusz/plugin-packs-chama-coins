<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class CC_Packs_Admin_Page {

    public function __construct() {
        $this->register_shortcode();
        add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_assets' ) );
    }

    public function register_shortcode(): void {
        add_shortcode( 'cc_packs_admin', array( $this, 'render' ) );
    }

    public function render( array $atts ): string {
        if ( ! $this->check_access() ) return '';
        $mode = isset( $_GET['cc_mode'] ) && $_GET['cc_mode'] === 'orders' ? 'orders' : 'crud';
        if ( $mode === 'orders' ) return $this->render_orders_mode();
        return $this->render_crud_mode();
    }

    private function check_access(): bool {
        return current_user_can( 'manage_options' );
    }

    private function render_crud_mode(): string {
        ob_start();
        ?>
        <div id="cc-packs-admin-crud">
            <form id="cc-pack-form">
                <p>
                    <label>Nome do Pack<br>
                        <input type="text" id="cc-pack-name" name="name" required style="width:100%;max-width:400px">
                    </label>
                </p>
                <p>
                    <label>Preço (R$)<br>
                        <input type="number" id="cc-pack-price" name="price" step="0.01" min="0" required style="width:160px">
                    </label>
                </p>
                <p>
                    <label>Buscar DMEs<br>
                        <input type="text" id="cc-dme-search" placeholder="Digite para buscar..." style="width:100%;max-width:400px">
                    </label>
                </p>
                <div id="cc-dme-list"></div>
                <p>
                    <button type="submit" class="button button-primary">Salvar Pack</button>
                    <button type="button" id="cc-cancel-edit" class="button" style="display:none;margin-left:8px">Cancelar</button>
                </p>
            </form>
            <hr>
            <div id="cc-packs-list"></div>
        </div>
        <?php
        return ob_get_clean();
    }

    private function render_orders_mode(): string {
        ob_start();
        ?>
        <div id="cc-packs-admin-orders">
            <div id="cc-orders-list"></div>
        </div>
        <?php
        return ob_get_clean();
    }

    public function enqueue_assets(): void {
        global $post;
        if ( ! is_a( $post, 'WP_Post' ) ) return;
        if ( ! has_shortcode( $post->post_content, 'cc_packs_admin' ) ) return;

        wp_enqueue_script(
            'cc-packs-admin',
            CC_PACKS_URL . 'admin/admin.js',
            [ 'jquery' ],
            CC_PACKS_VERSION,
            true
        );

        wp_localize_script( 'cc-packs-admin', 'ccPacksAdmin', [
            'apiUrl'  => rest_url( CC_PACKS_API_NS ),
            'nonce'   => wp_create_nonce( 'wp_rest' ),
            'sbcFeed' => home_url( CC_PACKS_SBC_FEED ),
        ] );

        // Sessões do ADM enriquecidas com dados do comprador
        $raw_sessions = CC_Packs_Session::get_by_adm( get_current_user_id() );

        $sessions = array_map( function( $s ) {
            $uid   = intval( $s['user_id'] );
            $user  = get_userdata( $uid );
            $phone = get_user_meta( $uid, 'billing_phone', true );
            if ( ! $phone ) $phone = get_user_meta( $uid, 'phone', true );

            $s['buyer_name'] = $user ? $user->display_name : 'Usuário #' . $uid;
            $s['phone']      = sanitize_text_field( $phone ?: '' );
            return $s;
        }, $raw_sessions );

        wp_localize_script( 'cc-packs-admin', 'ccPacksAdminSessions', $sessions );
    }
}
