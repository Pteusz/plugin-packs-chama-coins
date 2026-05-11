<?php
/*
Plugin Name: Formulário Geral & Venda Integration
Description: Gera o formulário em /formulario-geral/ (e /dme-form para compatibilidade). Ao enviar, salva os dados, busca a compra pelo token nas tabelas oficiais (DME/Sniper/BuyNow/FC Player Shop), adiciona 1 produto base dinâmico (nome/preço) e redireciona ao checkout.
Version: 1.9.5
Author: Mateus Maverick
*/

if ( ! defined('ABSPATH') ) exit;

/** ===========================
 * Constantes / Config
 * =========================== */

if (!defined('FG_BASE_PRODUCT_ID')) define('FG_BASE_PRODUCT_ID', 24);

// DME usa produto próprio (ID 85); demais caem no produto base
if (!defined('FG_DME_PRODUCT_ID'))      define('FG_DME_PRODUCT_ID',      85);
if (!defined('FG_SNIPER_PRODUCT_ID'))   define('FG_SNIPER_PRODUCT_ID',   FG_BASE_PRODUCT_ID);
if (!defined('FG_FCPLAYER_PRODUCT_ID')) define('FG_FCPLAYER_PRODUCT_ID', FG_BASE_PRODUCT_ID);
if (!defined('FG_BUYNOW_PRODUCT_ID'))   define('FG_BUYNOW_PRODUCT_ID',   FG_BASE_PRODUCT_ID);

define('FG_VER', '1.9.5');
define('FG_DIR', plugin_dir_path(__FILE__));
define('FG_URL', plugin_dir_url(__FILE__));
define('FG_EMBED_URL', 'https://www.youtube.com/embed/Jh55LMUecYQ?autoplay=1&rel=0');

/** Helper seguro */
function fg_sline($v){ return trim(wp_strip_all_tags((string)$v)); }

/** Helper: verifica se tabela existe (evita query em tabela ausente) */
function fg_table_exists($table){
    global $wpdb;
    $found = $wpdb->get_var($wpdb->prepare("SHOW TABLES LIKE %s", $table));
    return ($found === $table);
}

/** Helper: limita lista de nomes pra não virar um texto gigante */
function fg_join_names_limited(array $names, $limit = 25){
    $names = array_values(array_filter(array_map('fg_sline', $names)));
    $names = array_values(array_unique($names));
    if (!$names) return '';
    if (count($names) <= $limit) return implode(', ', $names);
    $slice = array_slice($names, 0, $limit);
    $rest  = count($names) - $limit;
    return implode(', ', $slice) . " +{$rest}";
}

/** ===========================
 * DB: tabela cs_user_submissions
 * =========================== */
function fg_create_user_submissions_table() {
    global $wpdb;
    $table   = $wpdb->prefix . 'cs_user_submissions';
    $charset = $wpdb->get_charset_collate();

    $sql = "CREATE TABLE {$table} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      price DECIMAL(18,2) NOT NULL DEFAULT 0,
      modo VARCHAR(16) NOT NULL DEFAULT '',
      token VARCHAR(64) NOT NULL,
      email VARCHAR(255) NOT NULL DEFAULT '',
      senha VARCHAR(255) NOT NULL DEFAULT '',
      backup_codes LONGTEXT NULL,
      backup_photo_url TEXT NULL,
      submission_datetime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY token_idx (token),
      KEY modo_idx (modo)
    ) {$charset};";

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta($sql);
}
register_activation_hook(__FILE__, 'fg_create_user_submissions_table');

/** ===========================
 * Query vars + rewrite (duas rotas: nova e legado)
 * =========================== */
function fg_register_query_vars($vars){
    $vars[] = 'price';
    $vars[] = 'token';
    return $vars;
}
add_filter('query_vars', 'fg_register_query_vars');

function fg_add_rewrite_rules(){
    add_rewrite_rule('^formulario-geral/?$', 'index.php?pagename=formulario-geral', 'top');
    add_rewrite_rule('^dme-form/?$', 'index.php?pagename=dme-form', 'top');
}
add_action('init', 'fg_add_rewrite_rules');

function fg_flush_rewrite_on_activate(){
    fg_register_query_vars(array());
    fg_add_rewrite_rules();
    flush_rewrite_rules();
}
register_activation_hook(__FILE__, 'fg_flush_rewrite_on_activate');


/** ===========================
 * Carregar pedido BuyNow pelo token
 * =========================== */
function fg_load_buynow_order_by_token($token){
    global $wpdb;

    $tBN = $wpdb->prefix . 'cs_buynow_orders';
    if (!fg_table_exists($tBN)) return null;

    $row = $wpdb->get_row(
        $wpdb->prepare(
            "SELECT id, token, mode, platform, valor_k, price_brl, status, created_at, bonus_coins, total_coins, coins, user_id, session_key, promo_code
             FROM {$tBN}
             WHERE token=%s
             ORDER BY created_at DESC
             LIMIT 1",
            $token
        ),
        ARRAY_A
    );

    if (!$row) return null;

    $price = (float) ($row['price_brl'] ?? 0);
    if ($price <= 0) return null;

    $vk    = fg_sline($row['valor_k']   ?? '');
    $pl    = fg_sline($row['platform']  ?? '');
    $total = (int) ($row['total_coins'] ?? 0);
    $coins = (int) ($row['coins'] ?? 0);

    $display_name = $vk ? "Buy Now {$vk}" : "Buy Now";

    $desc_parts = [];
    if ($vk) {
        $desc_parts[] = "{$vk} de coins";
    } elseif ($total > 0) {
        $desc_parts[] = "{$total} coins";
    } elseif ($coins > 0) {
        $desc_parts[] = "{$coins} coins";
    }
    if ($pl) {
        $desc_parts[] = $pl;
    }

    $desc_plain = trim(implode(' — ', $desc_parts));
    if ($desc_plain === '') {
        $desc_plain = 'Compra imediata (Buy Now)';
    }

    $ts = strtotime($row['created_at'] ?: 'now');

    return [
        'type'         => 'buynow',
        'price'        => $price,
        'product_id'   => (int) FG_BUYNOW_PRODUCT_ID,
        'display_name' => $display_name,
        'desc'         => $desc_plain,
        'elencos_str'  => null,
        'ts'           => $ts,
    ];
}


/** ===========================
 * Carregar pedido FC Player Shop pelo token
 * =========================== */
function fg_load_fc_player_shop_order_by_token($token){
    global $wpdb;

    $tOrders = $wpdb->prefix . 'fc_player_shop_orders';
    $tItems  = $wpdb->prefix . 'fc_player_shop_order_items';

    if (!fg_table_exists($tOrders) || !fg_table_exists($tItems)) {
        return null;
    }

    $order = $wpdb->get_row(
        $wpdb->prepare(
            "SELECT id, total_brl, total_coins, items_count, squad_names, created_at, updated_at, status
             FROM {$tOrders}
             WHERE token=%s
             LIMIT 1",
            $token
        ),
        ARRAY_A
    );

    if (!$order) return null;

    $price = (float) ($order['total_brl'] ?? 0);
    if ($price <= 0) return null;

    $order_id    = (int) ($order['id'] ?? 0);
    $total_coins = (int) ($order['total_coins'] ?? 0);
    $items_count = (int) ($order['items_count'] ?? 0);

    $items = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT player_name, rating, position, price_coins, squad_name, source_type
             FROM {$tItems}
             WHERE order_id=%d
             ORDER BY id ASC",
            $order_id
        ),
        ARRAY_A
    );

    $player_names = [];
    $squad_names  = [];

    if (is_array($items)) {
        foreach ($items as $it) {
            $pn = fg_sline($it['player_name'] ?? '');
            if ($pn) $player_names[] = $pn;
            $sn = fg_sline($it['squad_name'] ?? '');
            if ($sn) $squad_names[] = $sn;
        }
    }

    $header_squad_names = [];
    $raw_squad_names = $order['squad_names'] ?? '';
    if ($raw_squad_names) {
        $decoded = json_decode($raw_squad_names, true);
        if (is_array($decoded)) {
            foreach ($decoded as $sid => $sname) {
                $sname = fg_sline($sname);
                if ($sname) $header_squad_names[] = $sname;
            }
        }
    }

    $squad_names = array_values(array_unique(array_filter(array_merge($squad_names, $header_squad_names))));

    $display_name = 'Jogadores selecionados';
    if (count($squad_names) === 1) {
        $display_name = $squad_names[0];
    } elseif (count($player_names) === 1) {
        $display_name = $player_names[0];
    } elseif ($items_count > 0) {
        $display_name = "Jogadores ({$items_count})";
    }

    $squads_str = $squad_names ? implode(', ', $squad_names) : '';
    $desc_plain = trim(
        "{$total_coins} coins — {$items_count} jogador(es)"
        . ($squads_str ? " — Squad(s): {$squads_str}" : "")
    );

    $players_str = fg_join_names_limited($player_names, 25);
    $ts = strtotime($order['updated_at'] ?: ($order['created_at'] ?: 'now'));

    return [
        'type'         => 'fcshop',
        'price'        => $price,
        'product_id'   => (int) FG_FCPLAYER_PRODUCT_ID,
        'display_name' => $display_name,
        'desc'         => $desc_plain,
        'elencos_str'  => $players_str ?: null,
        'ts'           => $ts,
    ];
}


/** ===========================
 * Carregar pedido Pack pelo token
 * =========================== */
function fg_load_pack_order_by_token($token){
    global $wpdb;

    $table = $wpdb->prefix . 'cc_pack_sessions';

    if (!fg_table_exists($table)) return null;

    $row = $wpdb->get_row(
        $wpdb->prepare(
            "SELECT id, token, user_id, composition, description, total, status, created_at
             FROM {$table}
             WHERE token=%s
             LIMIT 1",
            $token
        ),
        ARRAY_A
    );

    if (!$row) return null;

    $total = floatval($row['total'] ?? 0);
    if ($total <= 0) return null;

    $composition = json_decode($row['composition'] ?? '{}', true);
    if (!is_array($composition)) $composition = [];

    $stored_desc = isset($row['description']) ? trim((string)$row['description']) : '';
    if ($stored_desc !== '') {
        $desc = $stored_desc;
    } else {
        $parts = [];
        $packs_table = $wpdb->prefix . 'cc_packs';
        foreach ($composition as $pack_id => $qty) {
            $pack = $wpdb->get_row(
                $wpdb->prepare("SELECT name FROM {$packs_table} WHERE id = %d", intval($pack_id)),
                ARRAY_A
            );
            $name = $pack ? fg_sline($pack['name']) : "Pack #{$pack_id}";
            $parts[] = "{$name} x{$qty}";
        }
        $desc = $parts ? implode(', ', $parts) : 'Packs selecionados';
    }

    $product_id = intval(get_option('cc_packs_product_id', 0));
    if (!$product_id) $product_id = intval(get_option('cc_packs_wc_product_id', 0));

    $ts = strtotime($row['created_at'] ?: 'now');

    return [
        'type'         => 'pack',
        'price'        => $total,
        'product_id'   => $product_id,
        'display_name' => 'Packs Chama Coins',
        'desc'         => $desc,
        'elencos_str'  => null,
        'ts'           => $ts,
    ];
}
/** ===========================
 * Carregar pedido pelo token (lendo tabelas oficiais)
 *
 * Prioridade de tipo quando o mesmo token aparece em mais de uma tabela:
 *   dme (4) > fcshop (3) > sniper (2) > buynow (1)
 *
 * Dentro do mesmo tipo, ganha o registro mais recente (ts).
 * O campo "mode" de wp_cs_dme_orders (ex.: 'lance') é ignorado aqui;
 * ele pertence à lógica interna do DME e não altera o tipo do pedido.
 * =========================== */
function fg_load_order_by_token($token){
    global $wpdb;

    $token = fg_sline($token);
    if (!$token) return null;

    // Prioridade de tipo — DME sempre ganha sobre BuyNow quando o mesmo token existe em ambas as tabelas
    $type_priority = [
        'pack'   => 5,
        'dme'    => 4,
        'fcshop' => 3,
        'sniper' => 2,
        'buynow' => 1,
    ];

    $candidates = [];

    // 1) FC Player Shop
    $fc = fg_load_fc_player_shop_order_by_token($token);
    if ($fc && !empty($fc['price'])) {
        $candidates[] = $fc;
    }

    // 2) BuyNow
    $bn = fg_load_buynow_order_by_token($token);
    if ($bn && !empty($bn['price'])) {
        $candidates[] = $bn;
    }

    // 3) Pack
    $pack = fg_load_pack_order_by_token($token);
    if ($pack && !empty($pack['price'])) {
        $candidates[] = $pack;
    }

    // 3) DME — o campo 'mode' (ex.: 'lance') é buscado mas NÃO usado como
    //    discriminador de tipo; o tipo sempre será 'dme' se o token existir nesta tabela.
    $tDME = $wpdb->prefix.'cs_dme_orders';
    if (fg_table_exists($tDME)) {
        $dme = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT item_name,total_k,total_brl,selection_json,platform,updated_at
                 FROM {$tDME} WHERE token=%s ORDER BY updated_at DESC LIMIT 1",
                $token
            ),
            ARRAY_A
        );

        if ($dme) {
            $name = fg_sline($dme['item_name'] ?? 'Item');
            $tk   = fg_sline($dme['total_k']   ?? '');
            $pl   = fg_sline($dme['platform']  ?? '');

            $sel   = json_decode($dme['selection_json'] ?? '[]', true);
            $names = [];
            if (is_array($sel)) {
                foreach ($sel as $it) {
                    $n = fg_sline($it['name'] ?? '');
                    if ($n) $names[] = $n;
                }
            }
            $elencos_names = implode(', ', array_unique($names));
            $desc_plain    = trim("{$name} {$tk} de coins" . ($pl ? " {$pl}" : ""));

            $candidates[] = [
                'type'         => 'dme',                   // sempre 'dme', independente do campo mode
                'price'        => (float) ($dme['total_brl'] ?? 0),
                'product_id'   => (int) FG_DME_PRODUCT_ID, // produto 85
                'display_name' => $name,
                'desc'         => $desc_plain,
                'elencos_str'  => $elencos_names ?: null,
                'ts'           => strtotime($dme['updated_at'] ?: 'now'),
            ];
        }
    }

    // 4) Sniper
    $tSNP = $wpdb->prefix.'cs_sniper_orders';
    if (fg_table_exists($tSNP)) {
        $snp = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT valor_k,price_brl,mode,platform,created_at
                 FROM {$tSNP} WHERE token=%s ORDER BY created_at DESC LIMIT 1",
                $token
            ),
            ARRAY_A
        );

        if ($snp) {
            $vk = fg_sline($snp['valor_k']  ?? '');
            $md = fg_sline($snp['mode']     ?? '');
            $pl = fg_sline($snp['platform'] ?? '');
            $desc_plain = trim("{$vk} de coins modo {$md}" . ($pl ? " {$pl}" : ""));

            $candidates[] = [
                'type'         => 'sniper',
                'price'        => (float) ($snp['price_brl'] ?? 0),
                'product_id'   => (int) FG_SNIPER_PRODUCT_ID,
                'display_name' => $vk ? "Sniper {$vk}" : 'Sniper',
                'desc'         => $desc_plain,
                'elencos_str'  => null,
                'ts'           => strtotime($snp['created_at'] ?: 'now'),
            ];
        }
    }

    if (!$candidates) return null;

    // Seleciona o melhor candidato:
    //   1º critério: maior prioridade de tipo  (dme > fcshop > sniper > buynow)
    //   2º critério: timestamp mais recente (desempate dentro do mesmo tipo)
    $best = null;
    foreach ($candidates as $c) {
        if ((float)($c['price'] ?? 0) <= 0) continue;

        if (!$best) {
            $best = $c;
            continue;
        }

        $c_prio    = $type_priority[ $c['type']    ] ?? 0;
        $best_prio = $type_priority[ $best['type'] ] ?? 0;

        if ($c_prio > $best_prio) {
            $best = $c;
        } elseif ($c_prio === $best_prio && (int)($c['ts'] ?? 0) > (int)($best['ts'] ?? 0)) {
            $best = $c;
        }
    }

    // fallback: nenhum candidato com preço válido — escolhe por prioridade de tipo
    if (!$best) {
        foreach ($candidates as $c) {
            if (!$best) { $best = $c; continue; }
            $c_prio    = $type_priority[ $c['type']    ] ?? 0;
            $best_prio = $type_priority[ $best['type'] ] ?? 0;
            if ($c_prio > $best_prio) {
                $best = $c;
            } elseif ($c_prio === $best_prio && (int)($c['ts'] ?? 0) > (int)($best['ts'] ?? 0)) {
                $best = $c;
            }
        }
    }

    unset($best['ts']);
    return $best;
}

/** ===========================
 * Upload: salvar imagem base64
 * =========================== */
function fg_save_base64_image($data_url){
    if (empty($data_url)) return '';
    if (!preg_match('#^data:image/(png|jpe?g);base64,#i', $data_url, $m)) return '';

    $ext  = strtolower($m[1]) === 'jpeg' ? 'jpg' : strtolower($m[1]);
    $data = preg_replace('#^data:image/\w+;base64,#i', '', $data_url);
    $data = base64_decode($data);
    if ($data === false) return '';

    $upload = wp_upload_dir();
    if (!empty($upload['error'])) return '';

    $filename = 'fg-backup-'.time().'-'.wp_generate_password(6, false).'.'.$ext;
    $filepath = trailingslashit($upload['path']).$filename;
    $url      = trailingslashit($upload['url']).$filename;

    if (file_put_contents($filepath, $data) === false) return '';
    return $url;
}

/** ===========================
 * Processar envio (template_redirect)
 * =========================== */
function fg_process_submission(){
    if (
        isset($_POST['fg_form_submitted']) &&
        isset($_POST['fg_form_nonce']) &&
        wp_verify_nonce($_POST['fg_form_nonce'], 'fg_form_action')
    ) {
        if ( is_admin() ) return;
        if ( ! function_exists('WC') || ! WC()->cart ) {
            wp_die('WooCommerce indisponível.');
        }

        global $wpdb;

        $email        = isset($_POST['email']) ? sanitize_email($_POST['email']) : '';
        $senha        = isset($_POST['senha']) ? sanitize_text_field($_POST['senha']) : '';
        $backup_codes = isset($_POST['backup_codes']) ? sanitize_textarea_field($_POST['backup_codes']) : '';
        $token        = isset($_POST['token']) ? fg_sline($_POST['token']) : '';

        if (!$token) wp_die('Token não informado.');

        $backup_photo_url = '';
        if (!empty($_POST['backup_photo_data'])) {
            $backup_photo_url = fg_save_base64_image($_POST['backup_photo_data']);
        }

        $order = fg_load_order_by_token($token);
        if (!$order)              wp_die('Nenhum pedido encontrado para este token.');
        if ($order['price'] <= 0) wp_die('Preço inválido para este pedido.');

        $table = $wpdb->prefix . 'cs_user_submissions';
        $wpdb->insert(
            $table,
            [
                'price'               => (float)$order['price'],
                'modo'                => $order['type'],
                'token'               => $token,
                'email'               => $email,
                'senha'               => $senha,
                'backup_codes'        => $backup_codes,
                'backup_photo_url'    => $backup_photo_url,
                'submission_datetime' => current_time('mysql'),
                'created_at'          => current_time('mysql'),
            ],
            ['%f','%s','%s','%s','%s','%s','%s','%s','%s']
        );

        wc_clear_notices();

        if (WC()->cart) {
            WC()->cart->empty_cart();
        }

        $added = WC()->cart->add_to_cart(
            (int)$order['product_id'],
            1,
            0,
            [],
            [
                'dme_name'    => $order['display_name'],
                'dme_price'   => (float)$order['price'],
                'token'       => $token,
                'dme_desc'    => $order['desc'],
                'dme_elencos' => $order['elencos_str'],
                'order_type'  => $order['type'],
            ]
        );

        if (!$added) {
            wc_add_notice('Não foi possível adicionar o item ao carrinho.', 'error');
            wp_safe_redirect( wc_get_cart_url() );
            exit;
        }

        wp_safe_redirect( wc_get_checkout_url() );
        exit;
    }
}
add_action('template_redirect', 'fg_process_submission');

/** ===========================
 * WooCommerce: preço dinâmico, nome e metadados exibidos
 * =========================== */
add_action('woocommerce_before_calculate_totals', function($cart){
    if ( is_admin() && !defined('DOING_AJAX') ) return;
    if ( empty($cart) || ! $cart instanceof WC_Cart ) return;

    foreach ($cart->get_cart() as $cart_item_key => $cart_item) {
        if (
            isset($cart_item['dme_price']) &&
            (float)$cart_item['dme_price'] > 0 &&
            isset($cart_item['data']) &&
            $cart_item['data'] instanceof WC_Product
        ) {
            $cart_item['data']->set_price( (float)$cart_item['dme_price'] );
        }
    }
}, 20);

add_filter('woocommerce_cart_item_name', function($name, $cart_item, $cart_item_key){
    if ( isset($cart_item['dme_name']) && $cart_item['dme_name'] !== '' ) {
        return esc_html( $cart_item['dme_name'] );
    }
    return $name;
}, 10, 3);

add_filter('woocommerce_get_item_data', function($data, $cart_item){
    if (!empty($cart_item['dme_desc'])) {
        $data[] = [
            'name'  => 'Descrição',
            'value' => nl2br( esc_html( $cart_item['dme_desc'] ) ),
        ];
    }
    if (!empty($cart_item['dme_elencos'])) {
        $label = 'Elencos';
        if (!empty($cart_item['order_type']) && $cart_item['order_type'] === 'fcshop') {
            $label = 'Jogadores';
        }
        $data[] = [
            'name'  => $label,
            'value' => esc_html( $cart_item['dme_elencos'] ),
        ];
    }
    return $data;
}, 10, 2);

add_action('woocommerce_checkout_create_order_line_item', function($item, $cart_item_key, $values, $order){
    if ( isset($values['dme_name']) && $values['dme_name'] !== '' ) {
        $item->set_name( $values['dme_name'] );
    }
    if ( !empty($values['dme_desc']) ) {
        $item->add_meta_data('Descrição', $values['dme_desc'], true);
    }
    if ( !empty($values['dme_elencos']) ) {
        $label = 'Elencos';
        if ( !empty($values['order_type']) && $values['order_type'] === 'fcshop' ) {
            $label = 'Jogadores';
        }
        $item->add_meta_data($label, $values['dme_elencos'], true);
    }
    if ( !empty($values['order_type']) ) {
        $item->add_meta_data('Tipo', strtoupper($values['order_type']), true);
    }
}, 10, 4);

/** ===========================
 * Shortcode [formulario_geral_form]
 * =========================== */
function fg_form_shortcode(){
    $price = floatval(get_query_var('price', 0));
    $token = get_query_var('token', '');

    wp_enqueue_style('fg-form-css', FG_URL.'assets/css/fg-form.css', [], FG_VER);
    wp_enqueue_script('fg-form-js', FG_URL.'assets/js/fg-form.js', [], FG_VER, true);
    wp_localize_script('fg-form-js', 'FGFORM', [
        'embedUrl' => FG_EMBED_URL,
    ]);

    ob_start(); ?>
    <div class="fg-form-container">
      <h2>Formulário Geral</h2>
      <p class="fg-form-note">
        Sua conta deve conter <strong>mercado aberto</strong> pelo aplicativo <strong>Companion</strong>.
      </p>

      <form id="fg-form" method="post" action="">
        <?php wp_nonce_field('fg_form_action', 'fg_form_nonce'); ?>

        <div class="row two">
          <div>
            <label for="email">E-mail *</label>
            <input type="email" id="email" name="email" required>
          </div>
          <div>
            <label for="senha">Senha *</label>
            <input type="password" id="senha" name="senha" required>
          </div>
        </div>

        <label for="backup_codes">Códigos backups <span style="font-weight:400;color:#666;">(opcional — se preferir, digite aqui)</span></label>
        <textarea id="backup_codes" name="backup_codes" placeholder="Cole ou digite seus códigos de backup (um por linha)."></textarea>

        <details>
          <summary>Tutorial de como pegar os códigos backups</summary>
          <ol style="margin-top:8px; padding-left:18px;">
            <li>Abra o aplicativo <strong>EA SPORTS FC Companion</strong> no seu celular.</li>
            <li>Acesse <em>Segurança / Login</em> e localize a seção de <strong>Códigos de backup</strong>.</li>
            <li>Copie os códigos e cole acima, ou utilize a câmera para fotografar a tela.</li>
          </ol>
          <div class="video-tut">
            <button type="button" class="btn-sec" id="btn-open-video">Ver vídeo passo a passo (modal)</button>
          </div>
        </details>

        <!-- Modal do vídeo -->
        <div class="fg-modal" id="fg-video-modal" hidden aria-hidden="true">
          <div class="overlay" data-close="1"></div>
          <div class="box" role="dialog" aria-modal="true" aria-label="Tutorial em vídeo">
            <button type="button" class="close" data-close="1" aria-label="Fechar">×</button>
            <div class="content">
              <div class="video-wrap">
                <iframe
                  id="fg-video-iframe"
                  width="560" height="315"
                  src=""
                  title="Tutorial - como pegar os códigos"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  loading="lazy"
                  referrerpolicy="origin-when-cross-origin"
                  allowfullscreen>
                </iframe>
              </div>
            </div>
          </div>
        </div>

        <label>Print / Foto dos códigos backups</label>
        <div class="capture-wrap">
          <div id="camera-area" style="display:none;">
            <video id="camera" autoplay playsinline></video>
            <div class="capture-actions">
              <button type="button" class="btn-sec" id="btn-capture">Tirar foto</button>
              <button type="button" class="btn-sec" id="btn-close-camera">Fechar câmera</button>
            </div>
          </div>

          <canvas id="snapshot" style="display:none;"></canvas>
          <img id="preview-img" class="preview" style="display:none;" alt="Prévia da foto">

          <div class="capture-actions">
            <button type="button" class="btn-sec" id="btn-open-camera">Abrir câmera traseira</button>
            <button type="button" class="btn-sec" id="btn-clear-photo">Limpar foto</button>
          </div>
          <input type="hidden" name="backup_photo_data" id="backup_photo_data" value="">
          <div class="hint">Usamos a câmera traseira e salvamos a imagem via canvas.</div>
        </div>

        <input type="hidden" name="price" value="<?php echo esc_attr(number_format($price, 2, '.', '')); ?>">
        <input type="hidden" name="token" id="fg-token" value="<?php echo esc_attr($token); ?>">
        <input type="hidden" name="fg_form_submitted" value="1">

        <button type="submit" class="btn fgx-btn">Enviar</button>
      </form>
    </div>
    <?php
    return ob_get_clean();
}
add_shortcode('formulario_geral_form', 'fg_form_shortcode');