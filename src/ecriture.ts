// Toutes les saisies passent par ici : la fiche est enregistrée dans le téléphone
// et une ligne de journal garde qui a fait quoi, quand, et les anciennes valeurs.

import { db } from './db';
import { ID_PARAMETRES, type Cheval, type DocumentCheval, type EntreeJournal, type Parametres, type Proprietaire, type Soin, type Trace } from './model';

type Table = EntreeJournal['table'];
// modifieLe / modifiePar sont recalculés par le serveur ; creeLe / creePar ne partent qu'à la création.
const CHAMPS_TRACE = new Set(['creeLe', 'creePar', 'modifieLe', 'modifiePar']);
const CHAMPS_CREATION = new Set(['modifieLe', 'modifiePar']);

export function differences(avant: object | undefined, apres: object): EntreeJournal['changements'] {
  const a = (avant ?? {}) as Record<string, unknown>;
  const b = apres as Record<string, unknown>;
  const ignores = avant ? CHAMPS_TRACE : CHAMPS_CREATION;
  const changements: EntreeJournal['changements'] = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (ignores.has(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changements[k] = { avant: a[k] ?? null, apres: b[k] ?? null };
  }
  return changements;
}

async function ecrire<T extends Trace>(table: Table, fiche: T, auteur: string, operation?: EntreeJournal['operation']): Promise<T> {
  const t = db.table<T, string>(table);
  const maintenant = new Date().toISOString();
  return db.transaction('rw', [t, db.journal, db.reglages], async () => {
    const avant = await t.get(fiche.id);
    const base = ((await db.reglages.get('synchro.curseur'))?.valeur as number | undefined) ?? 0;
    const nouvelle: T = avant
      ? { ...fiche, creeLe: avant.creeLe, creePar: avant.creePar, modifieLe: maintenant, modifiePar: auteur }
      : { ...fiche, creeLe: maintenant, creePar: auteur, modifieLe: maintenant, modifiePar: auteur };
    const changements = differences(avant, nouvelle);
    if (avant && Object.keys(changements).length === 0) return avant;
    await t.put(nouvelle);
    await db.journal.add({
      id: crypto.randomUUID(),
      table,
      ficheId: fiche.id,
      operation: operation ?? (avant ? 'modification' : 'creation'),
      le: maintenant,
      par: auteur,
      changements,
      envoye: 0,
      base,
    });
    return nouvelle;
  });
}

export const enregistrerSoin = (s: Soin, auteur: string) => ecrire('soins', s, auteur);
export const enregistrerCheval = (c: Cheval, auteur: string) => ecrire('chevaux', c, auteur);
export const ecrireDocument = (d: DocumentCheval, auteur: string, operation?: EntreeJournal['operation']) => ecrire('documents', d, auteur, operation);
export const enregistrerProprietaire = (p: Proprietaire, auteur: string) => ecrire('proprietaires', p, auteur);

export async function enregistrerParametres(modifs: Partial<Pick<Parametres, 'intervalles' | 'intervallesUsage' | 'plan' | 'paddocksInitialises' | 'paddocksCorrection7'>>, auteur: string): Promise<void> {
  const actuel = await db.parametres.get(ID_PARAMETRES);
  const p: Parametres = {
    ...(actuel ?? { id: ID_PARAMETRES, creeLe: '', creePar: '', modifieLe: '', modifiePar: '', intervalles: {}, intervallesUsage: {} }),
    ...modifs,
  };
  await ecrire('parametres', p, auteur);
}

/** Valide l'une des valeurs d'un conflit : elle devient la valeur du champ, et le conflit disparaît. */
export async function trancherConflit(table: Table, id: string, champ: string, valeur: unknown, auteur: string): Promise<void> {
  const t = db.table<Trace, string>(table);
  const f = await t.get(id);
  if (!f) return;
  const conflits = (f.conflits ?? []).filter((c) => c.champ !== champ);
  await ecrire(table, { ...f, [champ]: valeur, conflits }, auteur);
}

/** Met en corbeille (récupérable pendant 30 jours). */
export async function supprimerSoin(id: string, auteur: string): Promise<void> {
  const s = await db.soins.get(id);
  if (s) await ecrire('soins', { ...s, supprimeLe: new Date().toISOString() }, auteur, 'suppression');
}

export async function restaurerSoin(id: string, auteur: string): Promise<void> {
  const s = await db.soins.get(id);
  if (s) await ecrire('soins', { ...s, supprimeLe: null }, auteur, 'restauration');
}

export function nouvelId(): string {
  return crypto.randomUUID();
}
