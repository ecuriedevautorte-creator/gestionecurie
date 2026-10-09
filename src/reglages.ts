import { db, useLive } from './db';
import {
  ID_PARAMETRES,
  INTERVALLES_PAR_DEFAUT,
  INTERVALLES_USAGE_PAR_DEFAUT,
  type Cheval,
  type Intervalle,
  type IntervallesParUsage,
  type TypeSoin,
  type Usage,
} from './model';

export interface ReglagesIntervalles {
  generaux: Record<string, Intervalle>;
  parUsage: IntervallesParUsage;
}

export const REGLAGES_PAR_DEFAUT: ReglagesIntervalles = { generaux: INTERVALLES_PAR_DEFAUT, parUsage: INTERVALLES_USAGE_PAR_DEFAUT };

/** Réglages partagés (Réglages › Intervalles) ; sinon valeurs validées par PAF. */
export async function lireIntervalles(): Promise<ReglagesIntervalles> {
  const p = await db.parametres.get(ID_PARAMETRES);
  return {
    generaux: { ...INTERVALLES_PAR_DEFAUT, ...(p?.intervalles ?? {}) },
    parUsage: p?.intervallesUsage ?? INTERVALLES_USAGE_PAR_DEFAUT,
  };
}

export function useIntervalles(): ReglagesIntervalles {
  return useLive(lireIntervalles, []) ?? REGLAGES_PAR_DEFAUT;
}

export const LIBELLES_INTERVALLES: Record<string, string> = {
  marechal: 'Maréchal',
  vermifuge: 'Vermifuge',
  osteo: 'Ostéopathe',
  dentiste: 'Dentiste',
  'vaccin:grippe': 'Vaccin grippe',
  'vaccin:rhinopneumonie': 'Vaccin rhinopneumonie',
  'vaccin:tetanos': 'Vaccin tétanos',
};

export const LIBELLES_USAGE: Record<Usage, string> = {
  Course: 'Course',
  'Sport compétition': 'Sport compétition',
  Loisir: 'Loisir',
  Élevage: 'Élevage / poulinière',
  Retraite: 'Retraite',
};

/** Clés de réglage concernées par un vaccin, d'après son nom (TG = tétanos + grippe). */
function clesVaccin(nom: string): string[] {
  const n = nom.toUpperCase();
  const cles: string[] = [];
  if (/GRIPPE|^TG|FLU/.test(n)) cles.push('vaccin:grippe');
  if (/RHINO/.test(n)) cles.push('vaccin:rhinopneumonie');
  if (/TET|^TG/.test(n)) cles.push('vaccin:tetanos');
  return cles;
}

function enJours(i: Intervalle): number {
  return i.unite === 'mois' ? i.valeur * 30.44 : i.unite === 'semaines' ? i.valeur * 7 : i.valeur;
}

/** Intervalle d'une clé pour un cheval : le sien, sinon celui de sa catégorie, sinon le général. */
export function intervalleDe(cle: string, cheval: Cheval | undefined, r: ReglagesIntervalles): Intervalle | undefined {
  const propre = cheval?.intervalles?.[cle as keyof NonNullable<Cheval['intervalles']>];
  if (propre) return propre;
  const categorie = cheval?.usage ? r.parUsage[cheval.usage]?.[cle] : undefined;
  return categorie ?? r.generaux[cle];
}

/** Intervalle proposé pour un nouveau soin. Pour un vaccin combiné, le plus court. Valeur 0 : pas de rappel. */
export function intervallePropose(type: TypeSoin, precision: string, cheval: Cheval | undefined, r: ReglagesIntervalles): Intervalle | null {
  const cles = type === 'vaccin' ? clesVaccin(precision) : [type];
  const possibles = cles.map((k) => intervalleDe(k, cheval, r)).filter((x): x is Intervalle => !!x && x.valeur > 0);
  if (!possibles.length) return null;
  return possibles.reduce((a, b) => (enJours(b) < enJours(a) ? b : a));
}
