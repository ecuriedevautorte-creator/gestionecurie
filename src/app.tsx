import { useEffect, useState } from 'preact/hooks';
import { seConnecter, useCompte } from './compte';
import { db, ecrireReglage, useLive } from './db';
import { UTILISATEURS } from './model';
import { PageChevaux } from './pages/Chevaux';
import { PageFiche } from './pages/Fiche';
import { PageImport } from './pages/Import';
import { PageModifierCheval, PageNouveauCheval } from './pages/ModifierCheval';
import { PageReglages } from './pages/Reglages';
import { PageSaisieSoin } from './pages/SaisieSoin';

/** Adresse de la forme #/soin/nouveau?cheval=… */
function useRoute(): { chemin: string[]; params: URLSearchParams } {
  const lire = () => {
    const [chemin, requete] = location.hash.replace(/^#\/?/, '').split('?');
    return { chemin: chemin.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(requete ?? '') };
  };
  const [route, setRoute] = useState(lire);
  useEffect(() => {
    const maj = () => {
      setRoute(lire());
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', maj);
    return () => removeEventListener('hashchange', maj);
  }, []);
  return route;
}

export function App() {
  const { chemin, params } = useRoute();
  const compte = useCompte();
  const local = useLive(async () => ((await db.reglages.get('utilisateur'))?.valeur as string | undefined) ?? '', []);

  if (compte.etat === 'chargement' || local === undefined) return null;
  if (compte.etat === 'deconnecte') return <Connexion />;
  const utilisateur = compte.etat === 'connecte' ? compte.prenom : local;
  if (!utilisateur) return <ChoixUtilisateur />;

  const [page, id, action] = chemin;
  let contenu;
  if (page === 'cheval' && id === 'nouveau') contenu = <PageNouveauCheval utilisateur={utilisateur} />;
  else if (page === 'cheval' && id && action === 'modifier') contenu = <PageModifierCheval id={id} utilisateur={utilisateur} />;
  else if (page === 'cheval' && id) contenu = <PageFiche id={id} utilisateur={utilisateur} />;
  else if (page === 'soin' && id) contenu = <PageSaisieSoin key={location.hash} id={id} params={params} utilisateur={utilisateur} />;
  else if (page === 'import') contenu = <PageImport utilisateur={utilisateur} />;
  else if (page === 'reglages') contenu = <PageReglages utilisateur={utilisateur} compte={compte} />;
  else contenu = <PageChevaux />;

  const nouveauSoin = page === 'cheval' && id ? `#/soin/nouveau?cheval=${id}` : '#/soin/nouveau';
  return (
    <div class="appli">
      <div class="losanges bandeau-motif" aria-hidden="true" />
      <main>{contenu}</main>
      <nav class="barre">
        <a href="#/" class={!page || page === 'cheval' ? 'actif' : ''}>
          <span aria-hidden="true">🐴</span>Chevaux
        </a>
        <a href={nouveauSoin} class={`ajouter ${page === 'soin' ? 'actif' : ''}`}>
          <span aria-hidden="true">＋</span>Saisir un soin
        </a>
        <a href="#/reglages" class={page === 'reglages' || page === 'import' ? 'actif' : ''}>
          <span aria-hidden="true">⚙️</span>Réglages
        </a>
      </nav>
    </div>
  );
}

function ChoixUtilisateur() {
  return (
    <div class="losanges accueil-fond">
      <div class="accueil">
        <img class="logo-accueil" src="./logo.png" alt="L'Écurie de Vautorte" />
        <p>Qui utilise ce téléphone ?</p>
        {UTILISATEURS.map((u) => (
          <button class="bouton large" onClick={() => ecrireReglage('utilisateur', u)}>
            {u}
          </button>
        ))}
      </div>
    </div>
  );
}

function Connexion() {
  const [email, setEmail] = useState('');
  const [mdp, setMdp] = useState('');
  const [erreur, setErreur] = useState('');
  const [attente, setAttente] = useState(false);
  return (
    <div class="losanges accueil-fond">
      <form
        class="accueil"
        onSubmit={async (e) => {
          e.preventDefault();
          setAttente(true);
          setErreur((await seConnecter(email, mdp)) ?? '');
          setAttente(false);
        }}
      >
        <img class="logo-accueil" src="./logo.png" alt="L'Écurie de Vautorte" />
        <p>Connexion</p>
        <label class="champ">
          <span>Adresse e-mail</span>
          <input type="email" autoComplete="username" required value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
        </label>
        <label class="champ">
          <span>Mot de passe</span>
          <input type="password" autoComplete="current-password" required value={mdp} onInput={(e) => setMdp((e.target as HTMLInputElement).value)} />
        </label>
        {erreur && <p class="erreur">{erreur}</p>}
        <button class="bouton large" type="submit" disabled={attente}>
          {attente ? 'Connexion…' : 'Se connecter'}
        </button>
        <p class="discret petit">Une seule fois par appareil : la connexion est ensuite gardée, même sans réseau.</p>
      </form>
    </div>
  );
}
