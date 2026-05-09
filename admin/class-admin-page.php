<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class CC_Packs_Admin_Page {

    public function __construct() {}

    public function register_shortcode(): void {}

    public function render( array $atts ): string {
        return '';
    }

    private function check_access(): bool {
        return false;
    }

    private function render_crud_mode(): string {
        return '';
    }

    private function render_orders_mode(): string {
        return '';
    }

    public function enqueue_assets(): void {}
}
