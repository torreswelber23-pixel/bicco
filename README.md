# Bicco — corrida e entrega sob demanda pelo WhatsApp

Quem manda mensagem no seu número recebe automaticamente um **formulário nativo
do WhatsApp** (WhatsApp Flow) pra pedir uma **corrida** ou uma **entrega**. O
pedido vira uma solicitação estruturada no banco e é oferecido, na hora, a
todos os motoristas/entregadores cadastrados e disponíveis — o primeiro que
tocar "Aceitar" fica com ele.

Sem bot de menu numérico, sem "digite 1 para orçamento": o cliente preenche
dentro do próprio WhatsApp, e o motorista aceita com um toque, também pelo
WhatsApp.

```
Cliente manda mensagem
        │
        ▼
/api/whatsapp/webhook ──── envia a mensagem interativa que abre o Flow
        │
        ▼
Cliente escolhe Corrida ou Entrega e preenche endereços
        │
        ▼  (cada tela, cifrada ponta a ponta)
/api/whatsapp/flow ──────── valida assinatura, decifra, decide a próxima tela
        │
        ▼
Supabase (leads) grava o pedido + dispara "Aceitar/Recusar" pros motoristas
        │
        ▼
Motorista toca "Aceitar" ──── primeiro a tocar fica com o pedido
        │
        ▼
Cliente recebe nome e contato do motorista; /admin mostra tudo em tempo real
```

## O que já está pronto

| Peça | Onde |
| --- | --- |
| Webhook (verificação + recebimento) | `src/app/api/whatsapp/webhook/route.ts` |
| Endpoint de dados do Flow (cripto) | `src/app/api/whatsapp/flow/route.ts` |
| Criptografia RSA + AES-GCM | `src/lib/flow-crypto.ts` |
| Regras de navegação entre telas | `src/lib/flow-handler.ts` |
| Definição das telas | `flows/pedido-sob-demanda.flow.json` |
| Despacho pros motoristas/entregadores | `src/lib/dispatch.ts` |
| OAuth com a Meta | `src/app/api/auth/meta/` |
| Renovação automática do token | `src/app/api/cron/refresh-token/route.ts` |
| Esquema do banco | `supabase/migrations/` |
| Painel de demandas e conexão | `src/app/admin/page.tsx` |
| Scripts de chaves / publicação / simulação | `scripts/` |

## Conexão com a Meta

O token do WhatsApp é obtido por **OAuth**, não por copiar e colar. Em `/admin`
você clica em "Conectar com a Meta", faz login, e o sistema descobre o número,
guarda o token no banco e passa a renová-lo sozinho.

Três decisões que valem explicar, porque cada uma corrige um jeito comum de
errar:

- **A troca por token de longa duração é obrigatória.** O `code` da autorização
  vira um token de ~1 hora; só a segunda troca dá os ~60 dias. Guardar o token
  curto "porque é melhor que nada" faz o atendimento morrer no mesmo dia, com
  sintoma idêntico ao de token inválido.
- **A renovação verifica se realmente renovou.** Reenviar um token que já é de
  longa duração costuma devolver a mesma expiração, não uma janela nova. O
  código compara a validade antes e depois e avisa quando o prazo não avançou —
  aí a saída é reconectar, não renovar de novo.
- **As rotas exigem autenticação.** Iniciar autorização, ver status ou renovar
  são ações de administrador; o cron usa `CRON_SECRET`. Sem isso, qualquer um
  que descubra a URL rotaciona credencial de produção.

O caminho manual (`WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` em variável de
ambiente) continua funcionando como fallback — vale enquanto nenhuma conta
estiver conectada pelo painel.

## O Flow

Definido em `flows/pedido-sob-demanda.flow.json`:

1. **SERVICO** — nome e escolha entre Corrida ou Entrega.
2. **CORRIDA** — endereço de partida, de destino, e se é agora ou agendado.
3. **ENTREGA** — endereço de coleta, de entrega, o que vai ser entregue, e
   dados de quem recebe.
4. **AGENDAMENTO** — só aparece quando o cliente escolhe "agendar para
   depois". Os horários já reservados vêm marcados como indisponíveis.
5. **RESUMO** — protocolo e recapitulação; o pedido já sai "buscando
   motorista" assim que essa tela é exibida.

As opções de cada tela vêm do servidor (`src/lib/catalog.ts`), não estão fixas no
Flow JSON. Isso importa porque **um Flow publicado é imutável**: mudar uma opção
de dropdown sem isso exigiria publicar uma nova versão.

## Despacho para motoristas e entregadores

Ao concluir o Flow (`finalizar()` em `src/lib/flow-handler.ts`), o pedido é
oferecido a todos os motoristas/entregadores cadastrados, disponíveis e do
tipo certo (`src/lib/dispatch.ts`): cada um recebe uma mensagem com botões
"Aceitar" / "Recusar".

- **O primeiro a aceitar fica com o pedido.** `claimOrder` (`src/lib/repository.ts`)
  faz a atribuição com um `UPDATE ... WHERE status = 'buscando_motorista'`: só a
  primeira resposta encontra a linha nesse estado, então dois toques quase
  simultâneos não geram dois motoristas para o mesmo pedido.
- **Motoristas são cadastrados no `/admin`**, com nome, telefone (o mesmo
  número do WhatsApp) e tipo (corrida, entrega ou ambos). Só entram no
  despacho os marcados como disponíveis.
- **Aceitar dispara um botão de "Concluir".** Quando o motorista toca, o
  pedido vira `concluido` e o cliente recebe um aviso.

## Como estudar sem depender da Meta

O simulador reproduz exatamente o que o app do WhatsApp faz — gera a chave AES,
cifra com a sua pública, assina com o app secret, chama o endpoint e decifra a
resposta:

```bash
npm run keys:generate          # gera keys/public.pem e keys/private.pem
npm run dev
npm run flow:simulate ping     # health check da Meta
npm run flow:simulate init <flow_token>
npm run flow:simulate demanda <flow_token>
```

`ping` funciona só com `WHATSAPP_APP_SECRET` e `FLOW_PRIVATE_KEY` no
`.env.local`. `init` e `demanda` precisam de um `flow_token` que exista na tabela
`flow_sessions`.

## Rodando

```bash
npm install
cp .env.example .env.local     # preencha conforme docs/SETUP.md
npm run dev
```

O passo a passo completo — criar o app na Meta, gerar e registrar as chaves,
publicar o Flow, apontar o webhook, subir na Vercel — está em
[`docs/SETUP.md`](docs/SETUP.md).

## Detalhes que costumam quebrar

- **Assinatura sobre o corpo bruto.** `X-Hub-Signature-256` é calculada sobre os
  bytes originais. Reserializar o JSON antes de validar invalida a assinatura —
  por isso os handlers leem `request.text()`, não `request.json()`.
- **IV invertido na resposta.** A resposta usa a mesma chave AES da requisição,
  mas com o IV negado bit a bit, e volta como base64 puro (`text/plain`), não
  JSON.
- **Códigos de status têm significado.** `421` faz o cliente descartar a chave de
  sessão e refazer o handshake; `432` sinaliza assinatura inválida. Devolver
  `500` no lugar deles trava o Flow para o usuário.
- **Webhook sempre responde 200.** A Meta reenvia enquanto não receber 200, e
  reenvio duplicaria o atendimento. Erros são registrados no log, não propagados.
- **Estado fica no servidor.** Cada `data_exchange` traz apenas os campos da tela
  atual, então as respostas são acumuladas em `flow_sessions.draft`. O
  `flow_token` é a única credencial da sessão — é ele que amarra a demanda ao
  contato, e um token desconhecido é rejeitado.

## Segurança

- `SUPABASE_SERVICE_ROLE_KEY` ignora RLS e só existe no servidor. As tabelas têm
  RLS ligado **sem policies**, então uma chave pública vazada não lê nada.
- `keys/`, `.env` e `.env.local` estão no `.gitignore`. A chave privada do Flow
  nunca deve ser commitada.
- `npm audit` reporta 3 avisos de severidade alta em `postcss` e `sharp`, ambos
  dependências transitivas do Next 16.2.12 (a versão mais recente). Não há
  correção disponível sem rebaixar o Next; some quando o Next atualizar.
