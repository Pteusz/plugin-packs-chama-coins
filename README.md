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
| **API de DMEs** | Fonte dos dados brutos de DMEs e elencos |
| **Plugin Renderizador de DMEs** | Transforma dados da API em cards com forma — chamado via função |
| **Plugin de Formulário** | Recebe token de sessão, cruza com a composição do pedido, envia para checkout WooCommerce |

O plugin de formulário recebe modificação pontual para processar o token gerado por este plugin e montar a query de checkout com `product_id + quantidade total`.

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
Um único produto de ID fixo registrado na ativação do plugin. O preço é injetado dinamicamente no checkout a partir do `total` da sessão.

---

## Estrutura de páginas

### Vitrine (shortcode `[cc_packs_store]`)
Exibição pública dos packs disponíveis. Cada card mostra imagem dos DMEs do pack e nome. Ao clicar abre popup com DMEs internos; ao clicar em um DME exibe elencos via API.

Barra inferior emerge ao adicionar o primeiro pack — mostra composição, quantidades e total. "Concluir" gera token de sessão e redireciona para o formulário externo.

### Gestão ADM (shortcode `[cc_packs_admin]`)
Acesso restrito a usuários com capability `manage_options`.

**Modo CRUD:** Formulário de criação/edição de pack (nome, preço, seleção de DMEs com busca). Listagem dos packs criados pelo ADM com menu de três pontos (editar / excluir).

**Modo Pedidos:** Listagem dos pedidos WooCommerce referentes ao produto "Packs" originados de sessions criadas pelo ADM. Cada pedido exibe dados do comprador, composição, total, status e link direto para WhatsApp gerado com base no número de celular cadastrado.

---

## Fluxo principal

```
API + Renderizador → DMEs com forma na vitrine
ADM cria pack → salvo em wp_cc_packs
Usuário compõe pedido → barra inferior acumula packs + quantidades
"Concluir" → gera token → salva em wp_cc_pack_sessions → redireciona para formulário
Formulário (plugin externo modificado) → cruza token × sessions × packs → checkout WooCommerce com product_id + qty_total
Pedido criado → ADM aprova/reprova na página de gestão
```

---

## Instalação

1. Faça upload da pasta `plugin-packs-chama-coins` para `/wp-content/plugins/`
2. Ative o plugin no painel WordPress
3. Na ativação, o plugin cria automaticamente as tabelas `wp_cc_packs` e `wp_cc_pack_sessions` e registra o produto WooCommerce "Packs"
4. Adicione o shortcode `[cc_packs_store]` na página de vitrine
5. Adicione o shortcode `[cc_packs_admin]` em uma página restrita a ADMs
6. Configure a URL base da API de DMEs e o ID do plugin de formulário nas configurações do plugin

---

## Modificação no Plugin de Formulário

O plugin de formulário externo precisa de um endpoint adicional que:
- Recebe o `token` via query string
- Consulta `wp_cc_pack_sessions` pelo token
- Cruza com `wp_cc_packs` para montar descrição do pedido
- Após submissão do formulário, redireciona para o checkout WooCommerce com `?add-to-cart={product_id}&quantity={total_unidades}`
