import { useEffect, useState } from 'preact/hooks';
import { db, ecrireReglage, useLive } from './db';
import { PageChevaux } from './pages/Chevaux';
import { PageFiche } from './pages/Fiche';
import { PageImport } from './pages/Import';

export const UTILISATEURS = ['Pierre-Alexandre', 'Chloé'] as const;

function useRoute(): string[] {
  const lire = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
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
  const route = useRoute();
  const utilisateur = useLive(async () => ((await db.reglages.get('utilisateur'))?.valeur as string | undefined) ?? '', []);

  if (utilisateur === undefined) return null;
  if (!utilisateur) return <ChoixUtilisateur />;

  const [page, id] = route;
  return (
    <div class="appli">
      <main>
        {page === 'cheval' && id ? <PageFiche id={id} /> : page === 'import' ? <PageImport utilisateur={utilisateur} /> : <PageChevaux />}
      </main>
      <nav class="barre">
        <a href="#/" class={!page || page === 'cheval' ? 'actif' : ''}>
          <span aria-hidden="true">🐴</span>Chevaux
        </a>
        <a href="#/import" class={page === 'import' ? 'actif' : ''}>
          <span aria-hidden="true">📥</span>Import
        </a>
      </nav>
    </div>
  );
}

function ChoixUtilisateur() {
  return (
    <div class="accueil">
      <img src="./icone.svg" alt="" width={72} height={72} />
      <h1>Gestion Écurie</h1>
      <p>Qui utilise ce téléphone ?</p>
      {UTILISATEURS.map((u) => (
        <button class="bouton large" onClick={() => ecrireReglage('utilisateur', u)}>
          {u}
        </button>
      ))}
      <p class="discret">Les comptes avec mot de passe arrivent à l'étape 3 (synchronisation).</p>
    </div>
  );
}
