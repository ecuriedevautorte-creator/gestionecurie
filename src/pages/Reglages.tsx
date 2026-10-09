import { useState } from 'preact/hooks';
import { seDeconnecter, synchroniserMaintenant, useEtatSynchro, type EtatCompte } from '../compte';
import { formater } from '../dates';
import { db, ecrireReglage, useLive } from '../db';
import { enregistrerParametres, restaurerSoin } from '../ecriture';
import { CORBEILLE_JOURS, INTERVALLES_PAR_DEFAUT, INTERVALLES_USAGE_PAR_DEFAUT, LIBELLES_SOIN, USAGES, UTILISATEURS, type Intervalle, type Usage } from '../model';
import { LIBELLES_USAGE, useIntervalles } from '../reglages';
import { EditeurIntervalles } from './EditeurIntervalles';

export function PageReglages({ utilisateur, compte }: { utilisateur: string; compte: EtatCompte }) {
  const reglages = useIntervalles();
  const [categorie, setCategorie] = useState<Usage | ''>('');
  const [modifs, setModifs] = useState<Record<string, Intervalle> | null>(null);
  const enregistres = categorie ? (reglages.parUsage[categorie] ?? {}) : reglages.generaux;
  const valeurs = modifs ?? enregistres;
  const corbeille = useLive(async () => {
    const limite = new Date(Date.now() - CORBEILLE_JOURS * 86400000).toISOString();
    const supprimes = (await db.soins.toArray()).filter((s) => s.supprimeLe && s.supprimeLe > limite);
    const noms = new Map((await db.chevaux.toArray()).map((c) => [c.id, c.nom]));
    return supprimes.sort((a, b) => (a.supprimeLe! < b.supprimeLe! ? 1 : -1)).map((s) => ({ s, nom: noms.get(s.chevalId) ?? '?' }));
  });

  const changerCategorie = (c: Usage | '') => {
    if (modifs && !confirm('Les changements non enregistrés seront perdus. Continuer ?')) return;
    setModifs(null);
    setCategorie(c);
  };
  const enregistrer = async () => {
    if (!modifs) return;
    if (categorie) await enregistrerParametres({ intervalles: reglages.generaux, intervallesUsage: { ...reglages.parUsage, [categorie]: modifs } }, utilisateur);
    else await enregistrerParametres({ intervalles: modifs, intervallesUsage: reglages.parUsage }, utilisateur);
    setModifs(null);
  };

  return (
    <div class="page">
      <h1>Réglages</h1>

      {compte.etat === 'connecte' ? (
        <Synchro email={compte.email} prenom={compte.prenom} />
      ) : (
        <section class="carte">
          <h2>Utilisateur de ce téléphone</h2>
          <div class="puces enveloppe">
            {UTILISATEURS.map((u) => (
              <button class={u === utilisateur ? 'puce active' : 'puce'} onClick={() => ecrireReglage('utilisateur', u)}>
                {u}
              </button>
            ))}
          </div>
          <p class="discret petit">Chaque saisie est signée de ce prénom. Les données restent sur cet appareil tant que la base partagée n'est pas branchée.</p>
        </section>
      )}

      <section class="carte">
        <h2>Intervalles de rappel</h2>
        <p class="discret petit">
          Proposés à chaque nouveau soin. Une catégorie peut avoir ses propres intervalles, et un cheval les siens (bouton « Modifier » de sa fiche). Les soins déjà saisis gardent leur échéance.
        </p>
        <div class="puces enveloppe" role="tablist">
          <button role="tab" aria-selected={categorie === ''} class={categorie === '' ? 'puce active' : 'puce'} onClick={() => changerCategorie('')}>
            Tous les chevaux
          </button>
          {USAGES.map((u) => (
            <button role="tab" aria-selected={categorie === u} class={categorie === u ? 'puce active' : 'puce'} onClick={() => changerCategorie(u)}>
              {LIBELLES_USAGE[u]}
            </button>
          ))}
        </div>
        <p class="discret petit">
          {categorie
            ? `Laisse vide pour suivre le réglage « Tous les chevaux » (entre parenthèses). 0 = pas de rappel pour cette catégorie.`
            : 'Valeurs utilisées quand ni la catégorie ni le cheval n’ont de réglage propre. 0 = pas de rappel.'}
        </p>
        <EditeurIntervalles
          valeurs={valeurs}
          reference={categorie ? reglages.generaux : INTERVALLES_PAR_DEFAUT}
          onChange={(v) => setModifs(categorie ? v : { ...INTERVALLES_PAR_DEFAUT, ...v })}
        />
        {modifs && (
          <button class="bouton large" onClick={enregistrer}>
            Enregistrer les intervalles
          </button>
        )}
        <button
          class="bouton-texte"
          onClick={async () => {
            if (!confirm("Revenir aux valeurs d'origine pour toutes les catégories ?")) return;
            await enregistrerParametres({ intervalles: INTERVALLES_PAR_DEFAUT, intervallesUsage: INTERVALLES_USAGE_PAR_DEFAUT }, utilisateur);
            setModifs(null);
          }}
        >
          Revenir aux valeurs d'origine
        </button>
      </section>

      <section class="carte">
        <h2>Corbeille</h2>
        {!corbeille?.length ? (
          <p class="discret">Vide. Les soins supprimés y restent {CORBEILLE_JOURS} jours.</p>
        ) : (
          <ul class="repartition">
            {corbeille.map(({ s, nom }) => (
              <li>
                <span>
                  {nom} · {LIBELLES_SOIN[s.type]} du {formater(s.date)}
                </span>
                <button class="bouton-texte" onClick={() => restaurerSoin(s.id, utilisateur)}>
                  Récupérer
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section class="carte">
        <h2>Import Excel</h2>
        <a class="bouton" href="#/import">
          Importer le classeur
        </a>
      </section>
    </div>
  );
}

function Synchro({ email, prenom }: { email: string; prenom: string }) {
  const etat = useEtatSynchro();
  const enAttente = useLive(() => db.journal.where('envoye').equals(0).count());
  return (
    <section class="carte">
      <h2>Compte et partage</h2>
      <p>
        Connecté en tant que <strong>{prenom}</strong> <span class="discret petit">({email})</span>
      </p>
      <p class="discret">
        {etat.enCours
          ? 'Synchronisation en cours…'
          : etat.erreur === 'hors-ligne'
            ? `Hors ligne : ${enAttente ?? 0} saisie(s) en attente, envoyées au retour du réseau.`
            : etat.erreur
              ? `Échec de la dernière synchronisation : ${etat.erreur}`
              : etat.derniere
                ? `À jour (${new Date(etat.derniere).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}). Les données sont les mêmes sur le PC et les téléphones.`
                : 'En attente de la première synchronisation.'}
      </p>
      <div class="actions-fiche">
        <button class="bouton secondaire" onClick={() => synchroniserMaintenant()}>
          Synchroniser maintenant
        </button>
        <button
          class="bouton-texte"
          onClick={() => {
            if ((enAttente ?? 0) > 0 && !confirm(`${enAttente} saisie(s) ne sont pas encore envoyées. Se déconnecter quand même ?`)) return;
            void seDeconnecter();
          }}
        >
          Se déconnecter
        </button>
      </div>
    </section>
  );
}
