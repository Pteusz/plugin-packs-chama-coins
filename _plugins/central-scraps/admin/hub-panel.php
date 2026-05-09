<?php
if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * FutbinHubPanel
 *
 * Responsabilidades:
 *  - Registrar o shortcode [futbin_hub]
 *  - Enfileirar scripts e passar dados do PHP para o JS (wp_localize_script)
 *  - Renderizar o HTML base do painel (estrutura de abas)
 *
 * O JS (hub-panel.js) faz toda a lógica de orquestração a partir do HTML
 * renderizado aqui e dos dados passados via fhubData.
 */
class FutbinHubPanel {

    public static function init() {
        add_shortcode( 'futbin_hub', array( __CLASS__, 'render_shortcode' ) );
        add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_scripts' ) );
        add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_scripts' ) );
    }

    // --------------------------------------------------------
    // ENQUEUE DE SCRIPTS
    // --------------------------------------------------------

    public static function enqueue_scripts() {
        // jQuery (dependência base)
        wp_enqueue_script( 'jquery' );

        // Hub JS principal
        wp_enqueue_script(
            'fhub-panel',
            FHUB_URL . 'admin/hub-panel.js',
            array( 'jquery' ),
            FHUB_VERSION,
            true
        );

        // Scripts dos módulos registrados
        foreach ( FutbinHubRegistry::getAll() as $module ) {
            if ( ! empty( $module['js_path'] ) && file_exists( $module['js_path'] ) ) {
                wp_enqueue_script(
                    $module['js_handle'],
                    FHUB_URL . 'modules/' . $module['id'] . '/' . basename( $module['js_path'] ),
                    array( 'fhub-panel' ),
                    $module['version'],
                    true
                );
            }
        }

        // Passa dados do PHP para o JS
        wp_localize_script( 'fhub-panel', 'fhubData', self::build_js_data() );
    }

    /**
     * Constrói o objeto de dados passado ao JS via wp_localize_script.
     */
    private static function build_js_data() {
        $modules_data = array();

        foreach ( FutbinHubRegistry::getAll() as $module ) {
            $last_run = FutbinHubCore::get_module_meta( $module['id'] );

            $modules_data[] = array(
                'id'          => $module['id'],
                'label'       => $module['label'],
                'description' => $module['description'],
                'version'     => $module['version'],
                'jsObject'    => $module['js_object'],
                'ajaxAction'  => $module['ajax_action'],
                'apiBase'     => home_url( '/wp-json/' . $module['api_base'] ),
                'hasInput'    => (bool) $module['has_input'],
                'lastRun'     => $last_run,
            );
        }

        return array(
            'ajaxUrl'  => admin_url( 'admin-ajax.php' ),
            'nonce'    => wp_create_nonce( 'fhub_nonce' ),
            'modules'  => $modules_data,
            'version'  => FHUB_VERSION,
            'homeUrl'  => home_url(),
        );
    }

    // --------------------------------------------------------
    // SHORTCODE [futbin_hub]
    // --------------------------------------------------------

    public static function render_shortcode( $atts ) {
        $modules = FutbinHubRegistry::getAll();

        ob_start();
        ?>
        <div id="fhub-app" style="max-width:1200px; margin:40px auto; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">

            <!-- ── Cabeçalho ─────────────────────────────────── -->
            <div style="text-align:center; margin-bottom:30px;">
                <h2 style="color:#1a202c; font-size:24px; margin:0 0 6px;">
                    🌐 Futbin Hub
                </h2>
                <p style="color:#718096; font-size:13px; margin:0;">
                    v<?php echo esc_html( FHUB_VERSION ); ?> — Painel centralizado de scrapers
                </p>
            </div>

            <?php if ( empty( $modules ) ) : ?>
            <div style="text-align:center; padding:60px 20px; background:#f7fafc; border-radius:12px; color:#a0aec0;">
                <p style="font-size:16px;">Nenhum módulo registrado ainda.</p>
                <p style="font-size:13px;">Ative um módulo para ele aparecer aqui automaticamente.</p>
            </div>
            <?php else : ?>

            <!-- ── Navegação de abas ──────────────────────────── -->
            <div id="fhub-tabs" style="display:flex; gap:4px; border-bottom:2px solid #e2e8f0; margin-bottom:0;">
                <?php foreach ( $modules as $index => $module ) : ?>
                <button
                    class="fhub-tab-btn <?php echo $index === 0 ? 'fhub-tab-active' : ''; ?>"
                    data-module="<?php echo esc_attr( $module['id'] ); ?>"
                    style="
                        padding:10px 20px;
                        border:none;
                        background:<?php echo $index === 0 ? '#fff' : 'transparent'; ?>;
                        color:<?php echo $index === 0 ? '#3182ce' : '#718096'; ?>;
                        font-weight:<?php echo $index === 0 ? '600' : '400'; ?>;
                        font-size:14px;
                        cursor:pointer;
                        border-bottom:<?php echo $index === 0 ? '2px solid #3182ce' : '2px solid transparent'; ?>;
                        margin-bottom:-2px;
                        border-radius:6px 6px 0 0;
                        transition:all 0.2s;
                    "
                >
                    <?php echo esc_html( $module['label'] ); ?>
                </button>
                <?php endforeach; ?>
            </div>

            <!-- ── Painéis das abas ───────────────────────────── -->
            <?php foreach ( $modules as $index => $module ) : ?>
            <div
                id="fhub-panel-<?php echo esc_attr( $module['id'] ); ?>"
                class="fhub-tab-panel"
                data-module="<?php echo esc_attr( $module['id'] ); ?>"
                style="
                    display:<?php echo $index === 0 ? 'block' : 'none'; ?>;
                    background:#fff;
                    border:1px solid #e2e8f0;
                    border-top:none;
                    border-radius:0 0 12px 12px;
                    padding:24px;
                "
            >
                <!-- Descrição do módulo -->
                <div style="margin-bottom:20px;">
                    <p style="color:#4a5568; font-size:14px; margin:0;">
                        <?php echo esc_html( $module['description'] ); ?>
                        <span style="color:#a0aec0; font-size:12px; margin-left:8px;">
                            v<?php echo esc_html( $module['version'] ); ?>
                        </span>
                    </p>
                </div>

                <!-- Campo de input (módulos interativos) -->
                <?php if ( ! empty( $module['has_input'] ) ) : ?>
                <div class="fhub-input-area" style="margin-bottom:20px; display:flex; gap:10px;">
                    <input
                        type="text"
                        class="fhub-search-input"
                        placeholder="Digite para buscar..."
                        style="
                            flex:1;
                            padding:10px 14px;
                            border:1px solid #e2e8f0;
                            border-radius:8px;
                            font-size:14px;
                            outline:none;
                        "
                    />
                </div>
                <?php endif; ?>

                <!-- Controles -->
                <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px; flex-wrap:wrap;">
                    <button
                        class="fhub-btn-start"
                        data-module="<?php echo esc_attr( $module['id'] ); ?>"
                        style="padding:10px 28px; background:#38a169; color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer;"
                    >▶ Iniciar</button>

                    <button
                        class="fhub-btn-stop"
                        data-module="<?php echo esc_attr( $module['id'] ); ?>"
                        style="display:none; padding:10px 28px; background:#e53e3e; color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer;"
                    >⏹ Parar</button>

                    <button
                        class="fhub-btn-clear"
                        data-module="<?php echo esc_attr( $module['id'] ); ?>"
                        style="padding:10px 20px; background:transparent; color:#718096; border:1px solid #e2e8f0; border-radius:8px; font-size:13px; cursor:pointer;"
                    >🗑 Limpar Dados</button>

                    <span
                        class="fhub-phase-badge"
                        style="display:none; padding:6px 16px; background:#ebf8ff; color:#2b6cb0; border-radius:20px; font-size:13px; font-weight:600;"
                    >Aguardando...</span>
                </div>

                <!-- Alerta de erro crítico (preenchido pelo JS via onError) -->
                <div class="fhub-error-alert" style="display:none; margin-bottom:16px; padding:12px 16px; background:#fff5f5; border:1px solid #feb2b2; border-left:4px solid #e53e3e; border-radius:6px; color:#c53030; font-size:13px;"></div>

                <!-- Estatísticas -->
                <div class="fhub-stats-area" style="display:none; margin-bottom:20px;">
                    <div class="fhub-stats-grid" style="display:flex; flex-wrap:wrap; gap:12px;">
                        <!-- Preenchido pelo JS com base nos dados de onStats() -->
                    </div>
                </div>

                <!-- Barra de progresso -->
                <div class="fhub-progress-area" style="display:none; margin-bottom:20px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                        <span style="font-size:13px; color:#4a5568; font-weight:500;">Progresso</span>
                        <span class="fhub-progress-text" style="font-size:13px; color:#718096;">0 / 0</span>
                    </div>
                    <div style="background:#e2e8f0; height:10px; border-radius:10px; overflow:hidden;">
                        <div
                            class="fhub-progress-bar"
                            style="height:100%; width:0%; background:linear-gradient(90deg,#3182ce,#38a169); transition:width 0.3s;"
                        ></div>
                    </div>
                </div>

                <!-- Log -->
                <div class="fhub-log-area" style="display:none;">
                    <div
                        style="
                            background:#1a202c;
                            border-radius:8px;
                            padding:14px;
                            max-height:280px;
                            overflow-y:auto;
                            font-family:'Courier New',monospace;
                            font-size:12px;
                        "
                    >
                        <div class="fhub-log-entries"></div>
                    </div>
                </div>

                <!-- Resumo final -->
                <div class="fhub-summary-area" style="display:none; margin-top:20px; padding:16px; background:#f0fff4; border-radius:8px; border-left:4px solid #38a169;">
                    <h4 style="margin:0 0 10px; color:#276749;">✅ Concluído!</h4>
                    <div class="fhub-summary-content" style="font-size:13px; color:#2f855a;"></div>
                    <div style="margin-top:12px; font-size:12px; color:#4a5568;">
                        <strong>API:</strong>
                        <code><?php echo esc_html( home_url( '/wp-json/' . $module['api_base'] . '/data' ) ); ?></code>
                    </div>
                </div>

            </div><!-- .fhub-tab-panel -->
            <?php endforeach; ?>

            <?php endif; ?>
        </div><!-- #fhub-app -->
        <?php
        return ob_get_clean();
    }
}
