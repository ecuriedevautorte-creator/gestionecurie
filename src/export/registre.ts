// Registre d'élevage des équidés, sur le modèle SIRE / IFCE (nouvelle charte 03-2023),
// pré-rempli avec les chevaux et les soins de l'application. Format A4 paysage.

import type { jsPDF as JsPDF } from 'jspdf';
import { ajouterJours, aujourdhui, formater } from '../dates';
import { db } from '../db';
import { type Cheval, type Proprietaire, type Soin } from '../model';
import { imageEnDataUrl, proposer } from './cheval';

const TITRE: [number, number, number] = [61, 66, 112];
const SAUMON: [number, number, number] = [236, 128, 100];
const ENTETE: [number, number, number] = [221, 225, 243];
const NOM_ECURIE = "L'Écurie de Vautorte";

// Helvetica ne connaît pas les espaces fines insécables utilisées par le français
const net = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ');

const TYPES_INTERVENTION: Record<Soin['type'], string> = {
  veterinaire: 'Visite vétérinaire',
  ordonnance: 'Traitement',
  marechal: 'Maréchalerie',
  osteo: 'Ostéopathie',
  dentiste: 'Soins dentaires',
  vaccin: 'Vaccination',
  vermifuge: 'Vermifugation',
};

/** Intervenant le plus fréquent pour un type de soin (pour pré-remplir l'encadrement sanitaire). */
function habituel(soins: Soin[], type: Soin['type']): string {
  const compte = new Map<string, number>();
  for (const s of soins) if (s.type === type && s.praticien.trim()) compte.set(s.praticien.trim(), (compte.get(s.praticien.trim()) ?? 0) + 1);
  return [...compte].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

function ligneIntervention(s: Soin, nom: string): string[] {
  const precision = s.precision.trim();
  let type = TYPES_INTERVENTION[s.type];
  let medicament = '';
  let dose = '';
  let fin = '';
  switch (s.type) {
    case 'vaccin':
    case 'vermifuge':
      medicament = precision;
      break;
    case 'ordonnance':
      medicament = precision;
      dose = String(s.details.posologie ?? '');
      if (s.details.dureeJours) fin = formater(ajouterJours(s.date, Number(s.details.dureeJours)));
      break;
    case 'veterinaire':
      type = [type, s.motif || s.details.diagnostic].filter(Boolean).join(' : ');
      medicament = String(s.details.traitement ?? '');
      break;
    default:
      if (precision) type += ` (${precision.toLowerCase()})`;
      if (s.motif) type += ` : ${s.motif}`;
  }
  const debut = s.type === 'ordonnance' ? formater(s.date) : '';
  return [formater(s.date), nom, type, s.praticien, medicament, dose, debut, fin, '', '', ''].map(net);
  // (la signature éventuelle est dessinée dans la cellule « Intervenant », sous le nom)
}

export async function exporterRegistre(): Promise<void> {
  const ref = aujourdhui();
  const [chevaux, soins, proprietaires] = await Promise.all([db.chevaux.toArray(), db.soins.toArray(), db.proprietaires.toArray()]);
  const presents = chevaux.filter((c) => !c.supprimeLe).sort((a, b) => (a.entree ?? '9999').localeCompare(b.entree ?? '9999') || a.nom.localeCompare(b.nom, 'fr'));
  const tousSoins = soins.filter((s) => !s.supprimeLe).sort((a, b) => a.date.localeCompare(b.date));
  const parId = new Map<string, Cheval>(chevaux.map((c) => [c.id, c]));
  const proprio = new Map<string, Proprietaire>(proprietaires.map((p) => [p.id, p]));
  const debutPeriode = [...presents.map((c) => c.entree), ...tousSoins.map((s) => s.date)].filter(Boolean).sort()[0] ?? ref;

  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc: JsPDF = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const L = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const marge = 14;
  const logo = await imageEnDataUrl('./logo.png');

  const enTete = () => {
    if (logo) doc.addImage(logo, 'PNG', marge, 8, 18, 18);
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...TITRE);
    doc.text(NOM_ECURIE, marge + 21, 15);
    doc.setFontSize(7.5).setTextColor(130);
    doc.text(`Registre édité le ${formater(ref)}`, marge + 21, 20);
  };
  const titre = (texte: string, y = 34, couleur = SAUMON) => {
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...couleur);
    doc.text(texte, L / 2, y, { align: 'center' });
  };
  const texte = (t: string, x: number, y: number, gras = false, taille = 10) => {
    doc.setFont('helvetica', gras ? 'bold' : 'normal').setFontSize(taille).setTextColor(30);
    doc.text(net(t), x, y);
  };
  /** Libellé suivi d'une valeur, ou d'une ligne pointillée à compléter à la main. */
  const champ = (libelle: string, valeur: string, x: number, y: number, fin = L - marge) => {
    texte(libelle, x, y, true);
    const debut = x + doc.getTextWidth(net(libelle)) + 2;
    if (valeur) texte(valeur, debut, y);
    else {
      doc.setDrawColor(150).setLineWidth(0.2).setLineDashPattern([0.6, 0.9], 0);
      doc.line(debut, y + 0.6, fin, y + 0.6);
      doc.setLineDashPattern([], 0);
    }
  };
  const nouvellePage = (t: string) => {
    doc.addPage();
    enTete();
    titre(t);
  };
  const tableau = {
    theme: 'grid' as const,
    rowPageBreak: 'avoid' as const,
    margin: { left: marge, right: marge, top: 30 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, lineColor: [60, 60, 60] as [number, number, number], lineWidth: 0.2, textColor: 30, valign: 'middle' as const },
    headStyles: { fillColor: ENTETE, textColor: TITRE, fontStyle: 'bold' as const, halign: 'center' as const },
    didDrawPage: () => enTete(),
  };
  const lignesVides = (n: number, colonnes: number) => Array.from({ length: n }, () => Array.from({ length: colonnes }, () => ' '));

  // 1. Couverture
  enTete();
  titre("REGISTRE D'ÉLEVAGE", 62, TITRE);
  doc.setFont('helvetica', 'normal').setFontSize(13).setTextColor(...SAUMON);
  doc.text("Pour les détenteurs d'équidés", L / 2, 70, { align: 'center' });
  champ('De : ', NOM_ECURIE, marge + 6, 110, marge + 120);
  champ('Ouvert le : ', '', marge + 6, 122, marge + 70);
  if (logo) doc.addImage(logo, 'PNG', L - marge - 95, 88, 85, 85);

  // 2. Lieu de détention
  nouvellePage('CARACTÉRISTIQUES DU LIEU DE DÉTENTION');
  texte("Adresse du lieu de détention et type d'activité", marge, 48, true, 11);
  champ('Dénomination : ', NOM_ECURIE, marge, 60);
  champ('Adresse : ', '', marge, 70);
  champ('', '', marge, 80);
  champ("Type activité : ", 'Élevage, pension et entraînement de chevaux (course, sport, loisir, reproduction)', marge, 90);
  texte('Plan du lieu de détention', marge, 106, true, 11);
  doc.setDrawColor(150).setLineWidth(0.2).rect(marge, 110, L - 2 * marge, H - 125);

  // 3. Détenteur
  nouvellePage('CARACTÉRISTIQUES DU LIEU DE DÉTENTION');
  texte('Informations concernant le détenteur des équidés', marge, 46, true, 11);
  champ('Numéro de détenteur (SIRE) : ', '', marge, 57, marge + 140);
  champ('[ ] Particulier :  Titre : ', '', marge, 67, marge + 85);
  champ('Prénom : ', '', marge + 90, 67, marge + 165);
  champ("Nom d'usage : ", '', marge + 170, 67);
  champ('[ ] Professionnel :  [ ] Personne physique   [ ] Personne morale    N° SIRET : ', '', marge, 77, marge + 200);
  champ('Code APE : ', '', marge + 205, 77);
  champ('Statut juridique (facultatif) : ', '', marge, 87, marge + 120);
  champ('Dénomination (facultatif) : ', '', marge, 97);
  texte('Coordonnées du détenteur (si différentes du lieu de stationnement des équidés)', marge, 112, true, 11);
  champ('Adresse : ', '', marge, 122);
  champ('Tél : ', '', marge, 132, marge + 80);
  champ('Portable : ', '', marge + 85, 132, marge + 165);
  champ('Mail : ', '', marge + 170, 132);
  texte("Personne responsable de la tenue du registre d'élevage", marge, 147, true, 11);
  champ('Prénom : ', '', marge, 157, marge + 80);
  champ("Nom d'usage : ", '', marge + 85, 157);
  champ('Adresse : ', '', marge, 167);
  champ('Tél : ', '', marge, 177, marge + 80);
  champ('Portable : ', '', marge + 85, 177, marge + 165);
  champ('Mail : ', '', marge + 170, 177);

  // 4. Encadrement zootechnique, sanitaire et médical
  nouvellePage('ENCADREMENT ZOOTECHNIQUE, SANITAIRE ET MÉDICAL DES ANIMAUX');
  const veto = habituel(tousSoins, 'veterinaire');
  autoTable(doc, {
    ...tableau,
    startY: 42,
    headStyles: { ...tableau.headStyles, halign: 'left' },
    columnStyles: { 0: { cellWidth: 100, fontStyle: 'bold', fillColor: ENTETE, textColor: TITRE }, 1: { minCellHeight: 13 } },
    body: [
      ['Liste des espèces présentes et type de production', `Équidés : ${presents.filter((c) => !c.sortie || c.sortie > ref).length} présents au ${formater(ref)}`],
      ['Lieu habituel et durée moyenne de détention', ''],
      ['Nom et coordonnées du vétérinaire traitant', veto],
      ['Nom et coordonnées du vétérinaire sanitaire', ''],
      ['Nom et coordonnées du référent bien-être animal (pour les structures équines professionnelles)', ''],
      [
        "Nom, adresse et N° de téléphone des organisme(s) à vocation sanitaire reconnu(s) et des sociétés mères (facultatif)",
        'RESPE - Réseau d’Epidémio-Surveillance en Pathologie Equine, 3 rue Nelson Mandela, 14280 Saint-Contest. Tél : 02 31 57 24 88, www.respe.net',
      ],
      ['Nom, adresse et N° de téléphone du maréchal ferrant (facultatif)', habituel(tousSoins, 'marechal')],
      ['Nom, adresse et N° de téléphone du dentiste (facultatif)', habituel(tousSoins, 'dentiste')],
    ].map((l) => l.map(net)),
  });

  // 5. Présence et caractéristiques des animaux
  nouvellePage('PRÉSENCE ET CARACTÉRISTIQUES DES ANIMAUX');
  texte(`Liste présences entre le ${formater(debutPeriode)} et le ${formater(ref)}`, marge, 44, true);
  autoTable(doc, {
    ...tableau,
    startY: 48,
    head: [['Nom', 'N° SIRE', 'N° transpondeur', 'Nom et coordonnées du propriétaire', 'Date de première entrée', 'Adresse de provenance', 'Date de sortie définitive', 'Adresse de destination']],
    body: presents.map((c) => {
      const p = c.proprietaireId ? proprio.get(c.proprietaireId) : undefined;
      return [c.nom, c.sire, c.transpondeur, p ? [p.nom, p.adresse].filter(Boolean).join('\n') : '', formater(c.entree), '', formater(c.sortie), [c.destination, c.motifSortie && `(${c.motifSortie})`].filter(Boolean).join(' ')].map(net);
    }),
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 36 }, 1: { cellWidth: 24 }, 2: { cellWidth: 32 }, 3: { cellWidth: 52 }, 4: { cellWidth: 22, halign: 'center' }, 6: { cellWidth: 22, halign: 'center' } },
  });

  // 6. Mouvements temporaires (option 1), à remplir à la main
  nouvellePage('MOUVEMENTS TEMPORAIRES DES ANIMAUX');
  texte('Liste des mouvements temporaires entre le ..../..../........ et le ..../..../........', marge, 44, true);
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(110).text('(Option 1 : mouvements peu fréquents)', marge, 49);
  autoTable(doc, {
    ...tableau,
    startY: 53,
    head: [['Date de sortie', "Nom de l'équidé", 'Motif', 'Étape éventuelle (adresse)', 'Lieu de destination (adresse)', 'Date de retour']],
    body: lignesVides(10, 6),
    bodyStyles: { minCellHeight: 11 },
  });

  // 7. Interventions et soins courants (option 2 : chronologique, tous les chevaux)
  nouvellePage('INTERVENTIONS ET SOINS COURANTS');
  texte('Enregistrement chronologique des interventions, soins et administration de médicaments', marge, 44, true);
  texte(`entre le ${formater(tousSoins[0]?.date ?? ref)} et le ${formater(ref)} (option 2)`, marge, 49, true);
  autoTable(doc, {
    ...tableau,
    startY: 53,
    head: [
      [
        { content: 'Date', rowSpan: 2 },
        { content: "Nom de l'animal", rowSpan: 2 },
        { content: "Type d'intervention", rowSpan: 2 },
        { content: 'Intervenant (si vétérinaire : cachet, signature)', rowSpan: 2 },
        { content: 'Traitement', colSpan: 4 },
        { content: "N° d'ordon-\nnance", rowSpan: 2 },
        { content: 'Délai d’attente compétition (facultatif)', rowSpan: 2 },
        { content: 'Délai d’attente abattage ou exclusion abattage', rowSpan: 2 },
      ],
      ['Nom du médicament', 'Voie administration, dose (facultatif si ordonnance à conserver 5 ans)', 'Date de début', 'Date de fin'],
    ],
    body: tousSoins.map((s) => ligneIntervention(s, parId.get(s.chevalId)?.nom ?? '?')),
    // signature tactile du vétérinaire dans la colonne « Intervenant (cachet, signature) »
    didParseCell: (c) => {
      const sig = c.section === 'body' && c.column.index === 3 ? tousSoins[c.row.index]?.details.signature : null;
      if (sig) {
        c.cell.styles.minCellHeight = 15;
        c.cell.styles.valign = 'top';
      }
    },
    didDrawCell: (c) => {
      const sig = c.section === 'body' && c.column.index === 3 ? tousSoins[c.row.index]?.details.signature : null;
      if (!sig) return;
      const h = 8;
      const w = Math.min(c.cell.width - 2, (h * 600) / 220);
      doc.addImage(String(sig), 'PNG', c.cell.x + 1, c.cell.y + c.cell.height - h - 1, w, h);
    },
    styles: { ...tableau.styles, fontSize: 7.5 },
    headStyles: { ...tableau.headStyles, fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 18, halign: 'center' },
      1: { cellWidth: 30, fontStyle: 'bold' },
      2: { cellWidth: 44 },
      3: { cellWidth: 30 },
      4: { cellWidth: 30 },
      5: { cellWidth: 30 },
      6: { cellWidth: 16, halign: 'center' },
      7: { cellWidth: 16, halign: 'center' },
      8: { cellWidth: 20 },
      9: { cellWidth: 17 },
    },
  });

  // 8. Contrôle du registre
  nouvellePage("CONTRÔLE DU REGISTRE D'ÉLEVAGE");
  autoTable(doc, {
    ...tableau,
    startY: 44,
    head: [['Date', 'Organisme de contrôle', 'Motif de contrôle', 'Nom du contrôleur', 'Cachet', 'Signature']],
    body: lignesVides(8, 6),
    bodyStyles: { minCellHeight: 15 },
  });

  // numéros de page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(110);
    doc.text(`Page ${i} / ${pages}`, L - marge, H - 7, { align: 'right' });
    doc.text(`${NOM_ECURIE} · registre d'élevage`, marge, H - 7);
  }

  await proposer(doc.output('blob'), `Registre d’élevage - Écurie de Vautorte - ${formater(ref).replace(/\//g, '-')}.pdf`);
}
