// Toutes les dates sont stockées en texte « AAAA-MM-JJ » (sans heure ni fuseau)
// et affichées au format JJ/MM/AAAA.

export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function versISO(annee: number, mois: number, jour: number): ISODate {
  return `${String(annee).padStart(4, '0')}-${pad(mois)}-${pad(jour)}`;
}

export function aujourdhui(maintenant = new Date()): ISODate {
  return versISO(maintenant.getFullYear(), maintenant.getMonth() + 1, maintenant.getDate());
}

function parts(d: ISODate): [number, number, number] {
  const [a, m, j] = d.split('-').map(Number);
  return [a, m, j];
}

export function formater(d: ISODate | null | undefined): string {
  if (!d) return '';
  const [a, m, j] = parts(d);
  return `${pad(j)}/${pad(m)}/${a}`;
}

/** Lit « JJ/MM/AAAA » (ou J/M/AA). Renvoie null si le texte n'est pas une date. */
export function lireDateFr(texte: string): { annee: number; mois: number; jour: number } | null {
  const m = texte.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return null;
  const jour = Number(m[1]);
  const mois = Number(m[2]);
  let annee = Number(m[3]);
  if (m[3].length === 2) annee += 2000;
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return null;
  return { annee, mois, jour };
}

function versUTC(d: ISODate): number {
  const [a, m, j] = parts(d);
  return Date.UTC(a, m - 1, j);
}

function depuisUTC(ms: number): ISODate {
  const x = new Date(ms);
  return versISO(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}

export function ajouterJours(d: ISODate, n: number): ISODate {
  return depuisUTC(versUTC(d) + n * 86400000);
}

/** Comme MOIS.DECALER (EDATE) d'Excel : le 31/01 + 1 mois donne le 28 ou 29/02. */
export function ajouterMois(d: ISODate, n: number): ISODate {
  const [a, m, j] = parts(d);
  const total = a * 12 + (m - 1) + n;
  const annee = Math.floor(total / 12);
  const mois = (total % 12) + 1;
  const dernierJour = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return versISO(annee, mois, Math.min(j, dernierJour));
}

export function ecartJours(de: ISODate, a: ISODate): number {
  return Math.round((versUTC(a) - versUTC(de)) / 86400000);
}

export function ageEnAnnees(naissance: ISODate, ref: ISODate): number {
  const [an, mn, jn] = parts(naissance);
  const [ar, mr, jr] = parts(ref);
  let age = ar - an;
  if (mr < mn || (mr === mn && jr < jn)) age--;
  return age;
}

export function annee(d: ISODate): number {
  return parts(d)[0];
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function moisEnLettres(d: ISODate): string {
  const [a, m] = parts(d);
  return `${MOIS[m - 1]} ${a}`;
}
