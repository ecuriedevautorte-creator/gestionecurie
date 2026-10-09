// Toutes les saisies passent par ici : la fiche est enregistrée dans le téléphone
// et une ligne de journal garde qui a fait quoi, quand, et les anciennes valeurs.

import { db } from './db';
import type { Cheval, EntreeJournal, Soin, Trace } from './model';

type Table = EntreeJournal['table'];
const CHAMPS_TRACE = new Set(['creeLe', 'creePar', 'modifieLe', 'modifiePar']);

function differences(avant: object | undefined, apres: object): EntreeJournal['changements'] {
  const a = (avant ?? {}) as Record<string, unknown>;
  const b = apres as Record<string, unknown>;
  const changements: EntreeJournal['changements'] = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (CHAMPS_TRACE.has(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changements[k] = { avant: a[k] ?? null, apres: b[k] ?? null };
  }
  return changements;
}

async function ecrire<T extends Trace>(table: Table, fiche: T, auteur: string, operation?: EntreeJournal['operation']): Promise<T> {
  const t = db.table<T, string>(table);
  const maintenant = new Date().toISOString();
  return db.transaction('rw', [t, db.journal], async () => {
    const avant = await t.get(fiche.id);
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
    });
    return nouvelle;
  });
}

export const enregistrerSoin = (s: Soin, auteur: string) => ecrire('soins', s, auteur);
export const enregistrerCheval = (c: Cheval, auteur: string) => ecrire('chevaux', c, auteur);

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
