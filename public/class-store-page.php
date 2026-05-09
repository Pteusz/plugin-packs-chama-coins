<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class CC_Packs_Store_Page {

    public function __construct() {}

    public function register_shortcode(): void {}

    public function render( array $atts ): string {
        return '';
    }

    private function render_pack_card( array $pack ): string {
        return '';
    }

    private function render_dme_preview( array $dme ): string {
        return '';
    }

    public function enqueue_assets(): void {}
}
