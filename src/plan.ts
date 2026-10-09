// Emplacements du plan « aménagement extérieur » de l'écurie (positions en % de l'image, mesurées sur le PDF).
import { db } from './db';
import { enregistrerCheval, enregistrerParametres } from './ecriture';
import { cleNom } from './import/excel';
import { ID_PARAMETRES } from './model';

export interface Emplacement {
  id: string;
  nom: string;
  x: number;
  y: number;
}

export const EMPLACEMENTS: Emplacement[] = [
  { id: 'paddock-1', nom: 'Paddock 1', x: 61.0, y: 14.6 },
  { id: 'paddock-2', nom: 'Paddock 2', x: 52.6, y: 27.9 },
  { id: 'paddock-3', nom: 'Paddock 3', x: 50.4, y: 47.6 },
  { id: 'paddock-4', nom: 'Paddock 4', x: 65.0, y: 29.6 },
  { id: 'paddock-5', nom: 'Paddock 5', x: 63.2, y: 45.0 },
  { id: 'paddock-6', nom: 'Paddock 6', x: 76.0, y: 63.5 },
  { id: 'paddock-7', nom: 'Paddock 7', x: 57.1, y: 65.6 },
  { id: 'paddock-8', nom: 'Paddock 8', x: 51.6, y: 59.0 },
  { id: 'paddock-9', nom: 'Paddock 9', x: 59.1, y: 6.4 },
  { id: 'paddock-10', nom: 'Paddock 10', x: 25.7, y: 49.7 },
  { id: 'paddock-11', nom: 'Paddock 11', x: 79.0, y: 5.6 },
  { id: 'paddock-12', nom: 'Paddock 12', x: 80.5, y: 17.2 },
  { id: 'paddocks-poulain', nom: 'Paddocks poulain', x: 73.9, y: 30.0 },
  { id: 'pre-la-pointe', nom: 'Pré « La Pointe »', x: 34.1, y: 38.4 },
  { id: 'pre-la-butte', nom: 'Pré « La Butte »', x: 69.5, y: 79.8 },
  { id: 'box', nom: 'Box', x: 79.0, y: 47.1 },
];

export const nomEmplacement = (id: string | null | undefined) => EMPLACEMENTS.find((e) => e.id === id)?.nom ?? '';

/** Répartition donnée par PAF le 09/10/2026, appliquée une seule fois (drapeau partagé dans les réglages). */
const REPARTITION_INITIALE: Record<string, string[]> = {
  'paddock-5': ['QUERCUS', 'QUILLAC', 'VELEDA', 'SENGA', 'ORTENSE'],
  'paddock-6': ['QONTADOR', 'OBBY'],
  'paddock-3': ['ROSEE', 'OLE', 'VALINO'],
  'paddock-2': ['SHONEN', 'CHAVETA'],
  'paddock-12': ['BERLINGOT', 'NENETTE', 'BRADY', 'MONA'],
};

export async function appliquerRepartitionInitiale(auteur: string): Promise<number> {
  const p = await db.parametres.get(ID_PARAMETRES);
  if (p?.paddocksInitialises) return 0;
  const chevaux = (await db.chevaux.toArray()).filter((c) => !c.supprimeLe && !c.sortie);
  if (!chevaux.length) return 0;
  let n = 0;
  for (const [emplacement, debuts] of Object.entries(REPARTITION_INITIALE))
    for (const debut of debuts) {
      const trouves = chevaux.filter((c) => cleNom(c.nom).startsWith(debut));
      if (trouves.length === 1 && !trouves[0].paddock) {
        await enregistrerCheval({ ...trouves[0], paddock: emplacement }, auteur);
        n++;
      }
    }
  await enregistrerParametres({ paddocksInitialises: true }, auteur);
  return n;
}
