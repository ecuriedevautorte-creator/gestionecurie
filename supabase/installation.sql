-- =====================================================================
-- L'Écurie de Vautorte : base partagée entre les deux gérants
-- À coller une seule fois dans Supabase > SQL Editor, puis « Run ».
-- Le script peut être relancé sans risque : il ne supprime aucune donnée.
-- =====================================================================

-- Chaque fiche (cheval, soin, saillie, propriétaire) est une ligne : son contenu complet
-- en JSON, la date et l'auteur de la dernière modification de chaque champ, et un numéro
-- de révision qui permet à chaque téléphone de ne récupérer que ce qui a changé.
create sequence if not exists public.revision_seq;

create table if not exists public.fiches (
  table_nom text not null check (table_nom in ('chevaux', 'soins', 'saillies', 'proprietaires', 'parametres')),
  id uuid not null,
  donnees jsonb not null default '{}'::jsonb,
  horodatage jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  primary key (table_nom, id)
);
create index if not exists fiches_revision on public.fiches (revision);

-- Journal : une ligne par saisie, envoyée par les téléphones. Son identifiant est créé
-- sur le téléphone : une saisie envoyée deux fois n'est enregistrée qu'une fois.
create table if not exists public.journal (
  id uuid primary key,
  table_nom text not null,
  fiche_id uuid not null,
  operation text not null,
  le timestamptz not null,
  par text not null,
  changements jsonb not null,
  base bigint not null default 0,
  recu_le timestamptz not null default now(),
  compte uuid default auth.uid(),
  revision bigint
);
create index if not exists journal_fiche on public.journal (fiche_id);
-- mises à jour d'une installation précédente
alter table public.journal add column if not exists revision bigint;
alter table public.fiches drop constraint if exists fiches_table_nom_check;
alter table public.fiches add constraint fiches_table_nom_check
  check (table_nom in ('chevaux', 'soins', 'saillies', 'proprietaires', 'parametres'));
create index if not exists journal_revision on public.journal (revision);

-- « generation » change quand on réimporte tout le classeur : les téléphones repartent de zéro.
create table if not exists public.etat (
  cle text primary key,
  valeur text not null
);
insert into public.etat (cle, valeur) values ('generation', gen_random_uuid()::text) on conflict do nothing;

-- Applique les saisies reçues, champ par champ :
--  * la modification la plus récente d'un champ l'emporte ;
--  * si deux personnes ont modifié le même champ sans avoir vu la modification de l'autre,
--    les deux valeurs sont gardées dans « conflits » et la fiche affiche « À vérifier ».
create or replace function public.appliquer_journal(entrees jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  e jsonb;
  f public.fiches%rowtype;
  champ text;
  ch jsonb;
  marque jsonb;
  d jsonb;
  h jsonb;
  rev bigint;
  nouveaux jsonb;
  base bigint;
  nb integer := 0;
begin
  -- Une seule mise à jour à la fois : les numéros de révision suivent l'ordre d'enregistrement,
  -- donc un téléphone qui demande « tout ce qui suit la révision N » ne rate rien.
  perform pg_advisory_xact_lock(424242);
  for e in select value from jsonb_array_elements(entrees) order by (value->>'le') loop
    insert into public.journal (id, table_nom, fiche_id, operation, le, par, changements, base)
    values ((e->>'id')::uuid, e->>'table', (e->>'ficheId')::uuid, e->>'operation',
            (e->>'le')::timestamptz, e->>'par', e->'changements', coalesce((e->>'base')::bigint, 0))
    on conflict (id) do nothing;
    if not found then
      continue; -- déjà reçue
    end if;
    nb := nb + 1;
    base := coalesce((e->>'base')::bigint, 0);

    insert into public.fiches (table_nom, id) values (e->>'table', (e->>'ficheId')::uuid)
    on conflict do nothing;
    select * into f from public.fiches where table_nom = e->>'table' and id = (e->>'ficheId')::uuid for update;

    rev := nextval('public.revision_seq');
    d := f.donnees;
    h := f.horodatage;
    nouveaux := '[]'::jsonb;

    for champ, ch in select key, value from jsonb_each(e->'changements') loop
      marque := h->champ;
      if marque is not null
         and champ not in ('conflits', 'creeLe', 'creePar')
         and marque->>'par' <> e->>'par'
         and (marque->>'rev')::bigint > base
         and (d->champ) is distinct from (ch->'apres') then
        -- modification simultanée du même champ par deux personnes
        nouveaux := nouveaux || jsonb_build_array(jsonb_build_object(
          'champ', champ,
          'valeurs', jsonb_build_array(
            jsonb_build_object('par', marque->>'par', 'le', marque->>'le', 'valeur', d->champ),
            jsonb_build_object('par', e->>'par', 'le', e->>'le', 'valeur', ch->'apres'))));
      end if;
      if marque is null or (marque->>'le')::timestamptz <= (e->>'le')::timestamptz then
        d := jsonb_set(d, array[champ], coalesce(ch->'apres', 'null'::jsonb), true);
        h := jsonb_set(h, array[champ], jsonb_build_object('le', e->>'le', 'par', e->>'par', 'rev', rev), true);
      end if;
    end loop;

    if coalesce(d->>'modifieLe', '') <= e->>'le' then
      d := d || jsonb_build_object('modifieLe', e->>'le', 'modifiePar', e->>'par');
    end if;
    if jsonb_array_length(nouveaux) > 0 then
      d := jsonb_set(d, '{conflits}', coalesce(d->'conflits', '[]'::jsonb) || nouveaux, true);
    end if;

    update public.fiches set donnees = d, horodatage = h, revision = rev
    where table_nom = f.table_nom and id = f.id;
    update public.journal set revision = rev where id = (e->>'id')::uuid;
  end loop;
  return nb;
end;
$$;

-- Réimport complet du classeur : efface la base partagée (les téléphones repartent de zéro).
create or replace function public.tout_effacer()
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  g text := gen_random_uuid()::text;
begin
  delete from public.fiches where true;
  delete from public.journal where true;
  update public.etat set valeur = g where cle = 'generation';
  return g;
end;
$$;

-- Sécurité : seuls les comptes créés dans Supabase (les deux gérants) ont accès.
alter table public.fiches enable row level security;
alter table public.journal enable row level security;
alter table public.etat enable row level security;

drop policy if exists "gerants" on public.fiches;
drop policy if exists "gerants" on public.journal;
drop policy if exists "gerants" on public.etat;
create policy "gerants" on public.fiches for all to authenticated using (true) with check (true);
create policy "gerants" on public.journal for all to authenticated using (true) with check (true);
create policy "gerants" on public.etat for all to authenticated using (true) with check (true);

revoke all on public.fiches, public.journal, public.etat from anon;
revoke execute on function public.appliquer_journal(jsonb) from public, anon;
revoke execute on function public.tout_effacer() from public, anon;
grant select, insert, update, delete on public.fiches, public.journal, public.etat to authenticated;
grant usage, select on sequence public.revision_seq to authenticated;
grant execute on function public.appliquer_journal(jsonb) to authenticated;
grant execute on function public.tout_effacer() to authenticated;
