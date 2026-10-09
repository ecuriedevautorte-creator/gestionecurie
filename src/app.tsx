import { useEffect, useState } from 'preact/hooks';
import { db, ecrireReglage, useLive } from './db';
import { UTILISATEURS } from './model';
import { PageChevaux } from './pages/Chevaux';
import { PageFiche } from './pages/Fiche';
import { PageImport } from './pages/Import';
import { PageModifierCheval } from './pages/ModifierCheval';
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
  const utilisateur = useLive(async () => ((await db.reglages.get('utilisateur'))?.valeur as string | undefined) ?? '', []);

  if (utilisateur === undefined) return null;
  if (!utilisateur) return <ChoixUtilisateur />;

  const [page, id, action] = chemin;
  let contenu;
  if (page === 'cheval' && id && action === 'modifier') contenu = <PageModifierCheval id={id} utilisateur={utilisateur} />;
  else if (page === 'cheval' && id) contenu = <PageFiche id={id} />;
  else if (page === 'soin' && id) contenu = <PageSaisieSoin key={location.hash} id={id} params={params} utilisateur={utilisateur} />;
  else if (page === 'import') contenu = <PageImport utilisateur={utilisateur} />;
  else if (page === 'reglages') contenu = <PageReglages utilisateur={utilisateur} />;
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
        <p class="discret">Les comptes avec mot de passe arrivent à l'étape 3 (synchronisation).</p>
      </div>
    </div>
  );
}
