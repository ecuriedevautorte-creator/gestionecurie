import { useMemo, useState } from 'preact/hooks';
import { ageEnAnnees, annee, aujourdhui } from '../dates';
import { db, useLive } from '../db';
import { calculerEcheances } from '../echeances';
import { cleNom } from '../import/excel';
import { estPresent, type Cheval } from '../model';

type Filtre = 'presents' | 'sortis' | 'poulinieres' | 'tous';

const FILTRES: [Filtre, string][] = [
  ['presents', 'Présents'],
  ['sortis', 'Sortis'],
  ['poulinieres', 'Poulinières'],
  ['tous', 'Tous'],
];

export function PageChevaux() {
  const ref = aujourdhui();
  const donnees = useLive(async () => {
    const [chevaux, soins, saillies, proprietaires] = await Promise.all([
      db.chevaux.toArray(),
      db.soins.toArray(),
      db.saillies.toArray(),
      db.proprietaires.toArray(),
    ]);
    return { chevaux: chevaux.filter((c) => !c.supprimeLe), soins, saillies, proprietaires };
  });
  const [recherche, setRecherche] = useState('');
  const [filtre, setFiltre] = useState<Filtre>('presents');

  const alertes = useMemo(() => {
    const parCheval = new Map<string, { retard: number; bientot: number }>();
    if (!donnees) return parCheval;
    for (const e of calculerEcheances(donnees.chevaux, donnees.soins, ref)) {
      const a = parCheval.get(e.cheval.id) ?? { retard: 0, bientot: 0 };
      if (e.statut === 'EN RETARD') a.retard++;
      if (e.statut === 'BIENTÔT') a.bientot++;
      parCheval.set(e.cheval.id, a);
    }
    return parCheval;
  }, [donnees]);

  if (!donnees) return null;

  if (donnees.chevaux.length === 0) {
    return (
      <div class="page">
        <h1>Chevaux</h1>
        <div class="carte vide">
          <p>Aucun cheval pour l'instant.</p>
          <a class="bouton" href="#/import">
            Importer le classeur Excel
          </a>
          <a class="bouton secondaire" href="#/cheval/nouveau">
            + Nouveau cheval
          </a>
        </div>
      </div>
    );
  }

  const juments = new Set(donnees.saillies.map((s) => s.jumentId));
  const nomProprio = new Map(donnees.proprietaires.map((p) => [p.id, p.nom]));
  const q = cleNom(recherche);
  const liste = donnees.chevaux
    .filter((c) => {
      if (filtre === 'presents' && !estPresent(c, ref)) return false;
      if (filtre === 'sortis' && estPresent(c, ref)) return false;
      if (filtre === 'poulinieres' && !(c.sexe === 'Femelle' && (juments.has(c.id) || c.usage === 'Élevage'))) return false;
      if (!q) return true;
      const p = c.proprietaireId ? nomProprio.get(c.proprietaireId) ?? '' : '';
      return cleNom(`${c.nom} ${c.race} ${c.robe} ${p} ${c.sire} ${c.transpondeur}`).includes(q);
    })
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  return (
    <div class="page">
      <div class="marque">
        <img src="./logo.png" alt="" />
        <span>L'Écurie de Vautorte</span>
      </div>
      <header class="entete-page">
        <div class="titre-ligne">
          <h1>Chevaux</h1>
          <a class="bouton secondaire petit-bouton" href="#/cheval/nouveau">
            + Nouveau cheval
          </a>
        </div>
        <input
          type="search"
          class="recherche"
          placeholder="Rechercher un cheval, un propriétaire, un n° SIRE…"
          value={recherche}
          onInput={(e) => setRecherche((e.target as HTMLInputElement).value)}
        />
        <div class="puces" role="tablist">
          {FILTRES.map(([f, libelle]) => (
            <button role="tab" aria-selected={filtre === f} class={filtre === f ? 'puce active' : 'puce'} onClick={() => setFiltre(f)}>
              {libelle}
            </button>
          ))}
        </div>
      </header>
      <p class="discret compte">
        {liste.length} cheva{liste.length > 1 ? 'ux' : 'l'}
      </p>
      <ul class="liste">
        {liste.map((c) => (
          <LigneCheval cheval={c} proprio={c.proprietaireId ? nomProprio.get(c.proprietaireId) : undefined} alerte={alertes.get(c.id)} ref_={ref} />
        ))}
      </ul>
    </div>
  );
}

function LigneCheval(props: { cheval: Cheval; proprio?: string; alerte?: { retard: number; bientot: number }; ref_: string }) {
  const { cheval: c, alerte } = props;
  const age = c.naissance ? ageEnAnnees(c.naissance, props.ref_) : null;
  const details = [c.race, c.sexe, age !== null ? (age < 1 ? 'poulain de ' + annee(c.naissance!) : `${age} an${age > 1 ? 's' : ''}`) : null].filter(Boolean);
  return (
    <li>
      <a class="ligne" href={`#/cheval/${c.id}`}>
        {c.photo && <img class="vignette" src={c.photo} alt="" loading="lazy" />}
        <div class="ligne-texte">
          <strong>{c.nom}</strong>
          <span class="discret">{details.join(' · ')}</span>
          {props.proprio && <span class="discret petit">{props.proprio}</span>}
        </div>
        <div class="ligne-badges">
          {!estPresent(c, props.ref_) && <span class="pastille grise">Sorti</span>}
          {alerte && alerte.retard > 0 && <span class="pastille rouge">{alerte.retard} en retard</span>}
          {alerte && alerte.bientot > 0 && <span class="pastille orange">{alerte.bientot} bientôt</span>}
          {((c.aVerifier?.length ?? 0) > 0 || (c.conflits?.length ?? 0) > 0) && (
            <span class="pastille bleue" title="Points à vérifier">
              À vérifier
            </span>
          )}
        </div>
      </a>
    </li>
  );
}

