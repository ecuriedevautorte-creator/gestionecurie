// Synchronisation entre les appareils des deux gérants.
//
// Le téléphone garde toujours sa propre copie complète (il marche donc sans réseau).
// Chaque saisie laisse une ligne dans le journal ; dès que le réseau est là :
//  1. on envoie les lignes pas encore envoyées (le serveur ignore celles qu'il a déjà reçues) ;
//  2. on récupère les fiches modifiées depuis la dernière fois (numéro de révision) ;
//  3. on réapplique par-dessus les saisies locales qui seraient arrivées entre-temps.

import { db } from './db';
import { TABLES_SYNCHRO, type EntreeJournal, type TableSynchro, type Trace } from './model';

export interface FicheServeur {
  table_nom: TableSynchro;
  id: string;
  donnees: Record<string, unknown>;
  revision: number;
}

export interface JournalServeur {
  id: string;
  table_nom: TableSynchro;
  fiche_id: string;
  operation: EntreeJournal['operation'];
  le: string;
  par: string;
  changements: EntreeJournal['changements'];
  revision: number;
}

/** Ce que l'application demande au serveur (Supabase en vrai, une imitation dans les tests). */
export interface Serveur {
  generation(): Promise<string>;
  toutEffacer(): Promise<string>;
  nombreFiches(): Promise<number>;
  envoyer(entrees: object[]): Promise<void>;
  fiches(apres: number, limite: number): Promise<FicheServeur[]>;
  journal(apres: number, jusqua: number, limite: number): Promise<JournalServeur[]>;
  envoyerFichier(chemin: string, contenu: Blob): Promise<void>;
  telechargerFichier(chemin: string): Promise<Blob>;
}

const LOT_ENVOI = 200;
const LOT_RECEPTION = 500;

const lire = async <T>(cle: string, defaut: T) => ((await db.reglages.get(cle))?.valeur as T | undefined) ?? defaut;
const ecrireR = (cle: string, valeur: unknown) => db.reglages.put({ cle, valeur });

const tableLocale = (t: TableSynchro) => db.table<Trace, string>(t);

/** Efface les fiches de l'appareil (pas les réglages propres à l'appareil). */
async function viderLocal(): Promise<void> {
  await db.transaction('rw', [...TABLES_SYNCHRO.map(tableLocale), db.journal, db.anomalies, db.fichiers], async () => {
    await Promise.all([...TABLES_SYNCHRO.map((t) => tableLocale(t).clear()), db.journal.clear(), db.anomalies.clear(), db.fichiers.clear()]);
  });
}

/** Prépare l'envoi de toutes les fiches de l'appareil, comme si elles venaient d'être créées. */
async function preparerEnvoiComplet(): Promise<void> {
  await db.transaction('rw', [...TABLES_SYNCHRO.map(tableLocale), db.journal, db.fichiers], async () => {
    await db.journal.clear();
    await db.fichiers.toCollection().modify({ envoye: 0 });
    for (const table of TABLES_SYNCHRO) {
      const fiches = await tableLocale(table).toArray();
      await db.journal.bulkAdd(
        fiches.map((f) => {
          const changements: EntreeJournal['changements'] = {};
          for (const [k, v] of Object.entries(f)) if (k !== 'modifieLe' && k !== 'modifiePar') changements[k] = { avant: null, apres: v ?? null };
          return { id: crypto.randomUUID(), table, ficheId: f.id, operation: 'creation', le: f.modifieLe || f.creeLe || new Date().toISOString(), par: f.modifiePar || f.creePar, changements, envoye: 0, base: 0 } satisfies EntreeJournal;
        }),
      );
    }
  });
}

/** À appeler après un import Excel : la base partagée sera remplacée au prochain passage. */
export async function demanderRemplacementServeur(): Promise<void> {
  await ecrireR('synchro.remplacer', true);
}

export interface BilanSynchro {
  envoyees: number;
  recues: number;
  reinitialise: boolean;
  fichiersEnvoyes: number;
  /** Fichiers qui n'ont pas pu partir (ils seront retentés au prochain passage). */
  fichiersEnEchec: number;
}

export async function synchroniser(serveur: Serveur): Promise<BilanSynchro> {
  const bilan: BilanSynchro = { envoyees: 0, recues: 0, reinitialise: false, fichiersEnvoyes: 0, fichiersEnEchec: 0 };

  // 0. Après un import Excel sur cet appareil : on remplace la base partagée.
  if (await lire('synchro.remplacer', false)) {
    const g = await serveur.toutEffacer();
    await preparerEnvoiComplet();
    await ecrireR('synchro.generation', g);
    await ecrireR('synchro.curseur', 0);
    await ecrireR('synchro.remplacer', false);
  }

  // 1. Même « génération » que le serveur ? Sinon (réimport ailleurs, ou premier passage), on repart de lui.
  const generation = await serveur.generation();
  const locale = await lire<string | null>('synchro.generation', null);
  if (locale !== generation) {
    if (locale === null && (await serveur.nombreFiches()) === 0 && (await db.chevaux.count()) > 0) {
      // Premier appareil connecté à une base vide : il envoie ses données.
      await preparerEnvoiComplet();
    } else {
      await viderLocal();
      bilan.reinitialise = true;
    }
    await ecrireR('synchro.generation', generation);
    await ecrireR('synchro.curseur', 0);
  }

  // 2. Envoi des documents ajoutés sur cet appareil (avant leur fiche, pour qu'ils soient là quand l'autre appareil la reçoit).
  for (const f of await db.fichiers.where('envoye').equals(0).toArray()) {
    try {
      await serveur.envoyerFichier(f.chemin, f.blob);
      await db.fichiers.update(f.chemin, { envoye: 1 });
      bilan.fichiersEnvoyes++;
    } catch (e) {
      console.error('Envoi du document impossible', f.chemin, e);
      bilan.fichiersEnEchec++;
    }
  }

  // 3. Envoi des saisies.
  for (;;) {
    const lot = (await db.journal.where('envoye').equals(0).sortBy('le')).slice(0, LOT_ENVOI);
    if (!lot.length) break;
    await serveur.envoyer(lot.map((e) => ({ id: e.id, table: e.table, ficheId: e.ficheId, operation: e.operation, le: e.le, par: e.par, changements: e.changements, base: e.base ?? 0 })));
    await db.journal.bulkUpdate(lot.map((e) => ({ key: e.id, changes: { envoye: 1 as const } })));
    bilan.envoyees += lot.length;
  }

  // 4. Réception des fiches modifiées.
  const depart = await lire('synchro.curseur', 0);
  let curseur = depart;
  for (;;) {
    const lot = await serveur.fiches(curseur, LOT_RECEPTION);
    if (!lot.length) break;
    await db.transaction('rw', [...TABLES_SYNCHRO.map(tableLocale), db.journal], async () => {
      const enAttente = await db.journal.where('envoye').equals(0).toArray();
      for (const f of lot) {
        const fiche = { ...f.donnees, id: f.id } as Trace & Record<string, unknown>;
        // une saisie faite pendant la synchronisation reste prioritaire jusqu'à son envoi
        for (const e of enAttente.filter((x) => x.ficheId === f.id).sort((a, b) => (a.le < b.le ? -1 : 1)))
          for (const [k, c] of Object.entries(e.changements)) fiche[k] = c.apres;
        await tableLocale(f.table_nom).put(fiche);
      }
    });
    curseur = lot[lot.length - 1].revision;
    bilan.recues += lot.length;
    if (lot.length < LOT_RECEPTION) break;
  }

  // 5. Historique des modifications faites sur les autres appareils (affiché sous chaque soin).
  for (let c = depart; c < curseur; ) {
    const lot = await serveur.journal(c, curseur, LOT_RECEPTION);
    if (!lot.length) break;
    const connus = new Set((await db.journal.bulkGet(lot.map((j) => j.id))).filter(Boolean).map((j) => j!.id));
    await db.journal.bulkPut(
      lot
        .filter((j) => !connus.has(j.id))
        .map((j) => ({ id: j.id, table: j.table_nom, ficheId: j.fiche_id, operation: j.operation, le: j.le, par: j.par, changements: j.changements, envoye: 1 as const })),
    );
    c = lot[lot.length - 1].revision;
    if (lot.length < LOT_RECEPTION) break;
  }

  await ecrireR('synchro.curseur', curseur);
  await ecrireR('synchro.derniere', new Date().toISOString());
  return bilan;
}
