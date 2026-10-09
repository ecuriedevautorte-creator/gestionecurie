import type { ISODate } from './dates';

/** Champs communs à chaque fiche : servent à la traçabilité et, plus tard, à la synchronisation. */
export interface Trace {
  id: string;
  creeLe: string;
  creePar: string;
  modifieLe: string;
  modifiePar: string;
  supprimeLe?: string | null;
  /** Points signalés à l'import ou par un conflit, affichés en bandeau « À vérifier ». */
  aVerifier?: string[];
  /** D'où vient la fiche, par exemple « Excel, Maréchal ligne 15 ». */
  source?: string;
}

export type Sexe = 'Mâle' | 'Femelle' | 'Hongre' | '';

export const USAGES = ['Course', 'Sport compétition', 'Loisir', 'Élevage', 'Retraite'] as const;
export type Usage = (typeof USAGES)[number];

export interface Proprietaire extends Trace {
  nom: string;
  adresse: string;
}

export interface Intervalle {
  valeur: number;
  unite: 'jours' | 'semaines' | 'mois';
}

export interface Cheval extends Trace {
  nom: string;
  sexe: Sexe;
  robe: string;
  race: string;
  naissance: ISODate | null;
  /** Vrai quand seule l'année de naissance est connue (saisie au 01/01 dans l'Excel). */
  naissanceAnneeSeule?: boolean;
  pere: string;
  mere: string;
  proprietaireId: string | null;
  sire: string;
  transpondeur: string;
  entree: ISODate | null;
  sortie: ISODate | null;
  motifSortie: string;
  destination: string;
  notes: string;
  usage: Usage | null;
  /** Intervalles propres à ce cheval, prioritaires sur les réglages généraux. */
  intervalles?: Partial<Record<CleEcheance, Intervalle>>;
}

export type TypeSoin = 'veterinaire' | 'ordonnance' | 'marechal' | 'osteo' | 'dentiste' | 'vaccin' | 'vermifuge';

export const LIBELLES_SOIN: Record<TypeSoin, string> = {
  veterinaire: 'Vétérinaire',
  ordonnance: 'Ordonnance',
  marechal: 'Maréchal',
  osteo: 'Ostéopathe',
  dentiste: 'Dentiste',
  vaccin: 'Vaccin',
  vermifuge: 'Vermifuge',
};

export interface Soin extends Trace {
  type: TypeSoin;
  chevalId: string;
  date: ISODate;
  /** Précision du type : Ferrure / Parage, nom du vaccin, médicament… */
  precision: string;
  praticien: string;
  motif: string;
  cout: number | null;
  intervalle: Intervalle | null;
  /** Prochaine échéance saisie à la main (ex. prochain RDV vétérinaire) ; sinon calculée. */
  prochaineManuelle: ISODate | null;
  lienFacture: string;
  /** Champs propres au type (diagnostic, traitement, posologie, durée…). */
  details: Record<string, string | number | null>;
}

export interface Echographie {
  date: ISODate | null;
  observation: string;
}

export interface Saillie extends Trace {
  jumentId: string;
  dateSaillie: ISODate | null;
  etalon: string;
  /** Terme saisi à la main quand la date de saillie est inconnue. */
  termeManuel: ISODate | null;
  echos: Echographie[];
  poulinage: ISODate | null;
  poulainSexe: string;
  poulainNom: string;
  poulainId: string | null;
}

/** Une échéance est suivie par cheval et par « clé » : le dernier soin de la clé compte. */
export type CleEcheance = 'marechal' | 'vermifuge' | 'osteo' | 'dentiste' | 'veterinaire' | `vaccin:${string}`;

export const DUREE_GESTATION_JOURS = 340;

/** Réglages par défaut validés par PAF le 09/10/2026. */
export const INTERVALLES_PAR_DEFAUT: Record<string, Intervalle> = {
  marechal: { valeur: 4, unite: 'mois' },
  vermifuge: { valeur: 3, unite: 'mois' },
  osteo: { valeur: 12, unite: 'mois' },
  dentiste: { valeur: 24, unite: 'mois' },
  'vaccin:grippe': { valeur: 12, unite: 'mois' },
  'vaccin:grippe-competition': { valeur: 6, unite: 'mois' },
  'vaccin:rhinopneumonie': { valeur: 12, unite: 'mois' },
  'vaccin:tetanos': { valeur: 12, unite: 'mois' },
};

export interface Anomalie {
  id: string;
  gravite: 'a-trancher' | 'corrige' | 'info';
  onglet: string;
  ligne?: number;
  cheval?: string;
  message: string;
  correction?: string;
}

export function estPresent(c: Cheval, ref: ISODate): boolean {
  return !c.sortie || c.sortie > ref;
}

/** Une ligne par création, modification ou suppression : qui, quand, et les valeurs avant / après. */
export interface EntreeJournal {
  id: string;
  table: 'chevaux' | 'soins' | 'saillies' | 'proprietaires';
  ficheId: string;
  operation: 'creation' | 'modification' | 'suppression' | 'restauration';
  le: string;
  par: string;
  /** Champs modifiés : valeur avant et après. */
  changements: Record<string, { avant: unknown; apres: unknown }>;
  /** 0 tant que la saisie n'est pas envoyée au serveur (étape 3). */
  envoye: 0 | 1;
}

export const CORBEILLE_JOURS = 30;

export const UTILISATEURS = ['Pierre-Alexandre', 'Chloé'] as const;
