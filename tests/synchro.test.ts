// Synchronisation entre deux appareils, contre une vraie base PostgreSQL avec le script supabase/installation.sql.
// Lancé seulement si PG_ESSAI donne l'adresse d'un serveur PostgreSQL jetable, par exemple :
//   PG_ESSAI=postgres://postgres@localhost:5433/postgres npx vitest run tests/synchro.test.ts
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { changerDeBase, db } from '../src/db';
import { enregistrerCheval, enregistrerSoin, trancherConflit } from '../src/ecriture';
import type { Cheval, Soin } from '../src/model';
import { demanderRemplacementServeur, synchroniser, type Serveur } from '../src/synchro';

const ADRESSE = process.env.PG_ESSAI;
const BASE = `essai_synchro_${process.pid}`;

let admin: pg.Client;
let client: pg.Client;

const serveur: Serveur = {
  async generation() {
    return (await client.query(`select valeur from etat where cle = 'generation'`)).rows[0].valeur;
  },
  async toutEffacer() {
    return (await client.query('select tout_effacer() g')).rows[0].g;
  },
  async nombreFiches() {
    return (await client.query('select count(*)::int n from fiches')).rows[0].n;
  },
  async envoyer(entrees) {
    await client.query('select appliquer_journal($1::jsonb)', [JSON.stringify(entrees)]);
  },
  async fiches(apres, limite) {
    return (await client.query('select table_nom, id, donnees, revision::int from fiches where revision > $1 order by revision limit $2', [apres, limite])).rows;
  },
  async journal(apres, jusqua, limite) {
    return (
      await client.query(
        `select id, table_nom, fiche_id, operation, to_char(le at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') le, par, changements, revision::int
         from journal where revision > $1 and revision <= $2 order by revision limit $3`,
        [apres, jusqua, limite],
      )
    ).rows;
  },
};

const PA = changerDeBase('appareil-pa');
const CHLOE = changerDeBase('appareil-chloe');
const sur = (appareil: typeof PA) => changerDeBase(appareil.name);

let horloge = Date.parse('2026-10-09T10:00:00Z');
const tic = () => vi.setSystemTime((horloge += 60_000));

const cheval = (id: string, nom: string): Cheval => ({
  id, creeLe: '', creePar: '', modifieLe: '', modifiePar: '', nom, sexe: 'Femelle', robe: 'Bai', race: 'Trotteur', naissance: null, pere: '', mere: '',
  proprietaireId: null, sire: '', transpondeur: '', entree: '2026-01-01', sortie: null, motifSortie: '', destination: '', notes: '', usage: null,
});
const soin = (id: string, chevalId: string, date: string): Soin => ({
  id, creeLe: '', creePar: '', modifieLe: '', modifiePar: '', type: 'marechal', chevalId, date, precision: 'Parage', praticien: '', motif: '', cout: 30,
  intervalle: { valeur: 4, unite: 'mois' }, prochaineManuelle: null, lienFacture: '', details: {},
});
const QUERCUS = '11111111-1111-4111-8111-111111111111';
const VELEDA = '22222222-2222-4222-8222-222222222222';

describe.skipIf(!ADRESSE)('synchronisation entre deux appareils', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    tic();
    admin = new pg.Client({ connectionString: ADRESSE });
    await admin.connect();
    await admin.query(`drop database if exists ${BASE}`);
    await admin.query(`create database ${BASE}`);
    const url = new URL(ADRESSE!);
    url.pathname = `/${BASE}`;
    client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    await client.query(`do $$ begin create role anon; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
      create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
      grant usage on schema auth to authenticated, anon;`);
    await client.query(readFileSync('supabase/installation.sql', 'utf8'));
    await client.query('set role authenticated');
  });
  afterAll(async () => {
    await client?.end();
    await admin?.query(`drop database if exists ${BASE}`);
    await admin?.end();
    vi.useRealTimers();
  });

  it("le premier appareil connecté envoie ses données, le second les reçoit", async () => {
    sur(PA);
    await enregistrerCheval(cheval(QUERCUS, 'QUERCUS DE VAUTORTE'), 'Pierre-Alexandre');
    await enregistrerSoin(soin('33333333-3333-4333-8333-333333333333', QUERCUS, '2026-09-01'), 'Pierre-Alexandre');
    // données importées avant la synchro : le journal ne les connaît pas
    await db.journal.clear();
    expect((await synchroniser(serveur)).envoyees).toBe(2);

    sur(CHLOE);
    await enregistrerCheval(cheval(VELEDA, 'DONNEE LOCALE A JETER'), 'Chloé');
    const bilan = await synchroniser(serveur);
    expect(bilan.reinitialise).toBe(true);
    expect((await db.chevaux.toArray()).map((c) => c.nom)).toEqual(['QUERCUS DE VAUTORTE']);
    expect((await db.soins.count())).toBe(1);
    expect((await db.chevaux.get(QUERCUS))!.creePar).toBe('Pierre-Alexandre');
  });

  it('saisies des deux côtés, hors ligne, puis tout se retrouve partout', async () => {
    sur(CHLOE);
    tic();
    await enregistrerSoin(soin('44444444-4444-4444-8444-444444444444', QUERCUS, '2026-10-09'), 'Chloé');
    sur(PA);
    tic();
    const q = (await db.chevaux.get(QUERCUS))!;
    await enregistrerCheval({ ...q, notes: 'Boite antérieur gauche' }, 'Pierre-Alexandre');
    tic();
    await enregistrerCheval(cheval(VELEDA, 'VELEDA'), 'Pierre-Alexandre');

    await synchroniser(serveur);
    sur(CHLOE);
    await synchroniser(serveur);
    sur(PA);
    await synchroniser(serveur);

    for (const appareil of [PA, CHLOE]) {
      sur(appareil);
      expect((await db.chevaux.toArray()).map((c) => c.nom).sort()).toEqual(['QUERCUS DE VAUTORTE', 'VELEDA']);
      expect(await db.soins.count()).toBe(2);
      expect((await db.chevaux.get(QUERCUS))!.notes).toBe('Boite antérieur gauche');
      expect((await db.chevaux.get(QUERCUS))!.modifiePar).toBe('Pierre-Alexandre');
    }
    // l'historique du soin de Chloé est visible sur l'appareil de Pierre-Alexandre
    sur(PA);
    expect((await db.journal.where('ficheId').equals('44444444-4444-4444-8444-444444444444').first())?.par).toBe('Chloé');
  });

  it('une saisie envoyée deux fois ne crée pas de doublon', async () => {
    sur(PA);
    const avant = (await client.query('select count(*)::int n from journal')).rows[0].n;
    await db.journal.toCollection().modify({ envoye: 0 });
    await synchroniser(serveur);
    expect((await client.query('select count(*)::int n from journal')).rows[0].n).toBe(avant);
    expect((await client.query('select count(*)::int n from fiches')).rows[0].n).toBe(4);
  });

  it('même champ modifié des deux côtés sans réseau : la plus récente gagne et la fiche passe « À vérifier »', async () => {
    sur(PA);
    tic();
    await enregistrerCheval({ ...(await db.chevaux.get(VELEDA))!, robe: 'Alezan' }, 'Pierre-Alexandre');
    sur(CHLOE);
    tic();
    await enregistrerCheval({ ...(await db.chevaux.get(VELEDA))!, robe: 'Gris', race: 'Selle Français' }, 'Chloé');

    sur(PA);
    await synchroniser(serveur);
    sur(CHLOE);
    await synchroniser(serveur);
    sur(PA);
    await synchroniser(serveur);

    for (const appareil of [PA, CHLOE]) {
      sur(appareil);
      const v = (await db.chevaux.get(VELEDA))!;
      expect(v.robe).toBe('Gris');
      expect(v.race).toBe('Selle Français');
      expect(v.conflits?.map((c) => [c.champ, c.valeurs.map((x) => `${x.par}:${x.valeur}`).sort()])).toEqual([['robe', ['Chloé:Gris', 'Pierre-Alexandre:Alezan']]]);
    }

    // Pierre-Alexandre tranche : Alezan
    sur(PA);
    tic();
    await trancherConflit('chevaux', VELEDA, 'robe', 'Alezan', 'Pierre-Alexandre');
    await synchroniser(serveur);
    sur(CHLOE);
    await synchroniser(serveur);
    for (const appareil of [PA, CHLOE]) {
      sur(appareil);
      const v = (await db.chevaux.get(VELEDA))!;
      expect([v.robe, v.conflits]).toEqual(['Alezan', []]);
    }
  });

  it("un réimport Excel sur un appareil remplace les données de l'autre", async () => {
    sur(CHLOE);
    await db.transaction('rw', [db.chevaux, db.soins, db.journal], async () => {
      await Promise.all([db.chevaux.clear(), db.soins.clear(), db.journal.clear()]);
      await db.chevaux.add({ ...cheval('55555555-5555-4555-8555-555555555555', 'NOUVEL IMPORT'), creeLe: new Date().toISOString(), creePar: 'Chloé (import Excel)' });
    });
    await demanderRemplacementServeur();
    await synchroniser(serveur);

    sur(PA);
    const bilan = await synchroniser(serveur);
    expect(bilan.reinitialise).toBe(true);
    expect((await db.chevaux.toArray()).map((c) => c.nom)).toEqual(['NOUVEL IMPORT']);
    expect(await db.soins.count()).toBe(0);
  });
});
