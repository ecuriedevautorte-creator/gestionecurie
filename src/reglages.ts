import { db, useLive } from './db';
import { INTERVALLES_PAR_DEFAUT, type Cheval, type Intervalle, type TypeSoin } from './model';

/** Réglages modifiables dans l'écran Réglages ; sinon valeurs validées par PAF. */
export function useIntervalles(): Record<string, Intervalle> {
  const r = useLive(async () => (await db.reglages.get('intervalles'))?.valeur as Record<string, Intervalle> | undefined, []);
  return { ...INTERVALLES_PAR_DEFAUT, ...(r ?? {}) };
}

export const LIBELLES_INTERVALLES: Record<string, string> = {
  marechal: 'Maréchal',
  vermifuge: 'Vermifuge',
  osteo: 'Ostéopathe',
  dentiste: 'Dentiste',
  'vaccin:grippe': 'Vaccin grippe (loisir, élevage, retraite)',
  'vaccin:grippe-competition': 'Vaccin grippe (course, compétition)',
  'vaccin:rhinopneumonie': 'Vaccin rhinopneumonie',
  'vaccin:tetanos': 'Vaccin tétanos',
};

/** Clés de réglage concernées par un vaccin, d'après son nom (TG = tétanos + grippe). */
function clesVaccin(nom: string, cheval: Cheval | undefined): string[] {
  const n = nom.toUpperCase();
  const cles: string[] = [];
  const competition = cheval?.usage === 'Course' || cheval?.usage === 'Sport compétition';
  if (/GRIPPE|^TG|FLU/.test(n)) cles.push(competition ? 'vaccin:grippe-competition' : 'vaccin:grippe');
  if (/RHINO/.test(n)) cles.push('vaccin:rhinopneumonie');
  if (/TET|^TG/.test(n)) cles.push('vaccin:tetanos');
  return cles;
}

function enJours(i: Intervalle): number {
  return i.unite === 'mois' ? i.valeur * 30.44 : i.unite === 'semaines' ? i.valeur * 7 : i.valeur;
}

/** Intervalle proposé pour un nouveau soin : réglage du cheval, sinon réglage général. Pour un vaccin combiné, le plus court. */
export function intervallePropose(type: TypeSoin, precision: string, cheval: Cheval | undefined, generaux: Record<string, Intervalle>): Intervalle | null {
  const cles = type === 'vaccin' ? clesVaccin(precision, cheval) : [type];
  const possibles = cles
    .map((k) => cheval?.intervalles?.[k as keyof NonNullable<Cheval['intervalles']>] ?? generaux[k])
    .filter((x): x is Intervalle => !!x);
  if (!possibles.length) return null;
  return possibles.reduce((a, b) => (enJours(b) < enJours(a) ? b : a));
}
