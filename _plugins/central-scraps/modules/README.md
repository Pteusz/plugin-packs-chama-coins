# Módulos do Futbin Hub

Este diretório contém os módulos registrados no Hub.

## Estrutura de um módulo

```
modules/
└── {id}/
    ├── {id}-config.php          ← Constantes: tabela, versão, cache key
    ├── class-{id}-module.php    ← Registro PHP, tabela, AJAX, REST API
    └── {id}-scraper.js          ← Runner JS: start(params, callbacks) + stop()
```

## Módulos disponíveis

- `sbc/` — SBC Scraper (Entrega 2)

## Como registrar um novo módulo

Em `class-{id}-module.php`, chame dentro de `plugins_loaded` ou na ativação:

```php
FutbinHubRegistry::register([
    'id'          => 'meu_modulo',
    'label'       => 'Meu Módulo',
    'description' => 'Descrição curta',
    'version'     => '1.0',
    'js_object'   => 'MeuModuloScraper',
    'js_handle'   => 'fhub-module-meu-modulo',
    'js_path'     => FHUB_DIR . 'modules/meu_modulo/meu-modulo-scraper.js',
    'ajax_action' => 'fhub_meu_modulo_save',
    'api_base'    => 'fhub/v1/meu_modulo',
    'table'       => 'fhub_meu_modulo',
    'has_input'   => false,
]);
```

O Hub aparece automaticamente na próxima carga de página.
