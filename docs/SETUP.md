# Setup completo

Do zero até um número de WhatsApp que atende sozinho. Reserve cerca de meia
hora na primeira vez — a maior parte é preenchimento de painel na Meta.

---

## 1. Conta e app na Meta

1. Crie uma conta em [business.facebook.com](https://business.facebook.com) e
   verifique o negócio (a verificação libera limites maiores de envio; dá para
   começar sem ela, em modo de teste).
2. Em [developers.facebook.com](https://developers.facebook.com) → **My Apps** →
   **Create App** → tipo **Business**.
3. No app, adicione o produto **WhatsApp**.

Na tela **WhatsApp → API Setup** você já encontra:

- um **número de teste** gratuito e o seu **Phone Number ID** →
  `WHATSAPP_PHONE_NUMBER_ID`;
- o **WhatsApp Business Account ID** → `WHATSAPP_BUSINESS_ACCOUNT_ID`;
- um token temporário de 24h, útil só para o primeiro teste.

Em **App Settings → Basic**, copie o **App Secret** → `WHATSAPP_APP_SECRET`.

> O número de teste só envia para até 5 números cadastrados na própria tela de
> API Setup. Para atender clientes de verdade, registre um número próprio em
> **WhatsApp → Phone Numbers**. O número precisa estar livre: não pode ter conta
> no WhatsApp comum ou Business ativa.

### O token: conectar pelo painel (recomendado)

Você **não precisa** copiar token nenhum à mão. Depois do deploy, abra
`/admin`, clique em **Conectar com a Meta** e faça login. O sistema:

- troca a autorização por um token de longa duração (~60 dias);
- descobre sozinho o Phone Number ID e o WABA ID;
- guarda tudo no banco (tabela `settings`);
- renova automaticamente por cron quando faltam 15 dias.

Para isso funcionar, cadastre a URL de retorno no app da Meta:

> **Login do Facebook** → **Configurações** → **URIs de redirecionamento
> OAuth válidos** → `https://SEU-APP.vercel.app/api/auth/meta/callback`

E preencha `META_APP_ID` (o ID do app, em App Settings → Basic).

> **Sobre a renovação:** reenviar um token que já é de longa duração nem sempre
> devolve uma janela nova — a Meta costuma manter a mesma expiração. O painel
> compara a validade antes e depois e avisa quando isso acontece; nesse caso a
> saída é clicar em **Reconectar**, que gera autorização nova de verdade.

### Alternativa: token permanente de usuário do sistema

Se preferir um token que nunca expira, em vez de renovar de tempos em tempos:

1. business.facebook.com → **Configurações do negócio** → **Usuários** →
   **Usuários do sistema** → **Adicionar**, com papel *Admin*.
2. **Adicionar ativos** → sua conta do WhatsApp → controle total.
3. **Gerar novo token** → escolha o app → marque `whatsapp_business_messaging` e
   `whatsapp_business_management` → validade **Nunca expira**.

Coloque em `WHATSAPP_TOKEN`, junto com `WHATSAPP_PHONE_NUMBER_ID`. Essas duas
variáveis são o caminho manual: valem enquanto nenhuma conta estiver conectada
pelo painel. Depois de conectar por lá, o banco tem precedência e elas passam a
ser ignoradas.

---

## 2. Banco no Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. **SQL Editor** → rode as migrações da pasta `supabase/migrations/`, em ordem.
3. **Project Settings → API**: copie a **Project URL** (`SUPABASE_URL`) e a chave
   **`service_role`** (`SUPABASE_SERVICE_ROLE_KEY`).

A `service_role` ignora RLS. Ela só pode viver nas variáveis de ambiente do
servidor — nunca em código de cliente, nunca no repositório.

---

## 3. Deploy na Vercel

```bash
npx vercel            # primeiro deploy
npx vercel --prod
```

Em **Project → Settings → Environment Variables**, cadastre todas as variáveis do
`.env.example`.

Anote a URL final, por exemplo `https://bicco.vercel.app` — é ela que aparece
no link que o cliente recebe no WhatsApp.

### Alternativa para desenvolvimento local

```bash
npx ngrok http 3000
```

Use a URL do ngrok nos passos seguintes. Ela muda a cada reinício do ngrok, e a
Meta precisa ser atualizada junto.

---

## 4. Webhook

No app da Meta: **WhatsApp → Configuration → Webhooks → Edit**.

- **Callback URL**: `https://SEU-APP.vercel.app/api/whatsapp/webhook`
- **Verify token**: o valor que você pôs em `WHATSAPP_VERIFY_TOKEN`

Clique em **Verify and save**. A Meta faz um GET nessa URL e espera o
`hub.challenge` de volta; se der erro, quase sempre é o token diferente entre o
painel e a variável de ambiente.

Depois, em **Webhook fields**, assine **`messages`**. Sem essa assinatura o
webhook fica cadastrado mas nunca recebe nada.

---

## 5. Teste de ponta a ponta

Primeiro, crie uma chave de API em `/admin` → **API** → *Criar chave* (copie
o valor, ele só aparece uma vez).

**Recebendo:** mande qualquer mensagem para o número pelo WhatsApp. O
esperado:

1. Ela aparece em **Contatos recentes**, em `/admin`.
2. Se você tiver um webhook cadastrado (`POST /api/v1/webhooks`), o evento
   `message.received` chega lá, assinado em `X-Bicco-Signature`.
3. **Nenhuma resposta automática é enviada** — isso é esperado, não bug.

**Enviando:** chame a API de volta.

```bash
curl https://SEU-APP.vercel.app/api/v1/messages \
  -H "Authorization: Bearer SUA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{ "to": "SEU_NUMERO_E164", "type": "text", "text": "Funcionando!" }'
```

A mensagem deve chegar no WhatsApp de quem você mandou.

### Quando não funciona

| Sintoma | Causa provável |
| --- | --- |
| Webhook não verifica | `WHATSAPP_VERIFY_TOKEN` diferente do painel |
| Nenhuma mensagem chega | Campo `messages` não assinado em Webhook fields |
| 401 no webhook de entrada | `WHATSAPP_APP_SECRET` errado |
| `401 invalid_key` na API | Chave errada, ou revogada em `/admin` |
| `503 whatsapp_not_connected` | Nenhuma conta conectada em `/admin` |
| Evento não chega no seu webhook | Confira `last_error` em `/admin`, e se o evento cadastrado inclui `message.received` |

Os logs da Vercel (**Deployments → Runtime Logs**) mostram as mensagens de
`[webhook]`, `[api]` e `[webhooks]`, que identificam quase todos os casos
acima.

---

## 6. Antes de atender cliente de verdade

- **Janela de 24h.** Enviar pela API só funciona sem template dentro de 24h
  desde a última mensagem *do cliente* — fora disso a Meta recusa com
  `send_failed`, e a saída é um template aprovado.
- **Limites de envio.** Começa em 250 conversas/dia e sobe conforme qualidade e
  verificação do negócio.
- **Custo.** Conversas iniciadas pelo cliente têm cota gratuita mensal; acima
  disso são cobradas por conversa, com preço que varia por país.
- **LGPD.** Você passa a guardar telefone, nome e o conteúdo das mensagens.
  Vale ter uma política de privacidade acessível e um caminho para exclusão
  de dados.
