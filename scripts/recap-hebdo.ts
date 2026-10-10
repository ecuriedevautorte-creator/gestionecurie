// Lancé chaque lundi matin par GitHub Actions (.github/workflows/recap-hebdo.yml) :
// lit les chevaux et les soins dans la base partagée, puis envoie le récapitulatif des alertes par e-mail.
//
// Variables (secrets GitHub) : RECAP_COMPTE_EMAIL, RECAP_COMPTE_MOT_DE_PASSE (compte de l'application),
// RECAP_GMAIL, RECAP_GMAIL_MOT_DE_PASSE_APPLI (envoi), RECAP_DESTINATAIRES (facultatif, séparés par des virgules).
// RECAP_ESSAI=1 : affiche le récap sans l'envoyer.

import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { SUPABASE_CLE_PUBLIQUE, SUPABASE_URL } from '../src/config';
import type { Cheval, Soin } from '../src/model';
import { construireRecap } from '../src/recap';

const env = (k: string) => process.env[k]?.trim() ?? '';
const manque = (k: string) => {
  throw new Error(`Le secret ${k} n'est pas renseigné (GitHub › Settings › Secrets and variables › Actions).`);
};

async function main() {
  const email = env('RECAP_COMPTE_EMAIL') || manque('RECAP_COMPTE_EMAIL');
  const motDePasse = env('RECAP_COMPTE_MOT_DE_PASSE') || manque('RECAP_COMPTE_MOT_DE_PASSE');
  const essai = env('RECAP_ESSAI') === '1';

  const s = createClient(SUPABASE_URL, SUPABASE_CLE_PUBLIQUE, { auth: { persistSession: false } });
  const { error: errConnexion } = await s.auth.signInWithPassword({ email, password: motDePasse });
  if (errConnexion) throw new Error(`Connexion à la base refusée : ${errConnexion.message}`);

  const fiches: { table_nom: string; id: string; donnees: Record<string, unknown> }[] = [];
  for (let debut = 0; ; debut += 1000) {
    const { data, error } = await s.from('fiches').select('table_nom, id, donnees').in('table_nom', ['chevaux', 'soins']).order('id').range(debut, debut + 999);
    if (error) throw new Error(`Lecture de la base impossible : ${error.message}`);
    fiches.push(...data);
    if (data.length < 1000) break;
  }
  await s.auth.signOut();
  const de = <T>(table: string) => fiches.filter((f) => f.table_nom === table).map((f) => ({ ...f.donnees, id: f.id }) as T);
  const chevaux = de<Cheval>('chevaux');
  const soins = de<Soin>('soins');

  // date du jour à Paris (AAAA-MM-JJ)
  const ref = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const recap = construireRecap(chevaux, soins, ref);
  console.log(`${chevaux.length} chevaux, ${soins.length} soins lus. ${recap.retard} en retard, ${recap.bientot} bientôt.`);
  console.log(recap.sujet + '\n\n' + recap.texte);
  if (essai) return;

  const gmail = env('RECAP_GMAIL') || manque('RECAP_GMAIL');
  const appli = (env('RECAP_GMAIL_MOT_DE_PASSE_APPLI') || manque('RECAP_GMAIL_MOT_DE_PASSE_APPLI')).replace(/\s+/g, '');
  const destinataires = env('RECAP_DESTINATAIRES') || gmail;
  const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: gmail, pass: appli } });
  await transport.sendMail({ from: `Écurie de Vautorte <${gmail}>`, to: destinataires, subject: recap.sujet, text: recap.texte, html: recap.html });
  console.log(`E-mail envoyé à ${destinataires}.`);
}

main().catch((e) => {
  console.log(`::error title=Récapitulatif non envoyé::${(e as Error).message}`);
  process.exit(1);
});
