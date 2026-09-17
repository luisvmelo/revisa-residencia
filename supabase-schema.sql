-- Revisa Residência — esquema Supabase (projeto May)
create extension if not exists pgcrypto;

-- ---------- ASSUNTOS ----------
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  numero integer not null,
  disciplina text not null,
  assunto text not null,
  data_estudo date not null,
  estudo_realizado boolean not null default true,
  primeira_revisao_dias integer not null default 1,
  obs text not null default '',
  ajuste jsonb,
  exemplo boolean not null default false,
  criado_em date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subjects_user_numero_unique unique (user_id, numero)
);
create index if not exists subjects_user_idx on public.subjects (user_id);

-- ---------- HISTÓRICO DE REVISÕES ----------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  seq integer not null,
  numero integer not null,
  data_programada date not null,
  data_realizada date not null,
  tipo text not null check (tipo in ('QUESTOES','TEORIA','QUESTOES_POS_TEORIA','MANUTENCAO')),
  questoes integer check (questoes is null or questoes > 0),
  acertos integer check (acertos is null or acertos >= 0),
  pct numeric(5,1) check (pct is null or (pct >= 0 and pct <= 100)),
  intervalo_anterior integer,
  proximo_intervalo integer not null,
  proxima_atividade text not null check (proxima_atividade in ('QUESTOES','TEORIA','QUESTOES_POS_TEORIA','MANUTENCAO')),
  proxima_data date not null,
  streak integer not null default 0,
  faixa text,
  obs text not null default '',
  exemplo boolean not null default false,
  created_at timestamptz not null default now(),
  constraint reviews_acertos_lte_questoes check (acertos is null or questoes is null or acertos <= questoes)
);
create index if not exists reviews_user_subject_seq_idx on public.reviews (user_id, subject_id, seq);
create index if not exists reviews_user_data_idx on public.reviews (user_id, data_realizada);

-- ---------- CONFIGURAÇÕES ----------
create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  config jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- updated_at automático ----------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists subjects_set_updated_at on public.subjects;
create trigger subjects_set_updated_at before update on public.subjects
  for each row execute function public.set_updated_at();
drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------- SEGURANÇA (RLS: cada usuário só vê o que é seu) ----------
alter table public.subjects enable row level security;
alter table public.reviews  enable row level security;
alter table public.settings enable row level security;

drop policy if exists "subjects: dono" on public.subjects;
create policy "subjects: dono" on public.subjects for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "reviews: dono" on public.reviews;
create policy "reviews: dono" on public.reviews for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "settings: dono" on public.settings;
create policy "settings: dono" on public.settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.subjects, public.reviews, public.settings from anon;
grant select, insert, update, delete on public.subjects, public.reviews, public.settings to authenticated;

-- ---------- VIEW de análise (histórico com disciplina/assunto) ----------
create or replace view public.historico with (security_invoker = true) as
  select r.id, r.user_id, r.subject_id, s.numero as assunto_numero, s.disciplina, s.assunto,
         r.numero as numero_revisao, r.data_programada, r.data_realizada, r.tipo, r.questoes, r.acertos, r.pct,
         r.intervalo_anterior, r.proximo_intervalo, r.proxima_atividade, r.proxima_data, r.streak, r.faixa, r.obs,
         (r.data_realizada <= r.data_programada) as no_prazo, r.created_at
  from public.reviews r join public.subjects s on s.id = r.subject_id;
grant select on public.historico to authenticated;
