# Bicco — corrida e entrega sob demanda pelo WhatsApp

Quem manda mensagem no seu número responde uma conversa curta, sem sair do
WhatsApp: escolhe **corrida** ou **entrega** numa lista nativa, compartilha a
localização pelo seletor de mapa do próprio app, e o pedido é oferecido, na
hora, a todos os motoristas/entregadores cadastrados e disponíveis — o
primeiro que tocar "Aceitar" fica com ele.

Sem bot de menu numérico, sem link pra abrir fora do app: cada pergunta é uma
mensagem (lista, botões, ou "envie sua localização"), e o motorista aceita
com um toque, também pelo WhatsApp.

```
Cliente manda "oi"
        │
        ▼
Lista: Corrida ou Entrega?
        │
        ▼
"Qual seu nome?" (texto)
        │
        ▼
"Envie sua localização" (seletor nativo de mapa) — origem/destino ou coleta/entrega
        │
        ▼
Entrega: "O que vai ser entregue?" + destinatário (opcional)
        │
        ▼
Botões: Agora ou Agendar?  → se agendar, lista de dia + lista de horário
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

## Por que conversa nativa e não WhatsApp Flow

A primeira versão usava [WhatsApp Flows](https://developers.facebook.com/docs/whatsapp/flows) —
o formulário nativo da Meta. Na prática isso trava a operação por coisas fora
do nosso controle: o Flow precisa ser **publicado** pela Meta antes de
funcionar de verdade, e essa publicação pode ser recusada com `Blocked by
Integrity` — um bloqueio de confiança da conta, sem relação com o conteúdo do
formulário, que pode levar dias pra se resolver.

A segunda versão trocou o Flow por um botão de link (`cta_url`) que abria uma
página web nossa. Funcionava, mas em alguns aparelhos/versões do app o link
abre no navegador do sistema em vez do navegador embutido do WhatsApp — o
cliente sai do app pra preencher o formulário.

Esta versão usa só os tipos de mensagem nativos do WhatsApp (lista, botões,
solicitação de localização): sem link, sem página externa, sem publicação —
o cliente nunca sai da conversa. A limitação é que WhatsApp não tem um campo
de texto livre "nativo" fora do Flow, então nome/descrição são perguntados
como mensagens de texto normais, uma pergunta por vez.

## O que já está pronto

| Peça | Onde |
| --- | --- |
| Webhook + máquina de estados da conversa | `src/app/api/whatsapp/webhook/route.ts`, `src/lib/webhook-handler.ts` |
| Mensagens nativas (lista, botões, localização) | `src/lib/whatsapp.ts` |
| Regra de negócio do pedido | `src/lib/order-handler.ts` |
| Despacho pros motoristas/entregadores | `src/lib/dispatch.ts` |
| OAuth com a Meta | `src/app/api/auth/meta/` |
| Renovação automática do token | `src/app/api/cron/refresh-token/route.ts` |
| Esquema do banco | `supabase/migrations/` |
| Painel de pedidos, motoristas e conexão | `src/app/admin/page.tsx` |

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

## A conversa

`src/lib/webhook-handler.ts` é uma máquina de estados: cada sessão guarda em
`flow_sessions.draft.step` qual pergunta o cliente está respondendo, e
`avancarConversa()` decide o que fazer com a próxima mensagem que chegar.

Diferente do link do formulário web (que carregava um token na URL), aqui a
sessão é encontrada pelo **contact_id de quem mandou a mensagem**
(`findOpenSession` em `src/lib/repository.ts`) — mensagens do WhatsApp não
carregam token nenhum de volta.

Passos, em ordem:

1. **`servico`** — lista com Corrida/Entrega.
2. **`nome`** — pergunta de texto simples.
3. **`origem`/`destino`** (corrida) ou **`coleta`/`entrega_endereco`** (entrega)
   — pedido de localização nativo; a resposta chega com endereço, nome do
   lugar ou só as coordenadas, dependendo do que o cliente compartilhou.
4. **`item`**, **`dest_nome`**, **`dest_telefone`** (só entrega) — texto livre;
   os dois últimos aceitam "pular".
5. **`quando`** — botões Agora/Agendar.
6. **`data`/`horario`** (só se agendar) — listas geradas a partir de
   `src/lib/catalog.ts`; os horários já ocupados nesse dia são filtrados fora
   da lista antes de mandar.

Um `button_reply` é ambíguo entre duas conversas diferentes — cliente
respondendo Agora/Agendar, ou motorista respondendo Aceitar/Recusar/Concluir
— por isso os botões do motorista sempre carregam `:` no id
(`aceitar:<pedido>`) e os do cliente nunca carregam; é assim que
`processMessage` decide pra qual lado mandar cada resposta.

## Despacho para motoristas e entregadores

Ao criar o pedido (`criarPedido()` em `src/lib/order-handler.ts`), ele é
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

## Rodando

```bash
npm install
cp .env.example .env.local     # preencha conforme docs/SETUP.md
npm run dev
```

O passo a passo completo — criar o app na Meta, conectar via OAuth, apontar o
webhook, subir na Vercel — está em [`docs/SETUP.md`](docs/SETUP.md).

## Detalhes que costumam quebrar

- **Assinatura sobre o corpo bruto.** `X-Hub-Signature-256` é calculada sobre os
  bytes originais do payload do webhook. Reserializar o JSON antes de validar
  invalida a assinatura — por isso o handler lê `request.text()`, não
  `request.json()`.
- **Webhook sempre responde 200.** A Meta reenvia enquanto não receber 200, e
  reenvio duplicaria o atendimento. Erros são registrados no log, não propagados.
- **Listas têm limite de 10 itens e textos curtos.** Título de item: 24
  caracteres; descrição: 72; texto de botão: 20. Catálogos maiores exigem
  paginar ou resumir o texto.
- **Localização pode vir sem endereço.** Se o cliente manda a posição atual
  (GPS) em vez de pesquisar um lugar, `address` e `name` vêm vazios — só
  latitude/longitude. `formatarLocalizacao()` cobre os três casos.

## Segurança

- `SUPABASE_SERVICE_ROLE_KEY` ignora RLS e só existe no servidor. As tabelas têm
  RLS ligado **sem policies**, então uma chave pública vazada não lê nada.
- `.env` e `.env.local` estão no `.gitignore`.
- `npm audit` reporta 3 avisos de severidade alta em `postcss` e `sharp`, ambos
  dependências transitivas do Next 16.2.12 (a versão mais recente). Não há
  correção disponível sem rebaixar o Next; some quando o Next atualizar.
