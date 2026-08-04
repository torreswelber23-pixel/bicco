# Setup completo

Do zero até um número de WhatsApp que atende sozinho. Reserve cerca de uma hora
na primeira vez — a maior parte é preenchimento de painel na Meta.

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
2. **SQL Editor** → rode as migrações da pasta `supabase/migrations/`, em ordem:
   `0001_init.sql` (tabelas do atendimento) e `0002_settings.sql` (credenciais
   da Meta obtidas por OAuth).
3. **Project Settings → API**: copie a **Project URL** (`SUPABASE_URL`) e a chave
   **`service_role`** (`SUPABASE_SERVICE_ROLE_KEY`).

A `service_role` ignora RLS. Ela só pode viver nas variáveis de ambiente do
servidor — nunca em código de cliente, nunca no repositório.

---

## 3. Chaves do endpoint de dados

O endpoint de dados do Flow é cifrado ponta a ponta. Você gera um par RSA, manda
a pública para a Meta e guarda a privada.

```bash
npm run keys:generate
```

O comando cria `keys/` (ignorada pelo git) e imprime a linha pronta do
`FLOW_PRIVATE_KEY` para colar no `.env.local`.

Depois de preencher `WHATSAPP_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` no
`.env.local`, registre a pública:

```bash
npm run flow:publish -- --upload-key
```

---

## 4. Deploy na Vercel

O Flow precisa de uma URL pública com HTTPS válido, então o deploy vem antes de
terminar a configuração na Meta.

```bash
npx vercel            # primeiro deploy
npx vercel --prod
```

Em **Project → Settings → Environment Variables**, cadastre todas as variáveis do
`.env.example`. Para a `FLOW_PRIVATE_KEY`, cole o PEM inteiro com quebras de
linha reais — o código também aceita `\n` literais, então qualquer um dos dois
formatos funciona.

Anote a URL final, por exemplo `https://bicco.vercel.app`.

### Alternativa para desenvolvimento local

```bash
npx ngrok http 3000
```

Use a URL do ngrok nos passos seguintes. Ela muda a cada reinício do ngrok, e a
Meta precisa ser atualizada junto.

---

## 5. Webhook

No app da Meta: **WhatsApp → Configuration → Webhooks → Edit**.

- **Callback URL**: `https://SEU-APP.vercel.app/api/whatsapp/webhook`
- **Verify token**: o valor que você pôs em `WHATSAPP_VERIFY_TOKEN`

Clique em **Verify and save**. A Meta faz um GET nessa URL e espera o
`hub.challenge` de volta; se der erro, quase sempre é o token diferente entre o
painel e a variável de ambiente.

Depois, em **Webhook fields**, assine **`messages`**. Sem essa assinatura o
webhook fica cadastrado mas nunca recebe nada.

---

## 6. Criar e publicar o Flow

```bash
# 1. cria o Flow como rascunho e devolve o ID
npm run flow:publish -- --create
#    → copie o ID para WHATSAPP_FLOW_ID no .env.local e na Vercel

# 2. envia as telas
npm run flow:publish -- --update

# 3. aponta o endpoint de dados
npm run flow:publish -- --endpoint https://SEU-APP.vercel.app/api/whatsapp/flow

# 4. publica
npm run flow:publish -- --publish
```

O passo 2 retorna `validation_errors`. Se a lista não estiver vazia, corrija
`flows/lead-capture.flow.json` e rode de novo — a publicação só passa com a lista
vazia.

Antes de publicar, dá para testar pelo **Flow Builder** (WhatsApp Manager →
Flows): há um preview interativo e um botão de envio para o seu próprio número.
Enquanto o Flow estiver em rascunho, defina `FLOW_MODE=draft` nas variáveis de
ambiente para que a mensagem consiga abri-lo.

> **Publicar torna o Flow imutável.** As telas não mudam mais. Por isso as opções
> dos dropdowns vêm do servidor (`src/lib/catalog.ts`): editar o catálogo não
> exige republicar. Mudar a *estrutura* das telas exige criar um Flow novo.

---

## 7. Teste de ponta a ponta

Mande qualquer mensagem para o número. O esperado:

1. Chega uma mensagem com o botão **Descrever demanda**.
2. O botão abre o formulário dentro do WhatsApp.
3. Ao concluir, chega uma confirmação com protocolo.
4. A demanda aparece em `https://SEU-APP.vercel.app/admin`.

### Quando não funciona

| Sintoma | Causa provável |
| --- | --- |
| Webhook não verifica | `WHATSAPP_VERIFY_TOKEN` diferente do painel |
| Nenhuma mensagem chega | Campo `messages` não assinado em Webhook fields |
| 401 no webhook | `WHATSAPP_APP_SECRET` errado |
| Botão aparece mas o Flow não abre | Flow em rascunho sem `FLOW_MODE=draft`, ou `WHATSAPP_FLOW_ID` errado |
| "Algo deu errado" ao abrir | Endpoint devolvendo erro — veja os logs da Vercel |
| 421 nos logs | Chave pública registrada não corresponde à `FLOW_PRIVATE_KEY` |
| Sessão expirada | `flow_token` sem registro em `flow_sessions` |

Os logs da Vercel (**Deployments → Runtime Logs**) mostram as mensagens de
`[flow]` e `[webhook]`, que identificam quase todos os casos acima.

---

## 8. Antes de atender cliente de verdade

- **Janela de 24h.** Fora dela você só pode iniciar conversa com *template*
  aprovado. O fluxo aqui é sempre reativo (o cliente fala primeiro), então
  funciona dentro da janela — mas retomar contato depois exige template.
- **Limites de envio.** Começa em 250 conversas/dia e sobe conforme qualidade e
  verificação do negócio.
- **Custo.** Conversas iniciadas pelo cliente têm cota gratuita mensal; acima
  disso são cobradas por conversa, com preço que varia por país.
- **LGPD.** Você passa a guardar telefone, nome e a descrição da demanda. Vale
  ter uma política de privacidade acessível e um caminho para exclusão de dados.
