// Récapitulatif des alertes (« en retard » et « bientôt »), envoyé par e-mail chaque lundi matin.

import { formater, type ISODate } from './dates';
import { calculerEcheances, type Echeance } from './echeances';
import type { Cheval, Soin } from './model';

export const ADRESSE_APPLI = 'https://ecuriedevautorte-creator.github.io/gestionecurie/';

export interface Recap {
  sujet: string;
  texte: string;
  html: string;
  retard: number;
  bientot: number;
}

const echapper = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function quand(e: Echeance): string {
  const j = e.joursRestants;
  if (j < 0) return `prévu le ${formater(e.prochaine)} (${-j} jour${j < -1 ? 's' : ''} de retard)`;
  if (j === 0) return `prévu aujourd'hui (${formater(e.prochaine)})`;
  return `prévu le ${formater(e.prochaine)} (dans ${j} jour${j > 1 ? 's' : ''})`;
}

const parCheval = (a: Echeance, b: Echeance) => a.cheval.nom.localeCompare(b.cheval.nom, 'fr') || a.prochaine.localeCompare(b.prochaine);

export function construireRecap(chevaux: Cheval[], soins: Soin[], ref: ISODate): Recap {
  const echeances = calculerEcheances(chevaux, soins, ref);
  const retard = echeances.filter((e) => e.statut === 'EN RETARD').sort(parCheval);
  const bientot = echeances.filter((e) => e.statut === 'BIENTÔT').sort(parCheval);

  const sujet =
    retard.length + bientot.length === 0
      ? `Écurie de Vautorte : aucune alerte cette semaine`
      : `Écurie de Vautorte : ${retard.length} en retard, ${bientot.length} bientôt (semaine du ${formater(ref)})`;

  const sections: [string, string, Echeance[]][] = [
    ['🔴', 'En retard', retard],
    ['🟠', 'Bientôt', bientot],
  ];

  const lignesTexte = [`Récapitulatif du ${formater(ref)}`, ''];
  let html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1a2338;max-width:640px">`;
  html += `<h2 style="margin:0 0 4px">Récapitulatif des alertes</h2><p style="margin:0 0 16px;color:#666">Semaine du ${formater(ref)}</p>`;

  if (!retard.length && !bientot.length) {
    lignesTexte.push('Aucun soin en retard ni à prévoir dans les prochains jours.');
    html += `<p>Aucun soin en retard ni à prévoir dans les prochains jours. 👍</p>`;
  }
  for (const [pastille, titre, liste] of sections) {
    if (!liste.length) continue;
    lignesTexte.push(`${titre.toUpperCase()} (${liste.length})`);
    html += `<h3 style="margin:20px 0 8px">${pastille} ${titre} (${liste.length})</h3><table style="border-collapse:collapse;width:100%">`;
    for (const e of liste) {
      lignesTexte.push(`- ${e.cheval.nom} : ${e.libelle}, ${quand(e)}`);
      html += `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:bold">${echapper(e.cheval.nom)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee">${echapper(e.libelle)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;color:#555">${echapper(quand(e))}</td></tr>`;
    }
    html += `</table>`;
    lignesTexte.push('');
  }

  lignesTexte.push('', `Ouvrir l'application : ${ADRESSE_APPLI}`);
  lignesTexte.push("« Bientôt » = dans les 14 jours pour le maréchal, dans les 7 jours pour les autres soins.");
  html += `<p style="margin-top:24px"><a href="${ADRESSE_APPLI}" style="background:#1a2338;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Ouvrir l'application</a></p>`;
  html += `<p style="color:#888;font-size:12px">« Bientôt » = dans les 14 jours pour le maréchal, dans les 7 jours pour les autres soins. E-mail envoyé automatiquement chaque lundi matin.</p></div>`;

  return { sujet, texte: lignesTexte.join('\n'), html, retard: retard.length, bientot: bientot.length };
}
