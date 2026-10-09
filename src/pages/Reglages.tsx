import { useState } from 'preact/hooks';
import { formater } from '../dates';
import { db, ecrireReglage, useLive } from '../db';
import { restaurerSoin } from '../ecriture';
import { CORBEILLE_JOURS, INTERVALLES_PAR_DEFAUT, LIBELLES_SOIN, UTILISATEURS, type Intervalle } from '../model';
import { LIBELLES_INTERVALLES, useIntervalles } from '../reglages';

export function PageReglages({ utilisateur }: { utilisateur: string }) {
  const generaux = useIntervalles();
  const [modifs, setModifs] = useState<Record<string, Intervalle> | null>(null);
  const valeurs = modifs ?? generaux;
  const corbeille = useLive(async () => {
    const limite = new Date(Date.now() - CORBEILLE_JOURS * 86400000).toISOString();
    const supprimes = (await db.soins.toArray()).filter((s) => s.supprimeLe && s.supprimeLe > limite);
    const noms = new Map((await db.chevaux.toArray()).map((c) => [c.id, c.nom]));
    return supprimes.sort((a, b) => (a.supprimeLe! < b.supprimeLe! ? 1 : -1)).map((s) => ({ s, nom: noms.get(s.chevalId) ?? '?' }));
  });

  const changer = (cle: string, i: Partial<Intervalle>) => setModifs({ ...valeurs, [cle]: { ...valeurs[cle], ...i } });

  return (
    <div class="page">
      <h1>Réglages</h1>

      <section class="carte">
        <h2>Utilisateur de ce téléphone</h2>
        <div class="puces enveloppe">
          {UTILISATEURS.map((u) => (
            <button class={u === utilisateur ? 'puce active' : 'puce'} onClick={() => ecrireReglage('utilisateur', u)}>
              {u}
            </button>
          ))}
        </div>
        <p class="discret petit">Chaque saisie est signée de ce prénom.</p>
      </section>

      <section class="carte">
        <h2>Intervalles par défaut</h2>
        <p class="discret petit">Proposés à chaque nouveau soin. Un cheval peut avoir ses propres intervalles (bouton « Modifier » de sa fiche).</p>
        {Object.entries(LIBELLES_INTERVALLES).map(([cle, libelle]) => (
          <div class="champ">
            <span>{libelle}</span>
            <div class="intervalle">
              <input type="number" min="1" inputMode="numeric" value={valeurs[cle].valeur} onInput={(e) => changer(cle, { valeur: Number((e.target as HTMLInputElement).value) })} />
              <select value={valeurs[cle].unite} onChange={(e) => changer(cle, { unite: (e.target as HTMLSelectElement).value as Intervalle['unite'] })}>
                <option value="jours">jours</option>
                <option value="semaines">semaines</option>
                <option value="mois">mois</option>
              </select>
            </div>
          </div>
        ))}
        {modifs && (
          <button
            class="bouton large"
            onClick={async () => {
              await ecrireReglage('intervalles', modifs);
              setModifs(null);
            }}
          >
            Enregistrer les intervalles
          </button>
        )}
        <button
          class="bouton-texte"
          onClick={async () => {
            await ecrireReglage('intervalles', INTERVALLES_PAR_DEFAUT);
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
