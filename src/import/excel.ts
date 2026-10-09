// Lecture du classeur Gestion_Ecurie.xlsx et rapport d'anomalies.
// Règle : on ne corrige rien en silence. Chaque correction automatique est listée
// (gravité « corrige ») et chaque doute est signalé (« a-trancher ») sans être modifié.

import type ExcelJS from 'exceljs';
import { lireDateFr, versISO, type ISODate } from '../dates';
import type { Anomalie, Cheval, Intervalle, Proprietaire, Saillie, Sexe, Soin, TypeSoin } from '../model';

export interface ResultatImport {
  proprietaires: Proprietaire[];
  chevaux: Cheval[];
  soins: Soin[];
  saillies: Saillie[];
  anomalies: Anomalie[];
  /** Nombre de lignes ignorées par onglet (formules seules, lignes vides, coût à 0 seul). */
  lignesIgnorees: Record<string, number>;
}

export interface OptionsImport {
  auteur: string;
  maintenant: string;
  ref: ISODate;
}

/* ---------- Lecture des cellules ---------- */

interface Case {
  v: string | number | ISODate | null;
  /** La cellule contient une formule (hors simple calcul de nombres). */
  formule: boolean;
  /** Formule de calcul saisie à la main, ex. =49.2+231+19.15 */
  calcul?: string;
  estDate?: boolean;
  /** Date saisie en texte avec une année impossible (ex. 23/07/0206). */
  dateTexteInvalide?: { jour: number; mois: number; annee: number; texte: string };
}

const VIDE: Case = { v: null, formule: false };

function dateExcel(d: Date): ISODate | null {
  if (d.getUTCFullYear() < 1900) return null; // 0 affiché comme date = cellule vide
  return versISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function lireCase(cell: ExcelJS.Cell): Case {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return VIDE;
  if (v instanceof Date) {
    const d = dateExcel(v);
    return d ? { v: d, formule: false, estDate: true } : VIDE;
  }
  if (typeof v === 'number') return { v, formule: false };
  if (typeof v === 'boolean') return { v: v ? 'VRAI' : 'FAUX', formule: false };
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return VIDE;
    const d = lireDateFr(t);
    if (d) {
      if (d.annee < 1900) return { v: null, formule: false, dateTexteInvalide: { ...d, texte: t } };
      return { v: versISO(d.annee, d.mois, d.jour), formule: false, estDate: true };
    }
    return { v: t, formule: false };
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('formula' in o || 'sharedFormula' in o) {
      const f = String(o.formula ?? o.sharedFormula ?? '');
      if (/^[\d\s.,+\-*/()]+$/.test(f) && typeof o.result === 'number') {
        return { v: o.result, formule: false, calcul: '=' + f };
      }
      return { v: null, formule: true };
    }
    if ('hyperlink' in o) return { v: String(o.hyperlink), formule: false };
    if ('richText' in o) {
      const t = (o.richText as { text: string }[]).map((r) => r.text).join('').trim();
      return t ? { v: t, formule: false } : VIDE;
    }
    if ('text' in o) return { v: String(o.text).trim() || null, formule: false };
  }
  return VIDE;
}

function sansAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function cleEntete(s: string): string {
  return sansAccents(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function cleNom(s: string): string {
  return sansAccents(s).toUpperCase().replace(/\s+/g, ' ').trim();
}

interface Ligne {
  numero: number;
  cases: Map<string, Case>;
}

/** Lit un onglet : la première ligne donne les noms de colonnes. Les lignes sans vraie saisie sont comptées et écartées. */
function lireOnglet(ws: ExcelJS.Worksheet | undefined): { lignes: Ligne[]; ignorees: number; colonnes: Set<string> } {
  if (!ws) return { lignes: [], ignorees: 0, colonnes: new Set() };
  const entetes = new Map<number, string>();
  ws.getRow(1).eachCell((cell, col) => {
    const t = String(cell.value ?? '').trim();
    if (t) entetes.set(col, cleEntete(t));
  });
  const lignes: Ligne[] = [];
  let ignorees = 0;
  for (let n = 2; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const cases = new Map<string, Case>();
    let utile = false;
    let touchee = false;
    for (const [col, nom] of entetes) {
      const c = lireCase(row.getCell(col));
      cases.set(nom, c);
      if (c.formule || c.v !== null) touchee = true;
      const significatif = (typeof c.v === 'string' && c.v !== '') || (typeof c.v === 'number' && c.v !== 0) || c.dateTexteInvalide;
      if (!c.formule && significatif) utile = true;
    }
    if (utile) lignes.push({ numero: n, cases });
    else if (touchee) ignorees++;
  }
  return { lignes, ignorees, colonnes: new Set(entetes.values()) };
}

function txt(l: Ligne, ...noms: string[]): string {
  for (const n of noms) {
    const c = l.cases.get(cleEntete(n));
    if (c && c.v !== null && typeof c.v === 'string' && !c.estDate) return c.v.trim();
    if (c && typeof c.v === 'number') return String(c.v);
  }
  return '';
}

function num(l: Ligne, nom: string): number | null {
  const c = l.cases.get(cleEntete(nom));
  if (!c || c.v === null) return null;
  if (typeof c.v === 'number') return c.v;
  const n = Number(String(c.v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && String(c.v).trim() !== '' ? n : null;
}

function cell(l: Ligne, nom: string): Case {
  return l.cases.get(cleEntete(nom)) ?? VIDE;
}

/* ---------- Import ---------- */

export async function importerClasseur(donnees: ArrayBuffer, opts: OptionsImport): Promise<ResultatImport> {
  const { default: Excel } = await import('exceljs');
  const wb = new Excel.Workbook();
  await wb.xlsx.load(donnees);
  return analyserClasseur(wb, opts);
}

export function analyserClasseur(wb: ExcelJS.Workbook, opts: OptionsImport): ResultatImport {
  const anomalies: Anomalie[] = [];
  const lignesIgnorees: Record<string, number> = {};
  let compteur = 0;
  const signaler = (a: Omit<Anomalie, 'id'>) => anomalies.push({ id: `a${++compteur}`, ...a });
  const trace = (source: string) => ({
    id: crypto.randomUUID(),
    creeLe: opts.maintenant,
    creePar: opts.auteur,
    modifieLe: opts.maintenant,
    modifiePar: opts.auteur,
    supprimeLe: null,
    source,
    aVerifier: [] as string[],
  });
  const onglet = (nom: string) => {
    const r = lireOnglet(wb.getWorksheet(nom));
    lignesIgnorees[nom] = r.ignorees;
    return r;
  };

  /* ----- Chevaux et propriétaires ----- */
  const proprietaires = new Map<string, Proprietaire>();
  const chevaux: Cheval[] = [];
  const robesHarmonisees: string[] = [];
  const anneeSeule: string[] = [];

  for (const l of onglet('Chevaux').lignes) {
    const nom = txt(l, 'Nom');
    if (!nom) {
      signaler({ gravite: 'a-trancher', onglet: 'Chevaux', ligne: l.numero, message: 'Ligne remplie sans nom de cheval : non importée.' });
      continue;
    }
    const c: Cheval = {
      ...trace(`Excel, Chevaux ligne ${l.numero}`),
      nom: cleNom(nom),
      sexe: normaliserSexe(txt(l, 'Sexe')),
      robe: '',
      race: txt(l, 'Race'),
      naissance: dateDe(cell(l, 'Date de naissance')),
      pere: txt(l, 'Pere'),
      mere: txt(l, 'Mere'),
      proprietaireId: null,
      sire: txt(l, 'N SIRE').toUpperCase(),
      transpondeur: '',
      entree: dateDe(cell(l, "Date d'entree")),
      sortie: dateDe(cell(l, 'Date de sortie')),
      motifSortie: txt(l, 'Motif de sortie'),
      destination: txt(l, 'Destination'),
      notes: txt(l, 'Notes'),
      usage: null,
    };

    const robeBrute = txt(l, 'Robe');
    c.robe = harmoniserRobe(robeBrute);
    if (robeBrute && robeBrute !== c.robe) robesHarmonisees.push(`${c.nom} : « ${robeBrute} » → « ${c.robe} »`);

    if (c.naissance?.endsWith('-01-01')) {
      c.naissanceAnneeSeule = true;
      anneeSeule.push(c.nom);
    }

    // Transpondeur gardé en texte, sans « .0 »
    const t = cell(l, 'N Transpondeur');
    if (typeof t.v === 'number') c.transpondeur = BigInt(Math.round(t.v)).toString();
    else if (typeof t.v === 'string') c.transpondeur = t.v.replace(/\s/g, '').replace(/\.0$/, '');
    if (c.transpondeur && !/^\d{15}$/.test(c.transpondeur)) {
      const msg = `Transpondeur ${c.transpondeur} : ${c.transpondeur.replace(/\D/g, '').length} chiffres au lieu de 15. Importé tel quel, à vérifier sur le passeport.`;
      signaler({ gravite: 'a-trancher', onglet: 'Chevaux', ligne: l.numero, cheval: c.nom, message: msg });
      c.aVerifier!.push(msg);
    }
    if (!c.naissance && !c.sire && !c.transpondeur) {
      signaler({ gravite: 'info', onglet: 'Chevaux', ligne: l.numero, cheval: c.nom, message: 'Ni date de naissance, ni SIRE, ni transpondeur : fiche importée incomplète.' });
    }

    // Colonnes décalées : une adresse dans Père ou Mère
    for (const [champ, valeur] of [['Père', c.pere], ['Mère', c.mere]] as const) {
      if (/\n|\b\d{5}\b/.test(valeur)) {
        const msg = `La colonne ${champ} contient « ${valeur.replace(/\n/g, ', ')} », qui ressemble à une adresse : ligne peut-être décalée.`;
        signaler({ gravite: 'a-trancher', onglet: 'Chevaux', ligne: l.numero, cheval: c.nom, message: msg });
        c.aVerifier!.push(msg);
      }
    }

    // Propriétaire : 1re ligne = nom, la suite = adresse
    const pa = txt(l, 'Proprietaire_ Adresse', 'Proprietaire');
    if (pa) {
      const [nomP, ...adresse] = pa.split('\n').map((s) => s.trim()).filter(Boolean);
      const cle = cleNom(nomP);
      let p = proprietaires.get(cle);
      if (!p) {
        p = { ...trace(`Excel, Chevaux ligne ${l.numero}`), nom: nomP, adresse: adresse.join('\n') };
        proprietaires.set(cle, p);
      } else if (!p.adresse && adresse.length) {
        p.adresse = adresse.join('\n');
      }
      c.proprietaireId = p.id;
    }
    chevaux.push(c);
  }

  if (robesHarmonisees.length) {
    signaler({ gravite: 'corrige', onglet: 'Chevaux', message: 'Orthographe des robes harmonisée.', correction: robesHarmonisees.join(' ; ') });
  }
  if (anneeSeule.length) {
    signaler({ gravite: 'info', onglet: 'Chevaux', message: `Né(e)s un 01/01 : seule l'année est sans doute connue (${anneeSeule.length} chevaux). La fiche affichera « né(e) en … ».`, correction: anneeSeule.join(', ') });
  }

  // Noms très proches (faute de frappe probable)
  for (let i = 0; i < chevaux.length; i++) {
    for (let j = i + 1; j < chevaux.length; j++) {
      const a = chevaux[i].nom.split(' ');
      const b = chevaux[j].nom.split(' ');
      const fa = a[a.length - 1];
      const fb = b[b.length - 1];
      if (a.length > 1 && b.length > 1 && fa.length >= 4 && distance(fa, fb) === 1) {
        signaler({ gravite: 'a-trancher', onglet: 'Chevaux', cheval: `${chevaux[i].nom} / ${chevaux[j].nom}`, message: `« ${fa} » et « ${fb} » ne diffèrent que d'une lettre : faute de frappe ?` });
      }
    }
  }

  const index = new Map(chevaux.map((c) => [cleNom(c.nom), c]));
  const trouverCheval = (nom: string, ong: string, ligne: number): Cheval | null => {
    const c = index.get(cleNom(nom));
    if (!c) {
      signaler({ gravite: 'a-trancher', onglet: ong, ligne, cheval: nom, message: `« ${nom} » ne correspond à aucun cheval de l'onglet Chevaux : ligne non importée.` });
      return null;
    }
    if (c.nom !== nom.trim()) {
      signaler({ gravite: 'corrige', onglet: ong, ligne, cheval: c.nom, message: `Nom « ${nom} » rapproché de ${c.nom}.` });
    }
    return c;
  };

  /* ----- Soins ----- */
  const soins: Soin[] = [];
  const praticiens: { soin: Soin; brut: string }[] = [];
  const coutsZero: string[] = [];
  const lignesSansCheval: { onglet: string; ligne: number; texte: string }[] = [];

  const lireSoins = (
    nomOnglet: string,
    type: (l: Ligne) => TypeSoin,
    remplir: (l: Ligne, s: Soin) => void,
  ) => {
    const { lignes } = onglet(nomOnglet);
    let derniereAnnee: number | null = null;
    for (const l of lignes) {
      let date = dateDe(cell(l, 'Date'));
      const invalide = cell(l, 'Date').dateTexteInvalide;
      if (!date && invalide && derniereAnnee) {
        date = versISO(derniereAnnee, invalide.mois, invalide.jour);
        signaler({ gravite: 'corrige', onglet: nomOnglet, ligne: l.numero, cheval: txt(l, 'Cheval'), message: `Date « ${invalide.texte} » impossible.`, correction: `Année des lignes voisines : ${date.split('-').reverse().join('/')}` });
      }
      const nomCheval = txt(l, 'Cheval');
      const autres = [...l.cases.entries()].filter(([k, c]) => k !== 'date' && k !== 'verification' && k !== 'statut' && !c.formule && c.v !== null && c.v !== 0);
      if (!date) {
        signaler({ gravite: autres.length > 1 ? 'a-trancher' : 'info', onglet: nomOnglet, ligne: l.numero, cheval: nomCheval, message: autres.length > 1 ? 'Ligne sans date : non importée.' : 'Ligne presque vide (sans date) : ignorée.' });
        continue;
      }
      derniereAnnee = Number(date.slice(0, 4));
      if (!nomCheval) {
        if (autres.length === 0) {
          signaler({ gravite: 'info', onglet: nomOnglet, ligne: l.numero, message: `Date seule (${date.split('-').reverse().join('/')}), rien d'autre : ignorée.` });
        } else {
          lignesSansCheval.push({ onglet: nomOnglet, ligne: l.numero, texte: autres.map(([, c]) => String(c.v)).join(' · ') });
        }
        continue;
      }
      const cheval = trouverCheval(nomCheval, nomOnglet, l.numero);
      if (!cheval) continue;
      const s: Soin = {
        ...trace(`Excel, ${nomOnglet} ligne ${l.numero}`),
        type: type(l),
        chevalId: cheval.id,
        date,
        precision: '',
        praticien: '',
        motif: '',
        cout: null,
        intervalle: null,
        prochaineManuelle: null,
        lienFacture: '',
        details: {},
      };
      remplir(l, s);
      const cc = cell(l, 'Cout (EUR)');
      if (cc.calcul) {
        signaler({ gravite: 'corrige', onglet: nomOnglet, ligne: l.numero, cheval: cheval.nom, message: `Coût saisi comme un calcul (${cc.calcul}).`, correction: `${formaterEuros(Number(cc.v))}` });
      }
      if (s.cout === 0) {
        s.cout = null;
        coutsZero.push(`${nomOnglet} ligne ${l.numero}`);
      }
      if (s.praticien) praticiens.push({ soin: s, brut: s.praticien });
      soins.push(s);
    }
  };

  lireSoins('Veterinaire', () => 'veterinaire', (l, s) => {
    s.motif = txt(l, 'Motif');
    s.praticien = txt(l, 'Veterinaire');
    s.details.diagnostic = txt(l, 'Diagnostic') || null;
    s.details.traitement = txt(l, 'Traitement') || null;
    s.cout = num(l, 'Cout (EUR)');
    s.prochaineManuelle = dateDe(cell(l, 'Prochain RDV'));
    s.lienFacture = txt(l, 'Lien Facture');
    if (!s.motif) {
      s.motif = 'Non précisé';
      signaler({ gravite: 'corrige', onglet: 'Veterinaire', ligne: l.numero, cheval: txt(l, 'Cheval'), message: 'Visite sans motif.', correction: 'Motif « Non précisé »' });
    }
  });

  lireSoins('Ordonnances', () => 'ordonnance', (l, s) => {
    s.precision = txt(l, 'Medicament');
    s.details.posologie = txt(l, 'Posologie') || null;
    s.details.dureeJours = num(l, 'Duree (jours)');
    s.praticien = txt(l, 'Prescripteur');
    s.details.photo = txt(l, 'Photo ordonnance (lien)') || null;
  });

  let statutsTapes = 0;
  lireSoins('Marechal', () => 'marechal', (l, s) => {
    s.precision = normaliserMarechal(txt(l, 'Type (Ferrage/Parage)', 'Type'), l.numero, signaler);
    s.praticien = txt(l, 'Marechal');
    s.cout = num(l, 'Cout (EUR)');
    const sem = num(l, 'Intervalle (semaines)');
    s.intervalle = sem ? { valeur: sem, unite: 'semaines' } : null;
    if (cell(l, 'Statut').v !== null) statutsTapes++;
  });
  if (statutsTapes) {
    signaler({ gravite: 'corrige', onglet: 'Marechal', message: `Colonne Statut tapée à la main sur ${statutsTapes} lignes (au lieu de la formule).`, correction: "Statut recalculé par l'application" });
  }

  lireSoins('Osteo-Dentiste', (l) => (/dent/i.test(txt(l, 'Type (Osteopathe/Dentiste)', 'Type')) ? 'dentiste' : 'osteo'), (l, s) => {
    s.precision = txt(l, 'Type (Osteopathe/Dentiste)', 'Type');
    s.praticien = txt(l, 'Praticien');
    s.motif = txt(l, 'Motif');
    s.intervalle = mois(num(l, 'Intervalle (mois)'));
  });

  lireSoins('Vaccins', () => 'vaccin', (l, s) => {
    s.precision = txt(l, 'Vaccin');
    s.praticien = txt(l, 'Veterinaire');
    s.intervalle = mois(num(l, 'Rappel (mois)'));
  });

  lireSoins('Vermifuge', () => 'vermifuge', (l, s) => {
    s.precision = txt(l, 'Vermifuge', 'Produit');
    s.intervalle = mois(num(l, 'Rappel (mois)'));
  });

  // Lignes sans cheval : identiques ou non, elles sont signalées sans être importées
  const parTexte = new Map<string, typeof lignesSansCheval>();
  for (const x of lignesSansCheval) {
    const k = `${x.onglet}|${x.texte}`;
    parTexte.set(k, [...(parTexte.get(k) ?? []), x]);
  }
  for (const groupe of parTexte.values()) {
    const lignes = groupe.map((g) => g.ligne).join(' et ');
    const double = groupe.length > 1 ? `${groupe.length} lignes identiques` : 'Ligne';
    signaler({ gravite: 'a-trancher', onglet: groupe[0].onglet, ligne: groupe[0].ligne, message: `${double} sans cheval (lignes ${lignes}) : ${groupe[0].texte}. Non importée(s) : à quel(s) cheval(aux) ?` });
  }

  if (coutsZero.length) {
    signaler({ gravite: 'corrige', onglet: 'Soins', message: 'Coût à 0 € sur une ligne remplie.', correction: `Considéré comme inconnu : ${coutsZero.join(', ')}` });
  }

  // Praticiens : même nom écrit avec des majuscules différentes
  const variantes = new Map<string, Map<string, number>>();
  for (const { brut } of praticiens) {
    const k = cleNom(brut);
    const m = variantes.get(k) ?? new Map<string, number>();
    m.set(brut, (m.get(brut) ?? 0) + 1);
    variantes.set(k, m);
  }
  for (const { soin, brut } of praticiens) {
    const m = variantes.get(cleNom(brut))!;
    const choisi = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (choisi !== brut) {
      soin.praticien = choisi;
      signaler({ gravite: 'corrige', onglet: soin.source!.replace(/^Excel, | ligne.*$/g, ''), ligne: Number(soin.source!.split('ligne ')[1]), message: `Praticien « ${brut} ».`, correction: `« ${choisi} »` });
    }
  }

  // Vaccins aux dates suspectes
  for (const s of soins.filter((x) => x.type === 'vaccin')) {
    const c = chevaux.find((x) => x.id === s.chevalId)!;
    const ancien = Number(s.date.slice(0, 4)) < Number(opts.ref.slice(0, 4)) - 5;
    if (s.date.endsWith('-01-01') || ancien) {
      const msg = `Vaccin ${s.precision} daté du ${s.date.split('-').reverse().join('/')} : date par défaut ? Le cheval sera EN RETARD dès l'import.`;
      signaler({ gravite: 'a-trancher', onglet: 'Vaccins', ligne: Number(s.source!.split('ligne ')[1]), cheval: c.nom, message: msg });
      s.aVerifier!.push(msg);
    }
  }

  // Vaccins notés à la fois en Vétérinaire (facture) et en Vaccins (rappel)
  const doublons = soins.filter(
    (v) => v.type === 'veterinaire' && /vaccin/i.test(v.motif) && soins.some((x) => x.type === 'vaccin' && x.chevalId === v.chevalId && x.date === v.date),
  );
  if (doublons.length) {
    signaler({ gravite: 'info', onglet: 'Veterinaire', message: `${doublons.length} vaccins notés deux fois (facture en Vétérinaire, rappel en Vaccins). Le coût n'étant que dans Vétérinaire, il n'est pas compté deux fois.` });
  }

  // Soins antérieurs à l'arrivée
  const avantEntree = new Map<string, number>();
  for (const s of soins) {
    const c = chevaux.find((x) => x.id === s.chevalId)!;
    if (c.entree && s.date < c.entree) avantEntree.set(c.nom, (avantEntree.get(c.nom) ?? 0) + 1);
  }
  if (avantEntree.size) {
    signaler({ gravite: 'info', onglet: 'Soins', message: "Soins datés d'avant l'arrivée du cheval (historique antérieur), conservés.", correction: [...avantEntree].map(([n, k]) => `${n} (${k})`).join(', ') });
  }

  /* ----- Poulinières ----- */
  const saillies: Saillie[] = [];
  for (const l of onglet('Poulinieres').lignes) {
    const nomJument = txt(l, 'Jument');
    if (!nomJument) continue;
    const jument = trouverCheval(nomJument, 'Poulinieres', l.numero);
    if (!jument) continue;
    const terme = cell(l, 'Date prevue de poulinage');
    const s: Saillie = {
      ...trace(`Excel, Poulinieres ligne ${l.numero}`),
      jumentId: jument.id,
      dateSaillie: dateDe(cell(l, 'Date de saillie')),
      etalon: txt(l, 'Etalon'),
      termeManuel: terme.formule ? null : dateDe(terme),
      echos: [1, 2, 3].map((i) => ({ date: dateDe(cell(l, `Date echo ${i}`)), observation: txt(l, `Observation echo ${i}`) })),
      poulinage: dateDe(cell(l, 'Date reelle de poulinage')),
      poulainSexe: txt(l, 'Sexe poulain'),
      poulainNom: txt(l, 'Nom poulain'),
      poulainId: null,
    };
    if (!s.dateSaillie) {
      signaler({ gravite: 'info', onglet: 'Poulinieres', ligne: l.numero, cheval: jument.nom, message: 'Pas de date de saillie : terme repris tel quel.' });
    }
    for (const [i, e] of s.echos.entries()) {
      if (e.date && s.dateSaillie && e.date < s.dateSaillie) {
        const msg = `Écho ${i + 1} du ${e.date.split('-').reverse().join('/')} antérieure à la saillie du ${s.dateSaillie.split('-').reverse().join('/')} : une des deux dates est fausse.`;
        signaler({ gravite: 'a-trancher', onglet: 'Poulinieres', ligne: l.numero, cheval: jument.nom, message: msg });
        s.aVerifier!.push(msg);
      }
    }
    if (s.poulainNom) {
      const poulain = index.get(cleNom(s.poulainNom));
      if (poulain) {
        s.poulainId = poulain.id;
        if (s.poulinage && poulain.naissance && poulain.naissance !== s.poulinage) {
          const msg = `Né le ${poulain.naissance.split('-').reverse().join('/')} selon Chevaux, mais pouliné le ${s.poulinage.split('-').reverse().join('/')} selon Poulinières.`;
          signaler({ gravite: 'a-trancher', onglet: 'Chevaux', ligne: Number(poulain.source!.split('ligne ')[1]), cheval: poulain.nom, message: msg });
          poulain.aVerifier!.push(msg);
        }
        // Père et mère inversés par rapport au suivi de la jument
        if (cleNom(poulain.pere) === cleNom(jument.nom) || (s.etalon && cleNom(poulain.mere) === cleNom(s.etalon))) {
          const msg = `Père (« ${poulain.pere} ») et mère (« ${poulain.mere} ») inversés : la mère est ${jument.nom}, l'étalon ${s.etalon}.`;
          signaler({ gravite: 'a-trancher', onglet: 'Chevaux', ligne: Number(poulain.source!.split('ligne ')[1]), cheval: poulain.nom, message: msg });
          poulain.aVerifier!.push(msg);
        }
      }
    }
    saillies.push(s);
  }

  // Date d'entrée manquante : on reprend la naissance (cheval né à l'écurie)
  for (const c of chevaux) {
    if (!c.entree && c.naissance && !c.sortie) {
      c.entree = c.naissance;
      signaler({ gravite: 'corrige', onglet: 'Chevaux', ligne: Number(c.source!.split('ligne ')[1]), cheval: c.nom, message: "Pas de date d'entrée.", correction: `Date de naissance reprise (${c.naissance.split('-').reverse().join('/')}), si né(e) chez vous` });
    }
  }

  return { proprietaires: [...proprietaires.values()], chevaux, soins, saillies, anomalies, lignesIgnorees };
}

/* ---------- Utilitaires ---------- */

function dateDe(c: Case): ISODate | null {
  return c.estDate && typeof c.v === 'string' ? c.v : null;
}

function mois(n: number | null): Intervalle | null {
  return n ? { valeur: n, unite: 'mois' } : null;
}

function normaliserSexe(s: string): Sexe {
  const k = cleNom(s);
  if (k.startsWith('M')) return 'Mâle';
  if (k.startsWith('F') || k.startsWith('J')) return 'Femelle';
  if (k.startsWith('H')) return 'Hongre';
  return '';
}

function harmoniserRobe(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function normaliserMarechal(s: string, ligne: number, signaler: (a: Omit<Anomalie, 'id'>) => void): string {
  const k = cleNom(s);
  const ferrure = /FERR/.test(k);
  const parage = /PARAG/.test(k);
  if (ferrure && parage) {
    if (s !== 'Ferrure + Parage') signaler({ gravite: 'corrige', onglet: 'Marechal', ligne, message: `Type « ${s} ».`, correction: 'Type « Ferrure + Parage »' });
    return 'Ferrure + Parage';
  }
  if (ferrure) return 'Ferrure';
  if (parage) return 'Parage';
  return s;
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

export function formaterEuros(n: number): string {
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}
