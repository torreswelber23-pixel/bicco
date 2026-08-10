-- Camada de API pública: chaves de acesso e webhooks de saída.
--
-- Até aqui o WhatsApp conectado só era usado pelo próprio app. Estas duas
-- tabelas o transformam em serviço: plataformas externas (um CRM, por
-- exemplo) autenticam com uma chave e recebem os eventos por webhook.

-- --------------------------------------------------------------- api_keys
create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,                 -- quem usa esta chave ("CRM barbearia")
  -- Só o hash. Uma chave vazada no banco não serve para chamar a API, e a
  -- chave em claro existe uma única vez: no momento em que é criada.
  key_hash     text not null unique,
  -- Primeiros caracteres, para o painel identificar a chave sem revelá-la.
  prefixo      text not null,
  escopos      text[] not null default array['messages:send','messages:read','contacts:read','orders:read','orders:write'],
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists api_keys_hash_idx on public.api_keys (key_hash)
  where revoked_at is null;

comment on column public.api_keys.key_hash is
  'SHA-256 da chave. A comparação é feita por hash, nunca pelo valor original.';

-- ------------------------------------------------------- webhook_endpoints
create table if not exists public.webhook_endpoints (
  id          uuid primary key default gen_random_uuid(),
  api_key_id  uuid references public.api_keys (id) on delete cascade,
  url         text not null,
  -- Assina cada entrega em X-Bicco-Signature, para o destino provar que o
  -- evento veio daqui e não de quem descobriu a URL.
  secret      text not null,
  eventos     text[] not null default array['message.received','order.created','order.assigned','order.completed'],
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  -- Diagnóstico: falha silenciosa em webhook é o pior modo de erro possível,
  -- porque o outro lado simplesmente para de receber sem ninguém perceber.
  last_error  text,
  last_sent_at timestamptz
);

create index if not exists webhook_endpoints_ativo_idx
  on public.webhook_endpoints (ativo) where ativo;

-- --------------------------------------------------------------------- RLS
-- Mesmo padrão do resto do esquema: só o backend com service role entra.
alter table public.api_keys          enable row level security;
alter table public.webhook_endpoints enable row level security;
