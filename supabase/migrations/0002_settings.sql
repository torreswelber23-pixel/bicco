-- Configurações persistidas em runtime, incluindo as credenciais obtidas
-- via OAuth com a Meta.
--
-- Por que no banco e não em variável de ambiente: o token do WhatsApp passa a
-- ser obtido por login (OAuth) e renovado periodicamente. Variável de ambiente
-- só muda com redeploy, o que inviabiliza renovação automática.

create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.settings is
  'Chave-valor para configuração de runtime. Chaves em uso: '
  'whatsapp_credentials (token, phoneNumberId, wabaId) e '
  'whatsapp_token_metadata (validade, origem, se é long-lived).';

-- Guarda segredo: só o backend com service role pode ler.
alter table public.settings enable row level security;
