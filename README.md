# Plugin Packs — Chama Coins

Plugin WordPress para criação, exibição e gestão de packs de DMEs comercializáveis via WooCommerce.

---

## Visão geral

O plugin permite que ADMs agrupem DMEs (vindos de API externa) em packs nomeados e precificados. Esses packs são exibidos para usuários em uma página de vitrine, onde o usuário compõe um pedido com um ou mais packs e quantidades. A composição é colapsada via token de sessão em uma única compra do produto WooCommerce "Packs".

---

## Dependências externas

Este plugin opera sobre três pilares já existentes no ecossistema:

| Dependência | Papel |
|---|---|
| **API de DMEs** (central-scraps / SBC) | Fonte dos DMEs — exposta em `/wp-json/fhub/v1/sbc/feed` no mesmo WordPress |
| **Plugin Renderizador de DMEs** (fc-card-renderer) | Normaliza dados dos cards via `apply_filters('fc_card_normalize_data', ...)` |
| **Plugin de Formulário** (form-geral) | Recebe token de sessão, cruza com a composição do pedido, envia para checkout WooCommerce |

O plugin de formulário recebe uma modificação pontual via `_patch/form-geral-pack.patch.php`.

---

## Modelo de dados

### `wp_cc_packs`
Cada pack criado por um ADM.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | INT PK | Identificador único |
| `name` | VARCHAR | Nome do pack |
| `price` | DECIMAL | Preço unitário |
| `dme_ids` | JSON | Array de IDs dos DMEs incluídos |
| `adm_id` | INT | ID do usuário ADM criador |
| `created_at` | DATETIME | Data de criação |

### `wp_cc_pack_sessions`
Composição de pedido do usuário, gerada ao clicar em "Concluir".

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | INT PK | Identificador único |
| `token` | VARCHAR UNIQUE | Token de acesso gerado para o formulário |
| `user_id` | INT | ID do usuário comprador |
| `composition` | JSON | `{ pack_id: quantidade }` |
| `total` | DECIMAL | Soma das partes |
| `status` | ENUM | `pending`, `approved`, `rejected` |
| `created_at` | DATETIME | Data de criação |

### Produto WooCommerce "Packs"
Um único produto registrado automaticamente na ativação do plugin. ID salvo na option `cc_packs_product_id`. O preço é injetado dinamicamente no checkout a partir do `total` da sessão.

---

## Estrutura de páginas

### Vitrine (shortcode `[cc_packs_store]`)
Exibição pública dos packs disponíveis. Cada card mostra imagem dos DMEs do pack e nome. Ao clicar abre popup com DMEs internos; ao clicar em um DME exibe elencos via API.

Barra inferior emerge ao adicionar o primeiro pack — mostra composição, quantidades e total. "Concluir" gera token de sessão e redireciona para o formulário externo.

### Gestão ADM (shortcode `[cc_packs_admin]`)
Acesso restrito a usuários com capability `manage_options`.

**Modo CRUD:** Formulário de criação/edição de pack (nome, preço, seleção de DMEs com busca). Listagem dos packs criados pelo ADM com menu de três pontos (editar / excluir). Acessado via URL padrão da página.

**Modo Pedidos:** Acessado adicionando `?cc_mode=orders` na URL. Lista as sessões cujos packs pertencem ao ADM logado. Cada entrada exibe dados do comprador, composição, total, status e link WhatsApp gerado a partir do telefone cadastrado no perfil WooCommerce do usuário.

---

## Fluxo principal

```
API /wp-json/fhub/v1/sbc/feed → DMEs com forma na vitrine
ADM cria pack → salvo em wp_cc_packs
Usuário compõe pedido → barra inferior acumula packs + quantidades
"Concluir" → gera token → salva em wp_cc_pack_sessions → redireciona para formulário
https://chamacoins.com.br/dme-form/?token={token}
Formulário (form-geral com patch aplicado) → cruza token × sessions × packs → checkout WooCommerce
Pedido criado → ADM aprova/reprova no modo pedidos
```

---

## Instalação

1. Faça upload da pasta `plugin-packs-chama-coins` para `/wp-content/plugins/`
2. Ative o plugin no painel WordPress — as tabelas `wp_cc_packs` e `wp_cc_pack_sessions` e o produto WooCommerce "Packs" são criados automaticamente
3. Adicione o shortcode `[cc_packs_store]` na página de vitrine
4. Adicione o shortcode `[cc_packs_admin]` em uma página restrita a ADMs
5. Aplique o patch no plugin de formulário seguindo as instruções em `_patch/form-geral-pack.patch.php`

Não há configurações adicionais. A URL da API de DMEs (`/wp-json/fhub/v1/sbc/feed`) é resolvida automaticamente a partir do domínio do WordPress. A URL do formulário (`https://chamacoins.com.br/dme-form/`) está definida como constante no entry point e pode ser sobrescrita em `wp-config.php`:

```php
define('CC_PACKS_FORM_BASE_URL', 'https://seudominio.com/dme-form/');
```

---

## Aplicação do patch no Plugin de Formulário

O arquivo `_patch/form-geral-pack.patch.php` contém a função `fg_load_pack_order_by_token()` e instruções detalhadas de onde inserir cada trecho em `formulario-geral-venda-integration.php`. São duas alterações cirúrgicas: adicionar a função e registrar o tipo `pack` com prioridade 5 no array `$type_priority`.
