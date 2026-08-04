# Bicco — corrida e entrega sob demanda pelo WhatsApp

Quem manda mensagem no seu número recebe um botão que abre, dentro do próprio
WhatsApp, uma página pra pedir uma **corrida** ou uma **entrega**. O pedido
vira uma solicitação estruturada no banco e é oferecido, na hora, a todos os
motoristas/entregadores cadastrados e disponíveis — o primeiro que tocar
"Aceitar" fica com ele.

Sem bot de menu numérico, sem "digite 1 para orçamento": o cliente preenche
numa página normal (aberta pelo navegador embutido do WhatsApp), e o
motorista aceita com um toque, também pelo WhatsApp.

```
Cliente manda mensagem
        │
        ▼
/api/whatsapp/webhook ──── manda um botão com link (cta_url)
        │
        ▼
Cliente toca no botão ──── abre /pedido?t=<token> no navegador do WhatsApp
        │
        ▼
Escolhe Corrida ou Entrega, preenche endereços, envia
        │
        ▼
/api/pedido ──────────────── valida o token, grava o pedido
        │
        ▼
Supabase (leads) + dispara "Aceitar/Recusar" pros motoristas
        │
        ▼
Motorista toca "Aceitar" ──── primeiro a tocar fica com o pedido
        │
        ▼
Cliente recebe nome e contato do motorista; /admin mostra tudo em tempo real
```

## Por que página web e não WhatsApp Flow

A primeira versão usava [WhatsApp Flows](https://developers.facebook.com/docs/whatsapp/flows) —
o formulário nativo da Meta. Na prática isso trava a operação por coisas fora
do nosso controle: o Flow precisa ser **publicado** pela Meta antes de
funcionar de verdade, e essa publicação pode ser recusada com `Blocked by
Integrity` — um bloqueio de confiança da conta, sem relação com o conteúdo do
formulário, que pode levar dias pra se resolver (verificação de negócio, app
em modo "Ativo", histórico de mensagens).

O botão de **link (`cta_url`)** faz a mesma coisa sem depender de nada disso:
é só uma mensagem com um botão que abre uma URL no navegador embutido do
WhatsApp. A página é HTML/CSS/JS normal, hospedada por nós — dá pra mudar um
campo ou o texto de um botão e o efeito é imediato, sem publicar nada na Meta.

## O que já está pronto

| Peça | Onde |
| --- | --- |
| Webhook (verificação + recebimento) | `src/app/api/whatsapp/webhook/route.ts` |
| Página do formulário de pedido | `src/app/pedido/` |
| Endpoint que grava o pedido | `src/app/api/pedido/route.ts` |
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

## O formulário de pedido

`src/app/pedido/PedidoForm.tsx` é um componente cliente com quatro telas,
todas no mesmo arquivo (sem roteamento — é mais simples trocar de tela via
estado do que criar uma rota por passo):

1. **Serviço** — nome e escolha entre Corrida ou Entrega.
2. **Corrida** — endereço de partida, de destino, e se é agora ou agendado.
3. **Entrega** — endereço de coleta, de entrega, o que vai ser entregue, e
   dados de quem recebe.
4. **Agendamento** — só aparece quando o cliente escolhe "agendar para
   depois". Os horários já reservados vêm marcados como indisponíveis
   (`/api/pedido/horarios`).

Ao enviar, a página faz um `POST /api/pedido` com o token da sessão (gerado no
webhook, guardado em `flow_sessions`) e os dados preenchidos. O servidor valida
o token, grava o pedido e despacha pros motoristas — tudo isso sem depender de
nenhum passo de aprovação da Meta.

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
- **O token da sessão é a única credencial do pedido.** Gerado no webhook e
  gravado em `flow_sessions`, é ele que amarra o pedido ao contato certo — um
  token desconhecido ou já usado é rejeitado (`UnknownOrderTokenError`).

## Segurança

- `SUPABASE_SERVICE_ROLE_KEY` ignora RLS e só existe no servidor. As tabelas têm
  RLS ligado **sem policies**, então uma chave pública vazada não lê nada.
- `.env` e `.env.local` estão no `.gitignore`.
- `npm audit` reporta 3 avisos de severidade alta em `postcss` e `sharp`, ambos
  dependências transitivas do Next 16.2.12 (a versão mais recente). Não há
  correção disponível sem rebaixar o Next; some quando o Next atualizar.
