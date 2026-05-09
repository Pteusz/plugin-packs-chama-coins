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
            <div id="cc-store-grid" class="cc-packs-store"></div>
            <div id="cc-store-bar" class="cc-store-bar" style="display:none">
                <div id="cc-bar-summary"></div>
                <button id="cc-bar-checkout" class="button">Concluir Compra</button>
            </div>
        </div>
        <?php
        return ob_get_clean();
    }

    private function render_pack_card( array $pack ): string {
        $price = number_format( floatval( $pack['price'] ), 2, ',', '.' );
        $id    = intval( $pack['id'] );
        ob_start();
        ?>
        <div class="cc-pack-card" data-pack-id="<?php echo esc_attr( $id ); ?>" data-price="<?php echo esc_attr( $pack['price'] ); ?>">
            <h3><?php echo esc_html( $pack['name'] ); ?></h3>
            <p class="cc-pack-price">R$ <?php echo esc_html( $price ); ?></p>
            <div class="cc-dme-thumbs" data-dme-ids="<?php echo esc_attr( wp_json_encode( $pack['dme_ids'] ?? [] ) ); ?>"></div>
            <button class="cc-view-pack button" data-pack-id="<?php echo esc_attr( $id ); ?>">Ver Pack</button>
            <div class="cc-qty-controls">
                <button class="cc-qty-minus" data-pack-id="<?php echo esc_attr( $id ); ?>">-</button>
                <span class="cc-qty-display" data-pack-id="<?php echo esc_attr( $id ); ?>">0</span>
                <button class="cc-qty-plus" data-pack-id="<?php echo esc_attr( $id ); ?>">+</button>
            </div>
        </div>
        <?php
        return ob_get_clean();
    }

    private function render_dme_preview( array $dme ): string {
        $name = esc_html( $dme['name'] ?? $dme['title'] ?? '' );
        $img  = ! empty( $dme['reward_img'] ) ? '<img src="' . esc_url( $dme['reward_img'] ) . '" style="max-width:80px;display:block;margin-bottom:4px">' : '';
        $id   = esc_attr( $dme['id'] ?? '' );
        return '<div class="cc-dme-preview-item">' . $img . '<span>' . $name . '</span> '
            . '<button class="cc-view-lineups button button-small" data-dme-id="' . $id . '">Ver Elencos</button>'
            . '<div class="cc-lineups-list" data-dme-id="' . $id . '" style="display:none"></div>'
            . '</div>';
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

        // Injeta CSS do fc-card-renderer uma vez no head
        if ( class_exists( 'FC_Card_Visual_Renderer' ) && ! wp_style_is( 'fc-card-renderer-inline', 'done' ) ) {
            add_action( 'wp_head', function () {
                echo FC_Card_Visual_Renderer::get_card_css();
            }, 25 );
            wp_register_style( 'fc-card-renderer-inline', false );
            wp_enqueue_style( 'fc-card-renderer-inline' );
        }
    }
}
