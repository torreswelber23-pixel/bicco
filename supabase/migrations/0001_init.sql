-- Esquema base do atendimento automatizado via WhatsApp Flows.
--
-- Três entidades: quem falou com a gente (contacts), o que foi trocado
-- (messages, útil para auditoria) e a demanda captada pelo Flow (leads).
-- flow_sessions liga o token efêmero do Flow ao contato que o abriu.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- contacts
create table if not exists public.contacts (
  id            uuid primary key default gen_random_uuid(),
  wa_id         text not null unique,          -- telefone em formato E.164 sem "+"
  profile_name  text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

comment on column public.contacts.wa_id is
  'Identificador do WhatsApp: telefone E.164 sem o sinal de +.';

-- ---------------------------------------------------------------- messages
create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references public.contacts (id) on delete cascade,
  wa_message_id text unique,                   -- nulo para mensagens que nós enviamos e ainda não confirmamos
  direction     text not null check (direction in ('inbound', 'outbound')),
  type          text not null,                 -- text, interactive, image, nfm_reply...
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists messages_contact_created_idx
  on public.messages (contact_id, created_at desc);

-- ----------------------------------------------------------- flow_sessions
create table if not exists public.flow_sessions (
  id          uuid primary key default gen_random_uuid(),
  flow_token  text not null unique,
  contact_id  uuid not null references public.contacts (id) on delete cascade,
  status      text not null default 'open'
                check (status in ('open', 'completed', 'abandoned')),
  -- Respostas acumuladas tela a tela: cada data_exchange traz só os campos da
  -- tela atual, então o estado parcial da sessão precisa viver no servidor.
  draft       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.flow_sessions is
  'O flow_token é gerado por nós ao enviar a mensagem e volta em cada chamada '
  'do endpoint de dados, permitindo saber de quem é a sessão sem confiar no cliente.';

-- ------------------------------------------------------------------- leads
create table if not exists public.leads (
  id                uuid primary key default gen_random_uuid(),
  contact_id        uuid not null references public.contacts (id) on delete cascade,
  flow_token        text,
  nome              text,
  tipo_servico      text,
  descricao         text,
  urgencia          text,
  orcamento         text,
  canal_preferido   text,
  data_preferida    date,
  horario_preferido text,
  status            text not null default 'novo'
                      check (status in ('novo', 'em_contato', 'ganho', 'perdido')),
  raw               jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (status);

-- --------------------------------------------------------------------- RLS
-- Todo acesso passa pelo backend com a service role key, que ignora RLS.
-- Ligamos RLS sem criar policies para que chaves públicas (anon) não leiam nada.
alter table public.contacts      enable row level security;
alter table public.messages      enable row level security;
alter table public.flow_sessions enable row level security;
alter table public.leads         enable row level security;
