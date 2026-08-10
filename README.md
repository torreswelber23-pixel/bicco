# Bicco — API sobre o WhatsApp Cloud API

Um número de WhatsApp conectado, exposto como API REST para outra
plataforma — um CRM, um ERP, um site — consumir.

**Sem resposta automática de nenhum tipo.** Quando chega uma mensagem, o
bicco só grava e dispara o evento `message.received` por webhook. Quem
decide o que (e se) responder é a plataforma do outro lado, chamando
`POST /api/v1/messages` de volta quando quiser.

```
Cliente manda mensagem pro WhatsApp
        │
        ▼
Meta entrega em /api/whatsapp/webhook
        │
        ▼
bicco grava a mensagem + dispara "message.received" (assinado com HMAC)
        │
        ▼
Sua plataforma decide o que fazer e chama POST /api/v1/messages de volta
        │
        ▼
bicco envia pelo WhatsApp Cloud API e grava a saída no mesmo histórico
```

## A API

```
GET    /api/v1/status              testar a chave, ver o estado da conexão
POST   /api/v1/messages            enviar qualquer tipo de mensagem
GET    /api/v1/messages            histórico de uma conversa
POST   /api/v1/media               upload de mídia (base64 → media_id)
GET    /api/v1/media/{id}          download de mídia
GET    /api/v1/templates           templates cadastrados e status de aprovação
GET    /api/v1/contacts            quem já falou com o número
POST   /api/v1/webhooks            registrar destino de eventos
GET    /api/v1/webhooks            listar webhooks
DELETE /api/v1/webhooks/{id}       remover webhook
```

`POST /api/v1/messages` cobre todos os tipos que a Cloud API aceita: texto,
imagem, áudio, vídeo, documento, figurinha, localização, contato, botões,
lista, pedido de localização, botão de link (`cta_url`), template e reação —
com `reply_to` opcional em qualquer um deles.

As chaves são criadas em `/admin` e guardadas como hash (SHA-256) — o valor
em claro aparece uma única vez. Os eventos chegam ao destino assinados com
HMAC em `X-Bicco-Signature`, para o outro lado distinguir um evento real de
um POST forjado por quem descobriu a URL.

Referência completa, com exemplo de cada tipo de mensagem: [`docs/API.md`](docs/API.md).

## O que já está pronto

| Peça | Onde |
| --- | --- |
| Webhook de entrada (grava + dispara evento, sem responder nada) | `src/app/api/whatsapp/webhook/route.ts`, `src/lib/webhook-handler.ts` |
| API pública v1 | `src/app/api/v1/`, `src/lib/api-http.ts`, `src/lib/api-keys.ts` |
| Webhooks de saída | `src/lib/webhooks-out.ts` |
| Todos os tipos de mensagem da Cloud API | `src/lib/whatsapp.ts` |
| OAuth com a Meta | `src/app/api/auth/meta/` |
| Renovação automática do token | `src/app/api/cron/refresh-token/route.ts` |
| Esquema do banco | `supabase/migrations/` |
| Painel de conexão, chaves e webhooks | `src/app/admin/page.tsx` |

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

## Por que não tem resposta automática

Existiu uma versão anterior deste projeto com uma conversa guiada (lista,
perguntas, despacho pra motoristas) — era um app de corrida/entrega
específico. Essa lógica de negócio foi removida: o bicco agora é só a camada
de transporte entre o WhatsApp e a plataforma que você constrói por fora,
para não ficar preso a um modelo de conversa que não é o seu.

## Rodando

```bash
npm install
cp .env.example .env.local     # preencha conforme docs/SETUP.md
npm run dev
```

O passo a passo completo — criar o app na Meta, conectar via OAuth, apontar o
webhook, subir na Vercel — está em [`docs/SETUP.md`](docs/SETUP.md).

## Detalhes que costumam quebrar

- **Assinatura sobre o corpo bruto.** `X-Hub-Signature-256` (mensagens
  entrando) e `X-Bicco-Signature` (eventos saindo) são calculadas sobre os
  bytes originais do payload. Reserializar o JSON antes de validar invalida
  a assinatura.
- **Webhook de entrada sempre responde 200.** A Meta reenvia enquanto não
  receber 200, e reenvio duplicaria a gravação. Erros são registrados no
  log, não propagados.
- **Webhooks de saída não têm reenvio automático.** Um destino fora do ar
  perde o evento; `last_error` no painel é o que avisa disso.
- **Não existe editar mensagem enviada.** A Cloud API não oferece essa
  operação — só reagir ou mandar uma mensagem nova.
- **Listas e botões têm limites de tamanho.** Ver a tabela completa em
  [`docs/API.md`](docs/API.md#limites-herdados-do-whatsapp).

## Segurança

- `SUPABASE_SERVICE_ROLE_KEY` ignora RLS e só existe no servidor. As tabelas têm
  RLS ligado **sem policies**, então uma chave pública vazada não lê nada.
- `.env` e `.env.local` estão no `.gitignore`.
- Chaves de API são guardadas como hash; o valor em claro aparece uma única
  vez, na criação.
- `npm audit` reporta 3 avisos de severidade alta em `postcss` e `sharp`, ambos
  dependências transitivas do Next 16.2.12 (a versão mais recente). Não há
  correção disponível sem rebaixar o Next; some quando o Next atualizar.
