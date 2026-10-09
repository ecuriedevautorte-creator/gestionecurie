// Connexion des gérants et synchronisation automatique en arrière-plan.

import { useEffect, useState } from 'preact/hooks';
import { prenomDuCompte, synchroConfiguree } from './config';
import { db, ecrireReglage } from './db';
import { serveurSupabase, supabase } from './serveur';
import { synchroniser } from './synchro';

export type EtatCompte = { etat: 'chargement' } | { etat: 'sans-compte' } | { etat: 'deconnecte' } | { etat: 'connecte'; email: string; prenom: string };

export interface EtatSynchro {
  enCours: boolean;
  erreur: string | null;
  derniere: string | null;
}

let etatSynchro: EtatSynchro = { enCours: false, erreur: null, derniere: null };
const abonnes = new Set<(e: EtatSynchro) => void>();
const publier = (e: Partial<EtatSynchro>) => {
  etatSynchro = { ...etatSynchro, ...e };
  abonnes.forEach((f) => f(etatSynchro));
};

export function useEtatSynchro(): EtatSynchro {
  const [e, setE] = useState(etatSynchro);
  useEffect(() => {
    abonnes.add(setE);
    return () => void abonnes.delete(setE);
  }, []);
  return e;
}

let connecte = false;
let relance = false;

/** Lance une synchronisation (ou en programme une juste après celle en cours). */
export async function synchroniserMaintenant(): Promise<void> {
  if (!connecte) return;
  if (etatSynchro.enCours) {
    relance = true;
    return;
  }
  if (!navigator.onLine) return publier({ erreur: 'hors-ligne' });
  publier({ enCours: true });
  try {
    const bilan = await synchroniser(serveurSupabase);
    publier({
      enCours: false,
      erreur: bilan.fichiersEnEchec ? `${bilan.fichiersEnEchec} document(s) pas encore envoyé(s) dans la base partagée` : null,
      derniere: new Date().toISOString(),
    });
  } catch (e) {
    const message = String((e as Error).message ?? e);
    publier({ enCours: false, erreur: !navigator.onLine || /fetch|network/i.test(message) ? 'hors-ligne' : message });
  }
  if (relance) {
    relance = false;
    void synchroniserMaintenant();
  }
}

let minuterie: ReturnType<typeof setTimeout> | undefined;
function bientot() {
  clearTimeout(minuterie);
  minuterie = setTimeout(() => void synchroniserMaintenant(), 1500);
}

let demarre = false;
function demarrerBoucle() {
  if (demarre) return;
  demarre = true;
  // après chaque saisie locale
  db.journal.hook('creating', (_cle, e) => {
    if (e.envoye === 0) bientot();
  });
  addEventListener('online', () => void synchroniserMaintenant());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void synchroniserMaintenant());
  setInterval(() => document.visibilityState === 'visible' && void synchroniserMaintenant(), 30_000);
}

export function useCompte(): EtatCompte {
  const [compte, setCompte] = useState<EtatCompte>(synchroConfiguree ? { etat: 'chargement' } : { etat: 'sans-compte' });
  useEffect(() => {
    if (!synchroConfiguree) return;
    let fini = false;
    let desabonner = () => {};
    void supabase().then((s) => {
      const appliquer = (email: string | undefined) => {
        if (fini) return;
        if (!email) {
          connecte = false;
          return setCompte({ etat: 'deconnecte' });
        }
        const prenom = prenomDuCompte(email);
        void ecrireReglage('utilisateur', prenom);
        connecte = true;
        setCompte({ etat: 'connecte', email, prenom });
        demarrerBoucle();
        void synchroniserMaintenant();
      };
      // la session est gardée sur l'appareil : pas besoin de réseau pour rouvrir l'application
      void s.auth.getSession().then(({ data }) => appliquer(data.session?.user.email));
      const { data } = s.auth.onAuthStateChange((evenement, session) => {
        if (evenement === 'SIGNED_IN' || evenement === 'SIGNED_OUT') appliquer(session?.user.email);
      });
      desabonner = () => data.subscription.unsubscribe();
    });
    return () => {
      fini = true;
      desabonner();
    };
  }, []);
  return compte;
}

export async function seConnecter(email: string, motDePasse: string): Promise<string | null> {
  const s = await supabase();
  const { error } = await s.auth.signInWithPassword({ email: email.trim(), password: motDePasse });
  if (!error) return null;
  if (/invalid login/i.test(error.message)) return 'Adresse ou mot de passe incorrect.';
  if (!navigator.onLine) return 'Pas de réseau : la première connexion demande Internet.';
  if (/fetch|network/i.test(error.message)) return 'Impossible de joindre la base partagée. Vérifie la connexion Internet et réessaie.';
  return error.message;
}

export async function seDeconnecter(): Promise<void> {
  const s = await supabase();
  await s.auth.signOut({ scope: 'local' });
}
