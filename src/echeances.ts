import { ajouterJours, ajouterMois, ecartJours, type ISODate } from './dates';
import { estPresent, LIBELLES_SOIN, type Cheval, type CleEcheance, type Intervalle, type Soin } from './model';

export type Statut = 'EN RETARD' | 'BIENTÔT' | 'OK' | 'FAIT';

export interface Echeance {
  cheval: Cheval;
  cle: CleEcheance;
  libelle: string;
  soin: Soin;
  prochaine: ISODate;
  statut: Exclude<Statut, 'FAIT'>;
  /** Jours restants (négatif = jours de retard). */
  joursRestants: number;
}

export function ajouterIntervalle(d: ISODate, i: Intervalle): ISODate {
  if (i.unite === 'mois') return ajouterMois(d, i.valeur);
  if (i.unite === 'semaines') return ajouterJours(d, i.valeur * 7);
  return ajouterJours(d, i.valeur);
}

export function cleEcheance(s: Soin): CleEcheance | null {
  switch (s.type) {
    case 'marechal':
    case 'vermifuge':
    case 'osteo':
    case 'dentiste':
      return s.type;
    case 'vaccin':
      return `vaccin:${s.precision.trim().toUpperCase() || 'AUTRE'}`;
    case 'veterinaire':
      return s.prochaineManuelle ? 'veterinaire' : null;
    case 'ordonnance':
      return null;
  }
}

export function libelleCle(cle: CleEcheance): string {
  if (cle.startsWith('vaccin:')) return `Vaccin ${cle.slice(7)}`;
  if (cle === 'veterinaire') return 'RDV vétérinaire';
  return LIBELLES_SOIN[cle as keyof typeof LIBELLES_SOIN];
}

export function prochaineDate(s: Soin): ISODate | null {
  if (s.prochaineManuelle) return s.prochaineManuelle;
  if (s.intervalle && s.intervalle.valeur > 0) return ajouterIntervalle(s.date, s.intervalle);
  return null;
}

/** EN RETARD si l'échéance est dépassée ; BIENTÔT dans les 14 jours (maréchal) ou 7 jours (autres). */
export function statutDe(prochaine: ISODate, cle: CleEcheance, ref: ISODate): Exclude<Statut, 'FAIT'> {
  const reste = ecartJours(ref, prochaine);
  if (reste < 0) return 'EN RETARD';
  const seuil = cle === 'marechal' ? 14 : 7;
  return reste <= seuil ? 'BIENTÔT' : 'OK';
}

function plusRecent(a: Soin, b: Soin): Soin {
  if (a.date !== b.date) return a.date > b.date ? a : b;
  return a.creeLe >= b.creeLe ? a : b;
}

/** Garde, pour chaque cheval et chaque clé, le soin le plus récent. */
function derniersSoins(soins: Soin[]): Map<string, Soin> {
  const derniers = new Map<string, Soin>();
  for (const s of soins) {
    if (s.supprimeLe) continue;
    const cle = cleEcheance(s);
    if (!cle) continue;
    const k = `${s.chevalId}|${cle}`;
    const actuel = derniers.get(k);
    derniers.set(k, actuel ? plusRecent(actuel, s) : s);
  }
  return derniers;
}

/** Échéances en cours. Un cheval sorti ne génère plus d'alerte. */
export function calculerEcheances(chevaux: Cheval[], soins: Soin[], ref: ISODate): Echeance[] {
  const parId = new Map(chevaux.map((c) => [c.id, c]));
  const resultat: Echeance[] = [];
  for (const [k, soin] of derniersSoins(soins)) {
    const cheval = parId.get(soin.chevalId);
    if (!cheval || cheval.supprimeLe || !estPresent(cheval, ref)) continue;
    const prochaine = prochaineDate(soin);
    if (!prochaine) continue;
    const cle = k.split('|')[1] as CleEcheance;
    resultat.push({
      cheval,
      cle,
      libelle: soin.type === 'vaccin' && soin.precision ? `Vaccin ${soin.precision}` : libelleCle(cle),
      soin,
      prochaine,
      statut: statutDe(prochaine, cle, ref),
      joursRestants: ecartJours(ref, prochaine),
    });
  }
  return resultat.sort((a, b) => (a.prochaine < b.prochaine ? -1 : a.prochaine > b.prochaine ? 1 : 0));
}

/** Statut affiché à côté d'un soin dans l'historique : seuls les plus récents ont un statut, les autres sont FAIT. */
export function statutDuSoin(soin: Soin, tous: Soin[], cheval: Cheval, ref: ISODate): Statut | null {
  const cle = cleEcheance(soin);
  if (!cle) return null;
  const dernier = derniersSoins(tous.filter((s) => s.chevalId === soin.chevalId)).get(`${soin.chevalId}|${cle}`);
  if (dernier && dernier.id !== soin.id) return 'FAIT';
  const prochaine = prochaineDate(soin);
  if (!prochaine || !estPresent(cheval, ref)) return null;
  return statutDe(prochaine, cle, ref);
}

export function statutOrdonnance(s: Soin, ref: ISODate): 'En cours' | 'Terminé' | null {
  const duree = Number(s.details.dureeJours);
  if (!duree) return null;
  return ref > ajouterJours(s.date, duree) ? 'Terminé' : 'En cours';
}
