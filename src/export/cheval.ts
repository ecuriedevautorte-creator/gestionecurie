// Export de la fiche d'un cheval : Excel (pour retravailler les chiffres) ou PDF (pour imprimer ou envoyer).

import { ajouterJours, aujourdhui, formater } from '../dates';
import { db } from '../db';
import { calculerEcheances, prochaineDate, statutDuSoin, statutOrdonnance } from '../echeances';
import { DUREE_GESTATION_JOURS, LIBELLES_SOIN, type Cheval, type Proprietaire, type Saillie, type Soin } from '../model';

interface Donnees {
  cheval: Cheval;
  proprietaire?: Proprietaire;
  soins: Soin[];
  saillies: Saillie[];
  ref: string;
}

async function lire(id: string): Promise<Donnees> {
  const cheval = (await db.chevaux.get(id))!;
  const [soins, saillies, proprietaire] = await Promise.all([
    db.soins.where('chevalId').equals(id).toArray(),
    db.saillies.where('jumentId').equals(id).toArray(),
    cheval.proprietaireId ? db.proprietaires.get(cheval.proprietaireId) : undefined,
  ]);
  return {
    cheval,
    proprietaire,
    soins: soins.filter((s) => !s.supprimeLe).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    saillies: saillies.filter((s) => !s.supprimeLe).sort((a, b) => ((a.dateSaillie ?? '') < (b.dateSaillie ?? '') ? 1 : -1)),
    ref: aujourdhui(),
  };
}

const euros = (n: number | null) => (n === null ? '' : n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ') + ' €');

function identite(d: Donnees): [string, string][] {
  const c = d.cheval;
  return [
    ['Nom', c.nom],
    ['Sexe', c.sexe],
    ['Robe', c.robe],
    ['Race', c.race],
    ['Date de naissance', c.naissance ? (c.naissanceAnneeSeule ? c.naissance.slice(0, 4) : formater(c.naissance)) : ''],
    ['Père', c.pere],
    ['Mère', c.mere],
    ['Propriétaire', d.proprietaire ? [d.proprietaire.nom, d.proprietaire.adresse].filter(Boolean).join(', ') : ''],
    ['N° SIRE', c.sire],
    ['N° transpondeur', c.transpondeur],
    ['Catégorie', c.usage ?? ''],
    ["Date d'entrée", formater(c.entree)],
    ['Date de sortie', formater(c.sortie)],
    ['Motif de sortie', c.motifSortie],
    ['Destination', c.destination],
    ['Notes', c.notes],
  ];
}

function detailSoin(s: Soin): string {
  return [...new Set([s.motif, s.details.diagnostic, s.details.traitement, s.details.posologie, s.details.dureeJours ? `${s.details.dureeJours} jours` : null].filter(Boolean).map(String))].join(' · ');
}

function lignesSoins(d: Donnees) {
  return d.soins.map((s) => {
    const prochaine = s.type === 'ordonnance' ? null : prochaineDate(s);
    const statut = s.type === 'ordonnance' ? statutOrdonnance(s, d.ref) : statutDuSoin(s, d.soins, d.cheval, d.ref);
    return {
      date: formater(s.date),
      type: LIBELLES_SOIN[s.type],
      precision: s.precision,
      praticien: s.praticien,
      detail: detailSoin(s),
      cout: s.cout,
      prochaine: prochaine ? formater(prochaine) : '',
      statut: statut ?? '',
      facture: s.lienFacture,
      saisi: [s.creePar, s.creeLe ? formater(s.creeLe.slice(0, 10)) : ''].filter(Boolean).join(', '),
    };
  });
}

function lignesEcheances(d: Donnees) {
  return calculerEcheances([d.cheval], d.soins, d.ref).map((e) => ({
    soin: e.libelle,
    dernier: formater(e.soin.date),
    prochaine: formater(e.prochaine),
    statut: e.statut === 'EN RETARD' ? `EN RETARD (${-e.joursRestants} j)` : e.statut === 'BIENTÔT' ? `BIENTÔT (${e.joursRestants} j)` : 'OK',
  }));
}

function lignesSaillies(d: Donnees) {
  return d.saillies.map((s) => {
    const terme = s.termeManuel ?? (s.dateSaillie ? ajouterJours(s.dateSaillie, DUREE_GESTATION_JOURS) : null);
    return {
      saillie: formater(s.dateSaillie),
      etalon: s.etalon,
      echos: s.echos.filter((e) => e.date || e.observation).map((e) => `${formater(e.date)} : ${e.observation}`).join(' | '),
      terme: formater(terme),
      poulinage: formater(s.poulinage),
      poulain: [s.poulainNom, s.poulainSexe].filter(Boolean).join(', '),
    };
  });
}

function totaux(d: Donnees) {
  const annee = d.ref.slice(0, 4);
  const avecCout = d.soins.filter((s) => s.cout !== null);
  const parType = new Map<string, number>();
  for (const s of avecCout) parType.set(LIBELLES_SOIN[s.type], (parType.get(LIBELLES_SOIN[s.type]) ?? 0) + s.cout!);
  return {
    total: avecCout.reduce((t, s) => t + s.cout!, 0),
    annee,
    totalAnnee: avecCout.filter((s) => s.date.startsWith(annee)).reduce((t, s) => t + s.cout!, 0),
    parType: [...parType],
  };
}

const nomFichier = (c: Cheval, ext: string) => `${c.nom} - fiche du ${formater(aujourdhui()).replace(/\//g, '-')}.${ext}`;

/** Propose le fichier : partage (téléphone) ou téléchargement (ordinateur). */
export async function proposer(blob: Blob, nomLisible: string): Promise<void> {
  // sans accents : certains appareils remplacent sinon le nom par « download »
  const nom = nomLisible.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'").replace(/[^\w .'()-]/g, '_');
  const fichier = new File([blob], nom, { type: blob.type });
  const tactile = matchMedia('(pointer: coarse)').matches;
  if (tactile && navigator.canShare?.({ files: [fichier] })) {
    try {
      await navigator.share({ files: [fichier], title: nom });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function exporterExcel(id: string): Promise<void> {
  const d = await lire(id);
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = "L'Écurie de Vautorte";
  const entete = (ws: import('exceljs').Worksheet) => {
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C2B4A' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };

  const f = wb.addWorksheet('Fiche');
  f.columns = [
    { header: 'Rubrique', key: 'k', width: 22 },
    { header: 'Valeur', key: 'v', width: 60 },
  ];
  // le transpondeur reste du texte (15 chiffres, sans notation scientifique)
  identite(d).forEach(([k, v]) => f.addRow({ k, v }));
  const t = totaux(d);
  f.addRow({});
  f.addRow({ k: 'Frais totaux', v: t.total }).getCell('v').numFmt = '#,##0.00 €';
  f.addRow({ k: `Frais ${t.annee}`, v: t.totalAnnee }).getCell('v').numFmt = '#,##0.00 €';
  for (const [type, v] of t.parType) f.addRow({ k: `  dont ${type}`, v }).getCell('v').numFmt = '#,##0.00 €';
  entete(f);

  const e = wb.addWorksheet('Échéances');
  e.columns = [
    { header: 'Soin', key: 'soin', width: 26 },
    { header: 'Dernier', key: 'dernier', width: 12 },
    { header: 'Prochaine échéance', key: 'prochaine', width: 18 },
    { header: 'Statut', key: 'statut', width: 20 },
  ];
  lignesEcheances(d).forEach((l) => e.addRow(l));
  entete(e);

  const s = wb.addWorksheet('Soins');
  s.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Type', key: 'type', width: 14 },
    { header: 'Précision', key: 'precision', width: 18 },
    { header: 'Praticien', key: 'praticien', width: 20 },
    { header: 'Motif / diagnostic / traitement', key: 'detail', width: 50 },
    { header: 'Coût', key: 'cout', width: 11, style: { numFmt: '#,##0.00 €' } },
    { header: 'Prochaine échéance', key: 'prochaine', width: 18 },
    { header: 'Statut', key: 'statut', width: 12 },
    { header: 'Facture', key: 'facture', width: 30 },
    { header: 'Saisi par', key: 'saisi', width: 26 },
  ];
  lignesSoins(d).forEach((l) => s.addRow(l));
  s.autoFilter = { from: 'A1', to: 'J1' };
  entete(s);

  if (d.saillies.length) {
    const el = wb.addWorksheet('Élevage');
    el.columns = [
      { header: 'Saillie', key: 'saillie', width: 12 },
      { header: 'Étalon', key: 'etalon', width: 22 },
      { header: 'Échographies', key: 'echos', width: 50 },
      { header: 'Terme prévu', key: 'terme', width: 13 },
      { header: 'Poulinage', key: 'poulinage', width: 12 },
      { header: 'Poulain', key: 'poulain', width: 22 },
    ];
    lignesSaillies(d).forEach((l) => el.addRow(l));
    entete(el);
  }

  const tampon = await wb.xlsx.writeBuffer();
  await proposer(new Blob([tampon], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nomFichier(d.cheval, 'xlsx'));
}

export async function imageEnDataUrl(chemin: string): Promise<string | null> {
  try {
    const blob = await (await fetch(chemin)).blob();
    return await new Promise((ok) => {
      const r = new FileReader();
      r.onload = () => ok(r.result as string);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function exporterPdf(id: string): Promise<void> {
  const d = await lire(id);
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const marge = 14;
  const largeur = doc.internal.pageSize.getWidth();
  const bleu: [number, number, number] = [28, 43, 74];
  const or: [number, number, number] = [166, 138, 102];
  // Helvetica ne connaît pas les espaces fines insécables utilisées par le français
  const net = (s: string) => s.replace(/[  ]/g, ' ');

  // En-tête : logo, nom de l'écurie, date
  const logo = await imageEnDataUrl('./logo.png');
  if (logo) doc.addImage(logo, 'PNG', marge, 10, 22, 22);
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(...or);
  doc.text("L'Écurie de Vautorte", marge + 26, 18);
  doc.setFontSize(9).setTextColor(110);
  doc.text(`Fiche éditée le ${formater(d.ref)}`, marge + 26, 24);
  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...bleu);
  doc.text(net(d.cheval.nom), marge, 44);
  doc.setDrawColor(...or).setLineWidth(0.6).line(marge, 47, largeur - marge, 47);

  let y = 53;
  const photoLargeur = 60;
  if (d.cheval.photo) {
    const p = doc.getImageProperties(d.cheval.photo);
    const h = Math.min(60, (photoLargeur * p.height) / p.width);
    doc.addImage(d.cheval.photo, 'JPEG', largeur - marge - photoLargeur, y, photoLargeur, h);
  }

  const titre = (texte: string, yy: number) => {
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...bleu);
    doc.text(texte, marge, yy);
    return yy + 2;
  };
  const style = { font: 'helvetica', fontSize: 9, cellPadding: 1.6, textColor: 30 } as const;
  const entete = { fillColor: bleu, textColor: 255, fontStyle: 'bold' } as const;
  const suite = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  autoTable(doc, {
    startY: y,
    margin: { left: marge, right: d.cheval.photo ? marge + photoLargeur + 4 : marge },
    body: identite(d).filter(([, v]) => v).map(([k, v]) => [k, net(v)]),
    theme: 'plain',
    styles: style,
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 36, textColor: 90 } },
  });
  y = Math.max(suite(), d.cheval.photo ? y + 68 : 0);

  const t = totaux(d);
  y = titre('Frais', y);
  autoTable(doc, {
    startY: y,
    margin: { left: marge, right: marge },
    body: [['Total', euros(t.total)], [`En ${t.annee}`, euros(t.totalAnnee)], ...t.parType.map(([k, v]) => [`dont ${k}`, euros(v)])],
    theme: 'striped',
    styles: style,
    columnStyles: { 0: { cellWidth: 60 }, 1: { halign: 'right', cellWidth: 30 } },
    tableWidth: 90,
  });
  y = suite();

  const ech = lignesEcheances(d);
  y = titre('Prochaines échéances', y);
  autoTable(doc, {
    startY: y,
    margin: { left: marge, right: marge },
    head: [['Soin', 'Dernier', 'Prochaine échéance', 'Statut']],
    body: ech.length ? ech.map((l) => [l.soin, l.dernier, l.prochaine, l.statut]) : [['Aucune échéance', '', '', '']],
    styles: style,
    headStyles: entete,
    didParseCell: (c) => {
      if (c.section === 'body' && c.column.index === 3) {
        const v = String(c.cell.raw);
        if (v.startsWith('EN RETARD')) c.cell.styles.textColor = [178, 34, 34];
        else if (v.startsWith('BIENTÔT')) c.cell.styles.textColor = [190, 110, 0];
      }
    },
  });
  y = suite();

  if (d.saillies.length) {
    y = titre('Élevage', y);
    autoTable(doc, {
      startY: y,
      margin: { left: marge, right: marge },
      head: [['Saillie', 'Étalon', 'Échographies', 'Terme', 'Poulinage', 'Poulain']],
      body: lignesSaillies(d).map((l) => [l.saillie, l.etalon, l.echos, l.terme, l.poulinage, l.poulain]),
      styles: style,
      headStyles: entete,
    });
    y = suite();
  }

  y = titre(`Historique des soins (${d.soins.length})`, y);
  autoTable(doc, {
    startY: y,
    margin: { left: marge, right: marge },
    head: [['Date', 'Soin', 'Praticien', 'Détail', 'Coût', 'Prochaine']],
    body: lignesSoins(d).map((l) => [l.date, [l.type, l.precision].filter(Boolean).join(' · '), l.praticien, l.detail, euros(l.cout), l.prochaine]),
    styles: { ...style, fontSize: 8 },
    headStyles: entete,
    columnStyles: { 0: { cellWidth: 19 }, 1: { cellWidth: 32 }, 2: { cellWidth: 28 }, 4: { halign: 'right', cellWidth: 18 }, 5: { cellWidth: 19 } },
  });

  // pied de page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130);
    doc.text(`${net(d.cheval.nom)} · page ${i}/${pages}`, largeur / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' });
  }

  await proposer(doc.output('blob'), nomFichier(d.cheval, 'pdf'));
}
