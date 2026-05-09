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
        $mode       = isset( $_GET['cc_mode'] ) && $_GET['cc_mode'] === 'orders' ? 'orders' : 'crud';
        $base_url   = get_permalink();
        $crud_url   = remove_query_arg( 'cc_mode', $base_url );
        $orders_url = add_query_arg( 'cc_mode', 'orders', $base_url );
        $nav = '<nav class="cc-admin-nav">'
            . '<a href="' . esc_url( $crud_url )   . '" class="' . ( $mode === 'crud'   ? 'is-active' : '' ) . '">📦 Packs</a>'
            . '<a href="' . esc_url( $orders_url ) . '" class="' . ( $mode === 'orders' ? 'is-active' : '' ) . '">📋 Pedidos</a>'
            . '</nav>';
        if ( $mode === 'orders' ) return $nav . $this->render_orders_mode();
        return $nav . $this->render_crud_mode();
    }

    private function check_access(): bool {
        return current_user_can( 'manage_options' );
    }

    private function render_crud_mode(): string {
        ob_start();
        ?>
        <div id="cc-packs-admin-crud">

            <!-- Lista de packs como cards (acima do formulário) -->
            <div class="cc-admin-packs-section">
                <h3 class="cc-admin-section-title">Packs criados</h3>
                <div class="cc-admin-packs-carousel-wrap">
                    <div id="cc-packs-list" class="cc-admin-packs-carousel"></div>
                </div>
            </div>

            <!-- Formulário de criação / edição -->
            <div id="cc-pack-form-wrap">
                <h3 class="cc-admin-section-title" id="cc-form-title">Novo Pack</h3>
                <div id="cc-pack-form">
                    <div class="cc-admin-field">
                        <label for="cc-pack-name">Nome do Pack</label>
                        <input type="text" id="cc-pack-name" name="name" required>
                    </div>
                    <div class="cc-admin-field">
                        <label for="cc-pack-price">Preço (R$)</label>
                        <input type="number" id="cc-pack-price" name="price" step="0.01" min="0" required>
                    </div>
                    <div class="cc-admin-field">
                        <label for="cc-dme-search">Buscar DMEs</label>
                        <input type="text" id="cc-dme-search" placeholder="Filtrar por nome...">
                        <span id="cc-selected-count"></span>
                    </div>
                    <div id="cc-dme-list"></div>
                    <div class="cc-admin-form-actions">
                        <button type="button" id="cc-save-pack" class="cc-admin-btn">Salvar Pack</button>
                        <button type="button" id="cc-cancel-edit" class="cc-admin-btn cc-admin-btn-ghost" style="display:none">Cancelar</button>
                    </div>
                </div>
            </div>

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

        $js_path  = CC_PACKS_DIR . 'admin/admin.js';
        $css_path = CC_PACKS_DIR . 'assets/style.css';
        wp_enqueue_script(
            'cc-packs-admin',
            CC_PACKS_URL . 'admin/admin.js',
            [ 'jquery' ],
            file_exists( $js_path )  ? filemtime( $js_path )  : CC_PACKS_VERSION,
            true
        );
        wp_enqueue_style(
            'cc-packs',
            CC_PACKS_URL . 'assets/style.css',
            [],
            file_exists( $css_path ) ? filemtime( $css_path ) : CC_PACKS_VERSION
        );

        if ( class_exists( 'FC_Card_Visual_Renderer' ) && ! wp_style_is( 'fc-card-renderer-inline', 'done' ) ) {
            add_action( 'wp_head', function () {
                echo FC_Card_Visual_Renderer::get_card_css();
            }, 25 );
            wp_register_style( 'fc-card-renderer-inline', false );
            wp_enqueue_style( 'fc-card-renderer-inline' );
        }

        wp_localize_script( 'cc-packs-admin', 'ccPacksAdmin', [
            'apiUrl'  => rest_url( CC_PACKS_API_NS ),
            'nonce'   => wp_create_nonce( 'wp_rest' ),
            'sbcFeed' => home_url( CC_PACKS_SBC_FEED ),
        ] );

        $raw_sessions = CC_Packs_Session::get_all_sessions();

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
