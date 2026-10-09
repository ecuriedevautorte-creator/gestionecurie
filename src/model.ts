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
  /** Modifications simultanées du même champ par les deux gérants, à trancher. */
  conflits?: Conflit[];
}

export interface Conflit {
  champ: string;
  valeurs: { par: string; le: string; valeur: unknown }[];
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
  /** Photo réduite (JPEG en data URL), partagée avec la fiche. */
  photo?: string | null;
  /** Emplacement sur le plan (paddock, pré, box) : identifiant de src/plan.ts. */
  paddock?: string | null;
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
  'vaccin:rhinopneumonie': { valeur: 12, unite: 'mois' },
  'vaccin:tetanos': { valeur: 12, unite: 'mois' },
};

/** Intervalles propres à une catégorie de chevaux (vide = intervalle par défaut). 0 = pas de rappel. */
export type IntervallesParUsage = Partial<Record<Usage, Record<string, Intervalle>>>;

/** Grippe tous les 6 mois pour les chevaux qui courent ou concourent (règlement des courses et de la FFE). */
export const INTERVALLES_USAGE_PAR_DEFAUT: IntervallesParUsage = {
  Course: { 'vaccin:grippe': { valeur: 6, unite: 'mois' } },
  'Sport compétition': { 'vaccin:grippe': { valeur: 6, unite: 'mois' } },
};

/** Réglages partagés entre les deux gérants (une seule fiche, synchronisée comme les autres). */
export interface Parametres extends Trace {
  intervalles: Record<string, Intervalle>;
  intervallesUsage: IntervallesParUsage;
  /** Plan de l'écurie (image JPEG en data URL), partagé entre les appareils. */
  plan?: string | null;
  paddocksInitialises?: boolean;
  paddocksCorrection7?: boolean;
}
export const ID_PARAMETRES = '00000000-0000-4000-8000-000000000001';

/** Pièce jointe rangée dans le dossier d'un cheval (ordonnance, facture, rapport…). */
export interface DocumentCheval extends Trace {
  chevalId: string;
  nom: string;
  typeMime: string;
  taille: number;
  /** Emplacement du fichier dans la base partagée : « idCheval/idDocument ». */
  chemin: string;
}

/** Contenu d'un document gardé sur l'appareil ; envoye = 0 tant qu'il n'est pas dans la base partagée. */
export interface FichierLocal {
  chemin: string;
  blob: Blob;
  envoye: 0 | 1;
}

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

export const TABLES_SYNCHRO = ['chevaux', 'soins', 'saillies', 'proprietaires', 'parametres', 'documents'] as const;
export type TableSynchro = (typeof TABLES_SYNCHRO)[number];

/** Une ligne par création, modification ou suppression : qui, quand, et les valeurs avant / après. */
export interface EntreeJournal {
  id: string;
  table: TableSynchro;
  ficheId: string;
  operation: 'creation' | 'modification' | 'suppression' | 'restauration';
  le: string;
  par: string;
  /** Champs modifiés : valeur avant et après. */
  changements: Record<string, { avant: unknown; apres: unknown }>;
  /** 0 tant que la saisie n'est pas envoyée au serveur (étape 3). */
  envoye: 0 | 1;
  /** Dernière révision du serveur connue au moment de la saisie (sert à repérer les modifications simultanées). */
  base?: number;
}

export const CORBEILLE_JOURS = 30;

export const UTILISATEURS = ['Pierre-Alexandre', 'Chloé'] as const;
