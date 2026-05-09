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

            <header class="cc-store-hero">
                <div class="cc-store-hero-inner">
                    <span class="cc-store-hero-tag">Promoções DME</span>
                    <h2 class="cc-store-hero-title">Complete seus SBCs com os melhores jogadores</h2>
                    <p class="cc-store-hero-desc">
                        Cada pack contém jogadores selecionados para Squad Building Challenges específicos.
                        Adicione ao carrinho, finalize o pedido e receba os jogadores direto na sua conta FC —
                        sem complicação.
                    </p>
                    <div class="cc-store-hero-steps">
                        <div class="cc-store-step">
                            <span class="cc-store-step-num">1</span>
                            <span>Escolha o pack</span>
                        </div>
                        <div class="cc-store-step-sep">→</div>
                        <div class="cc-store-step">
                            <span class="cc-store-step-num">2</span>
                            <span>Finalize o pedido</span>
                        </div>
                        <div class="cc-store-step-sep">→</div>
                        <div class="cc-store-step">
                            <span class="cc-store-step-num">3</span>
                            <span>Receba na conta</span>
                        </div>
                    </div>
                </div>
            </header>

            <div id="cc-store-grid"></div>

            <div id="cc-store-bar" style="display:none">
                <div id="cc-bar-summary"></div>
                <button id="cc-bar-checkout">Finalizar Pedido</button>
            </div>

        </div>
        <?php
        return ob_get_clean();
    }

    public function enqueue_assets(): void {
        global $post;
        if ( ! is_a( $post, 'WP_Post' ) ) return;
        if ( ! has_shortcode( $post->post_content, 'cc_packs_store' ) ) return;

        wp_enqueue_style( 'cc-packs', CC_PACKS_URL . 'assets/style.css', [], CC_PACKS_VERSION );
        wp_enqueue_script(
            'cc-packs-store',
            CC_PACKS_URL . 'public/store.js',
            [ 'jquery' ],
            CC_PACKS_VERSION,
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
