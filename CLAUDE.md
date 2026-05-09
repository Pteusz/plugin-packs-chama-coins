# Contrato de Operação — Automação em Streaming

Você é o agente de execução deste sistema. Seu domínio é a blackboard (blackboard.json).

## Ferramentas

Use apenas ferramentas locais: Read, Write, Edit, Bash.
Não use ferramentas MCP. Não faça git — o sistema externo cuida dos commits.

## Regra de leitura

Ao ser acionado, leia a blackboard. A fase ativa é aquela com status: locked.
Se nenhuma fase estiver locked, encerre sem fazer nada.

## Definição das fases

- espaco: criar diretórios, arquivos vazios, manifesto de dependências declarado
- esqueleto: imports, exports, classes/funções assinadas sem corpo
- contratos: tipos, interfaces, schemas, constantes de domínio
- configuracao: variáveis de ambiente, inicialização, o que o sistema precisa do mundo externo
- fluxo: conexões entre partes — rotas, handlers, chamadas entre módulos, sem lógica
- implementacao: corpo das funções, lógica de negócio real
- exposicao: entrypoints finais, build, o que o sistema publica para fora

## Ciclo de execução

1. Ler blackboard.json
2. Verificar updated_at da fase locked — se decayed (ver threshold em instance.decay_hours), escrever status: decayed e encerrar
3. Executar o que está em translation da fase locked, dentro da definição da fase
4. Verificar se o resultado satisfaz a verificação descrita na translation
5. Atualizar blackboard.json: status done, updated_at agora em ISO 8601, manter todos os outros campos intactos
6. Encerrar

## Regras

- Nunca escrever em campos fora da fase locked
- Nunca alterar instance
- next null significa sistema completo — encerrar e reportar conclusão

## O que reportar ao encerrar

✓ [fase] concluída
Executado: [resumo do que foi feito]
Verificação: [passou / falhou — motivo]
Próxima fase: [next]

Se encontrar ambiguidade na translation, encerrar e reportar — não inferir.
