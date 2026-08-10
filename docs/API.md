# API do bicco

Uma API REST sobre o número de WhatsApp conectado. Serve para outra
plataforma — um CRM, um ERP, um site — enviar mensagens, ler conversas e
receber eventos, sem lidar com a Meta diretamente.

Base: `https://SEU-APP.vercel.app/api/v1`

---

## Autenticação

Toda chamada leva a chave no header:

```
Authorization: Bearer bic_live_...
```

Crie a chave em `/admin` → **API** → *Criar chave*. **O valor aparece uma
única vez.** No banco fica só o hash (SHA-256), então uma chave perdida não
tem como ser recuperada — só revogada e substituída.

Escopos, atribuídos na criação:

| Escopo | Permite |
| --- | --- |
| `messages:send` | Enviar mensagens |
| `messages:read` | Ler histórico de conversa |
| `contacts:read` | Listar contatos |
| `orders:read` | Ler pedidos |
| `orders:write` | Alterar status de pedido |

Erros vêm sempre na mesma forma, para o tratamento ser escrito uma vez só:

```json
{ "error": { "code": "invalid_key", "message": "Chave inválida ou revogada." } }
```

| Código | Situação |
| --- | --- |
| 401 `unauthorized` / `invalid_key` | Sem header, ou chave inválida/revogada |
| 403 `forbidden` | A chave não tem o escopo necessário |
| 400 `invalid_*` | Corpo ou parâmetro malformado |
| 404 `not_found` | Recurso inexistente |
| 502 `send_failed` | A Meta recusou o envio |
| 503 `whatsapp_not_connected` | Nenhuma conta conectada em `/admin` |

---

## Status da conexão

```
GET /api/v1/status
```

Primeira chamada de qualquer integração: confirma que a chave vale e que
existe WhatsApp do outro lado. Nunca devolve o token.

```json
{
  "connected": true,
  "phone_number_id": "123456789",
  "waba_id": "987654321",
  "token": { "source": "oauth", "expires_at": "2026-10-09T…", "days_remaining": 60 },
  "key": { "name": "CRM barbearia", "scopes": ["messages:send", "…"] }
}
```

---

## Enviar mensagem

```
POST /api/v1/messages
```

Quatro tipos, todos nativos e sem aprovação prévia da Meta. Template não
entra aqui: exige cadastro e tem regra própria de janela.

**Texto**

```json
{ "to": "5591920079468", "type": "text", "text": "Seu corte é amanhã às 14h." }
```

**Botões** (1 a 3 — limite da Meta)

```json
{
  "to": "5591920079468",
  "type": "buttons",
  "body": "Confirma seu horário?",
  "buttons": [
    { "id": "confirmar", "title": "Confirmar" },
    { "id": "remarcar", "title": "Remarcar" }
  ]
}
```

**Lista** (1 a 10 itens; título ≤24 caracteres, descrição ≤72)

```json
{
  "to": "5591920079468",
  "type": "list",
  "body": "Escolha o serviço:",
  "button": "Ver opções",
  "items": [
    { "id": "corte", "title": "Corte", "description": "45 minutos" },
    { "id": "barba", "title": "Barba" }
  ]
}
```

**Pedido de localização** — abre o seletor de mapa nativo

```json
{ "to": "5591920079468", "type": "location_request", "body": "Envie seu endereço." }
```

Resposta `201`:

```json
{ "sent": true, "to": "5591920079468", "type": "text", "contact_id": "uuid" }
```

> **Janela de 24 horas.** O WhatsApp só permite mensagem livre dentro de 24h
> desde a última mensagem *do cliente*. Fora disso a Meta recusa com
> `send_failed`, e o caminho é um template aprovado — regra dela, não desta
> API.

---

## Ler conversa

```
GET /api/v1/messages?contact_id=<uuid>&limit=50&offset=0
GET /api/v1/messages?wa_id=5591920079468
```

Exige um dos dois recortes. Devolve entrada e saída na mesma linha do tempo,
do mais recente para o mais antigo — inclusive as mensagens enviadas pela
própria API.

## Contatos

```
GET /api/v1/contacts?q=maria&limit=50&offset=0
```

`q` casa com telefone ou nome de perfil.

## Pedidos

```
GET    /api/v1/orders?status=pendente&limit=50&offset=0
GET    /api/v1/orders/{id}
PATCH  /api/v1/orders/{id}     { "status": "cancelado" }
```

Status válidos: `pendente`, `buscando_motorista`, `atribuido`, `a_caminho`,
`concluido`, `cancelado`.

O `PATCH` existe para o caso em que a operação acontece do lado de fora: um
pedido cancelado no CRM precisa refletir aqui, senão o motorista continua com
um trabalho que já não existe.

---

## Webhooks: receber eventos

Enviar mensagem é metade do problema. Para saber que *chegou* uma, registre
um destino:

```
POST /api/v1/webhooks
{ "url": "https://seu-crm.com/hooks/whatsapp", "events": ["message.received"] }
```

A resposta traz um `secret` **que aparece uma única vez**:

```json
{ "id": "uuid", "url": "https://…", "events": ["message.received"], "secret": "…" }
```

| Evento | Quando |
| --- | --- |
| `message.received` | Cliente mandou qualquer mensagem |
| `order.created` | Pedido concluído na conversa |
| `order.assigned` | Motorista aceitou |
| `order.completed` | Motorista marcou como concluído |

Cada entrega é um `POST` com o corpo:

```json
{ "event": "message.received", "created_at": "2026-08-10T…", "data": { … } }
```

### Validando a assinatura

O header `X-Bicco-Signature` traz `sha256=<hmac>`, calculado com o `secret`
sobre o **corpo bruto** da requisição. Sem essa verificação, qualquer um que
descubra a URL consegue injetar eventos falsos no seu CRM.

```js
import crypto from "node:crypto";

const bruto = await request.text();          // texto, não JSON já parseado
const esperado = crypto.createHmac("sha256", SECRET).update(bruto).digest("hex");
const recebido = request.headers.get("x-bicco-signature")?.slice("sha256=".length);

const ok =
  recebido &&
  crypto.timingSafeEqual(Buffer.from(esperado, "hex"), Buffer.from(recebido, "hex"));
```

Reserializar o JSON antes de validar muda os bytes e invalida a assinatura —
é o erro mais comum aqui.

### Gerenciar

```
GET    /api/v1/webhooks
DELETE /api/v1/webhooks/{id}
```

Entregas com falha ficam registradas em `last_error` e aparecem no `/admin`.
Não há reenvio automático: um destino fora do ar perde o evento, e é por isso
que o painel mostra o erro em vez de escondê-lo.

---

## Limites herdados do WhatsApp

Nenhum deles é escolha desta API — todos vêm da Meta:

- Botões: no máximo 3, título ≤20 caracteres.
- Listas: no máximo 10 itens, título ≤24, descrição ≤72.
- Janela de 24h para mensagem livre.
- Limite diário de conversas iniciadas, que sobe com verificação do negócio.
