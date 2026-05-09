<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class CC_Packs_Store_Page {

    public function __construct() {
        $this->register_shortcode();
        add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_assets' ) );
    }

    public function register_shortcode(): void {
        add_shortcode( 'cc_packs_store', array( $this, 'render' ) );
    }

    public function render( array $atts ): string {
        ob_start();
        ?>
        <div id="cc-packs-store">

            <div class="cc-store-hero">
                <div class="cc-hero-inner">
                    <span class="cc-hero-badge">Promoções DME</span>
                    <h1 class="cc-hero-title">Complete seus SBCs com os<br>melhores jogadores</h1>
                    <p class="cc-hero-desc">Cada pack contém jogadores selecionados para Squad Building Challenges específicos. Adicione ao carrinho, finalize o pedido e receba os jogadores direto na sua conta FC — sem complicação.</p>
                    <div class="cc-hero-steps">
                        <div class="cc-step">
                            <span class="cc-step-num">1</span>
                            <span class="cc-step-label">Escolha o pack</span>
                        </div>
                        <span class="cc-step-arrow">→</span>
                        <div class="cc-step">
                            <span class="cc-step-num">2</span>
                            <span class="cc-step-label">Finalize o pedido</span>
                        </div>
                        <span class="cc-step-arrow">→</span>
                        <div class="cc-step">
                            <span class="cc-step-num">3</span>
                            <span class="cc-step-label">Receba na conta</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="cc-store-section">
                <div class="cc-section-header">
                    <h2 class="cc-section-title">Packs disponíveis</h2>
                    <span class="cc-section-count" id="cc-packs-count"></span>
                </div>
                <div id="cc-store-grid" class="cc-packs-grid"></div>
            </div>

            <div id="cc-store-bar" class="cc-store-bar" style="display:none">
                <div class="cc-bar-left">
                    <svg class="cc-bar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                    <div id="cc-bar-summary">
                        <span class="cc-bar-count-label" id="cc-bar-count-text"></span>
                        <span class="cc-bar-total" id="cc-bar-total-text"></span>
                    </div>
                </div>
                <button id="cc-bar-checkout">Concluir Compra</button>
            </div>

        </div>
        <?php
        return ob_get_clean();
    }

    public function enqueue_assets(): void {
        global $post;
        if ( ! is_a( $post, 'WP_Post' ) ) return;
        if ( ! has_shortcode( $post->post_content, 'cc_packs_store' ) ) return;

        $css_path = CC_PACKS_DIR . 'assets/style.css';
        $js_path  = CC_PACKS_DIR . 'public/store.js';

        wp_enqueue_style(
            'cc-packs',
            CC_PACKS_URL . 'assets/style.css',
            [],
            file_exists( $css_path ) ? filemtime( $css_path ) : CC_PACKS_VERSION
        );

        wp_enqueue_script(
            'cc-packs-store',
            CC_PACKS_URL . 'public/store.js',
            [ 'jquery' ],
            file_exists( $js_path ) ? filemtime( $js_path ) : CC_PACKS_VERSION,
            true
        );

        wp_localize_script( 'cc-packs-store', 'ccPacksStore', [
            'apiUrl'  => rest_url( CC_PACKS_API_NS ),
            'nonce'   => wp_create_nonce( 'wp_rest' ),
            'sbcFeed' => home_url( CC_PACKS_SBC_FEED ),
        ] );

        if ( class_exists( 'FC_Card_Visual_Renderer' ) && ! wp_style_is( 'fc-card-renderer-inline', 'done' ) ) {
            add_action( 'wp_head', function () {
                echo FC_Card_Visual_Renderer::get_card_css();
            }, 25 );
            wp_register_style( 'fc-card-renderer-inline', false );
            wp_enqueue_style( 'fc-card-renderer-inline' );
        }
    }
}
