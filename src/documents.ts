// Documents rangés par cheval : la fiche (nom, taille…) se synchronise comme les autres,
// le contenu est gardé sur l'appareil puis envoyé dans l'espace « documents » de la base partagée.

import { synchroConfiguree } from './config';
import { db } from './db';
import { ecrireDocument } from './ecriture';
import { cleNom } from './import/excel';
import type { Cheval, DocumentCheval } from './model';
import { reduirePhoto } from './photo';

export const TAILLE_MAX = 25 * 1024 * 1024;

/** Les photos prises au téléphone sont réduites (lisibles, mais 10 fois plus légères). */
async function preparer(f: File): Promise<Blob> {
  if (f.type.startsWith('image/') && f.type !== 'image/gif' && f.size > 600_000) {
    const dataUrl = await reduirePhoto(f, 2000, 0.85);
    return await (await fetch(dataUrl)).blob();
  }
  return f;
}

function nomFinal(f: File, contenu: Blob): string {
  if (contenu === f || !f.type.startsWith('image/')) return f.name;
  return f.name.replace(/\.[^.]+$/, '') + '.jpg';
}

export async function ajouterDocument(chevalId: string, f: File, auteur: string, nom?: string): Promise<DocumentCheval> {
  if (f.size > TAILLE_MAX) throw new Error(`« ${f.name} » dépasse 25 Mo.`);
  const contenu = await preparer(f);
  const id = crypto.randomUUID();
  const chemin = `${chevalId}/${id}`;
  await db.fichiers.put({ chemin, blob: contenu, envoye: 0 });
  return ecrireDocument(
    { id, creeLe: '', creePar: '', modifieLe: '', modifiePar: '', supprimeLe: null, chevalId, nom: nom ?? nomFinal(f, contenu), typeMime: contenu.type || f.type, taille: contenu.size, chemin },
    auteur,
  );
}

export async function supprimerDocument(d: DocumentCheval, auteur: string): Promise<void> {
  await ecrireDocument({ ...d, supprimeLe: new Date().toISOString() }, auteur, 'suppression');
}

export async function restaurerDocument(d: DocumentCheval, auteur: string): Promise<void> {
  await ecrireDocument({ ...d, supprimeLe: null }, auteur, 'restauration');
}

/** Contenu du document : sur l'appareil s'il y est, sinon téléchargé (puis gardé pour le hors ligne). */
export async function obtenirFichier(d: DocumentCheval): Promise<Blob> {
  const local = await db.fichiers.get(d.chemin);
  if (local) return local.blob;
  if (!synchroConfiguree) throw new Error("Ce document n'est pas sur cet appareil.");
  if (!navigator.onLine) throw new Error('Document pas encore téléchargé sur cet appareil : il faut du réseau pour l’ouvrir la première fois.');
  const { serveurSupabase } = await import('./serveur');
  const blob = await serveurSupabase.telechargerFichier(d.chemin);
  await db.fichiers.put({ chemin: d.chemin, blob, envoye: 1 });
  return blob;
}

export function tailleLisible(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

// ---------- Import d'un dossier zippé (un sous-dossier par cheval) ----------

export interface FichierZip {
  chemin: string;
  nom: string;
  dossier: string;
  chevalId: string | null;
  doublon: boolean;
  lire: () => Promise<Blob>;
}

/** Les noms de dossiers du zip peuvent contenir des accents codés (#U00e9 = é). */
function decoder(nom: string): string {
  return nom.replace(/#U([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

const TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

/** Rapproche un nom de dossier d'un cheval (accents, tirets, « D_Argentré » = « D'ARGENTRE »…). */
export function chevalDuDossier(dossier: string, chevaux: Cheval[]): Cheval | null {
  const k = (s: string) => cleNom(s).replace(/[^A-Z0-9]/g, '');
  const cle = k(decoder(dossier));
  if (!cle) return null;
  const exact = chevaux.find((c) => k(c.nom) === cle);
  if (exact) return exact;
  const proches = chevaux.filter((c) => k(c.nom).startsWith(cle) || cle.startsWith(k(c.nom)));
  return proches.length === 1 ? proches[0] : null;
}

export async function analyserZip(zip: Blob): Promise<FichierZip[]> {
  const { default: JSZip } = await import('jszip');
  const archive = await JSZip.loadAsync(zip);
  const chevaux = (await db.chevaux.toArray()).filter((c) => !c.supprimeLe);
  const existants = (await db.documents.toArray()).filter((d) => !d.supprimeLe);
  const resultat: FichierZip[] = [];
  archive.forEach((chemin, entree) => {
    if (entree.dir) return;
    const morceaux = chemin.split('/').filter(Boolean);
    const nom = decoder(morceaux[morceaux.length - 1]);
    if (nom.startsWith('.') || chemin.includes('__MACOSX')) return;
    const dossier = decoder(morceaux.length >= 2 ? morceaux[morceaux.length - 2] : '');
    const cheval = chevalDuDossier(dossier, chevaux);
    const ext = nom.split('.').pop()!.toLowerCase();
    resultat.push({
      chemin,
      nom,
      dossier,
      chevalId: cheval?.id ?? null,
      doublon: !!cheval && existants.some((d) => d.chevalId === cheval.id && d.nom === nom),
      lire: async () => new Blob([await entree.async('arraybuffer')], { type: TYPES[ext] ?? 'application/octet-stream' }),
    });
  });
  return resultat.sort((a, b) => a.dossier.localeCompare(b.dossier, 'fr') || a.nom.localeCompare(b.nom, 'fr'));
}

export async function importerZip(fichiers: FichierZip[], auteur: string, avance?: (fait: number) => void): Promise<number> {
  let n = 0;
  for (const f of fichiers) {
    if (!f.chevalId || f.doublon) continue;
    const blob = await f.lire();
    await ajouterDocument(f.chevalId, new File([blob], f.nom, { type: blob.type }), auteur, f.nom);
    avance?.(++n);
  }
  return n;
}

/** Tous les documents (d'un cheval, ou de tous) dans un zip : un dossier par cheval. */
export async function telechargerTout(chevalId?: string, avance?: (fait: number, total: number) => void): Promise<{ blob: Blob; manquants: string[] }> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const noms = new Map((await db.chevaux.toArray()).map((c) => [c.id, c.nom]));
  const docs = (await db.documents.toArray()).filter((d) => !d.supprimeLe && (!chevalId || d.chevalId === chevalId));
  const manquants: string[] = [];
  const pris = new Set<string>();
  for (const [i, d] of docs.entries()) {
    avance?.(i, docs.length);
    const dossier = (noms.get(d.chevalId) ?? 'Sans cheval').replace(/[\\/:*?"<>|]/g, '_');
    let nom = `${dossier}/${d.nom.replace(/[\\/:*?"<>|]/g, '_')}`;
    for (let n = 2; pris.has(nom); n++) nom = `${dossier}/${n} - ${d.nom}`;
    pris.add(nom);
    try {
      zip.file(nom, await obtenirFichier(d));
    } catch {
      manquants.push(`${noms.get(d.chevalId) ?? '?'} : ${d.nom}`);
    }
  }
  avance?.(docs.length, docs.length);
  return { blob: await zip.generateAsync({ type: 'blob' }), manquants };
}
