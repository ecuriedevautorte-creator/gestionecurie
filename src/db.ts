import Dexie, { liveQuery, type Table } from 'dexie';
import { useEffect, useState } from 'preact/hooks';
import type { Anomalie, Cheval, EntreeJournal, Proprietaire, Saillie, Soin } from './model';
import type { ResultatImport } from './import/excel';

/** Base locale du téléphone : l'application lit et écrit toujours ici d'abord, d'où le fonctionnement hors réseau. */
export class EcurieDB extends Dexie {
  chevaux!: Table<Cheval, string>;
  soins!: Table<Soin, string>;
  saillies!: Table<Saillie, string>;
  proprietaires!: Table<Proprietaire, string>;
  anomalies!: Table<Anomalie, string>;
  reglages!: Table<{ cle: string; valeur: unknown }, string>;
  journal!: Table<EntreeJournal, string>;

  constructor() {
    super('gestion-ecurie');
    this.version(1).stores({
      chevaux: 'id, nom, modifieLe',
      soins: 'id, chevalId, type, date, modifieLe',
      saillies: 'id, jumentId, modifieLe',
      proprietaires: 'id, nom',
      anomalies: 'id',
      reglages: 'cle',
    });
    // v2 : journal de toutes les saisies (traçabilité, puis envoi au serveur à l'étape 3)
    this.version(2).stores({ journal: 'id, table, ficheId, le, envoye' });
  }
}

export const db = new EcurieDB();

/** Relit automatiquement la base à chaque changement. */
export function useLive<T>(requete: () => Promise<T>, deps: unknown[] = []): T | undefined {
  const [valeur, setValeur] = useState<T>();
  useEffect(() => {
    const abonnement = liveQuery(requete).subscribe({ next: setValeur, error: (e) => console.error(e) });
    return () => abonnement.unsubscribe();
  }, deps);
  return valeur;
}

/** Remplace toutes les données par celles d'un import Excel. */
export async function enregistrerImport(r: ResultatImport): Promise<void> {
  await db.transaction('rw', [db.chevaux, db.soins, db.saillies, db.proprietaires, db.anomalies, db.journal], async () => {
    await Promise.all([db.chevaux.clear(), db.soins.clear(), db.saillies.clear(), db.proprietaires.clear(), db.anomalies.clear(), db.journal.clear()]);
    await db.proprietaires.bulkAdd(r.proprietaires);
    await db.chevaux.bulkAdd(r.chevaux);
    await db.soins.bulkAdd(r.soins);
    await db.saillies.bulkAdd(r.saillies);
    await db.anomalies.bulkAdd(r.anomalies);
  });
}

export async function lireReglage<T>(cle: string, defaut: T): Promise<T> {
  const r = await db.reglages.get(cle);
  return (r?.valeur as T) ?? defaut;
}

export async function ecrireReglage(cle: string, valeur: unknown): Promise<void> {
  await db.reglages.put({ cle, valeur });
}
