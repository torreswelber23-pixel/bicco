# API do bicco

Uma API REST sobre o número de WhatsApp conectado. Serve para outra
plataforma — um CRM, um ERP, um site — enviar mensagens, ler conversas e
receber eventos, sem lidar com a Meta diretamente.

**Não há resposta automática de nenhum tipo.** Quando o cliente manda
mensagem, o bicco só grava e dispara o evento `message.received` — quem
decide o que (e se) responder é a plataforma que está do outro lado do
webhook, chamando `POST /api/v1/messages` de volta quando quiser.

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
| `messages:send` | Enviar mensagens e subir mídia |
| `messages:read` | Ler histórico de conversa e baixar mídia |
| `contacts:read` | Listar contatos |

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

Cobre **todos** os tipos que a Cloud API aceita: texto, mídia, interativos,
localização, contato, template e reação. Todo tipo aceita `"reply_to":
"<wamid>"` opcional, para citar uma mensagem anterior.

> **Não existe editar mensagem.** A Cloud API não oferece essa operação para
> quem envia pela API — depois de enviada, uma mensagem só pode receber uma
> reação ou ser seguida por uma mensagem nova. Não é limitação desta API, é
> ausência no produto da Meta.

**Texto**

```json
{ "to": "5591920079468", "type": "text", "text": "Seu corte é amanhã às 14h." }
```

**Imagem, vídeo, áudio, documento, figurinha** — mesmo formato para os cinco;
`caption` só é aceito por imagem, vídeo e documento; `filename` só por
documento. Use `link` (URL pública, a Meta busca sozinha) ou `media_id` (de
um upload feito em `POST /api/v1/media`) — nunca os dois.

```json
{
  "to": "5591920079468",
  "type": "image",
  "link": "https://exemplo.com/foto.jpg",
  "caption": "Antes e depois"
}
```

```json
{ "to": "5591920079468", "type": "audio", "media_id": "1234567890" }
```

```json
{
  "to": "5591920079468",
  "type": "document",
  "link": "https://exemplo.com/orcamento.pdf",
  "filename": "orcamento.pdf"
}
```

**Localização** (enviar um pino — diferente de pedir a do cliente, veja
`location_request` abaixo)

```json
{
  "to": "5591920079468",
  "type": "location",
  "latitude": -1.4558,
  "longitude": -48.4902,
  "name": "Barbearia Central",
  "address": "Av. Nazaré, 100"
}
```

**Contato** (vCard simplificado)

```json
{
  "to": "5591920079468",
  "type": "contacts",
  "contacts": [{ "name": "Suporte", "phone": "5591988887777" }]
}
```

**Botões** (1 a 3 — limite da Meta, título ≤20 caracteres)

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

**Pedido de localização** — abre o seletor de mapa nativo do cliente

```json
{ "to": "5591920079468", "type": "location_request", "body": "Envie seu endereço." }
```

**Botão de link** (`cta_url`) — único botão, abre uma URL

```json
{
  "to": "5591920079468",
  "type": "cta_url",
  "body": "Confirme seu horário pelo link:",
  "button_text": "Confirmar",
  "url": "https://exemplo.com/confirmar/abc123"
}
```

**Template** — só funciona com um nome já aprovado no WhatsApp Manager; é o
único tipo que a Meta aceita fora da janela de 24h.

```json
{
  "to": "5591920079468",
  "type": "template",
  "name": "lembrete_horario",
  "language": "pt_BR",
  "components": [
    { "type": "body", "parameters": [{ "type": "text", "text": "14h" }] }
  ]
}
```

**Reação** — não devolve mensagem nova, reage a uma existente. `emoji: ""`
remove uma reação enviada antes.

```json
{ "to": "5591920079468", "type": "reaction", "message_id": "wamid.HBg…", "emoji": "👍" }
```

Resposta `201` (comum a todos os tipos):

```json
{
  "sent": true,
  "to": "5591920079468",
  "type": "text",
  "wa_message_id": "wamid.HBg…",
  "contact_id": "uuid"
}
```

> **Janela de 24 horas.** O WhatsApp só permite mensagem livre (qualquer tipo
> exceto template) dentro de 24h desde a última mensagem *do cliente*. Fora
> disso a Meta recusa com `send_failed`, e o caminho é um template aprovado.

---

## Mídia: upload e download

Enviar por `link` (URL pública) é o caminho simples e não passa por aqui.
Use estes endpoints só quando o arquivo **não** tem URL pública.

**Upload** — devolve um `media_id` para usar em `POST /api/v1/messages`.
Válido por ~30 dias sem uso, ou até a mensagem que o usa ser apagada.

```
POST /api/v1/media
{ "data": "<base64>", "mime_type": "image/jpeg", "filename": "foto.jpg" }
```

```json
{ "id": "1234567890", "mime_type": "image/jpeg" }
```

**Download** — baixa os bytes de uma mídia enviada ou recebida (o `id` vem
do payload de `message.received`, em `message.image.id` etc.).

```
GET /api/v1/media/{id}
```

Devolve os bytes crus com o `Content-Type` correto — não a URL da Meta, que
expira em minutos e exige o mesmo Bearer token da conta. Por isso o proxy: o
token nunca sai do servidor.

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

---

## Webhooks: receber eventos

O bicco não responde nada sozinho — é assim que sua plataforma fica sabendo
que uma mensagem chegou, para então decidir (e chamar a API) o que fazer:

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
| `message.received` | O número recebeu qualquer mensagem (único evento hoje) |

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
- Imagem: até 5MB. Áudio: até 16MB. Vídeo e documento: até 100MB.
- Áudio e figurinha não aceitam `caption`.
- Janela de 24h para mensagem livre; fora dela só template aprovado.
- Não existe editar mensagem enviada — só reagir ou mandar uma nova.
- Limite diário de conversas iniciadas, que sobe com verificação do negócio.
