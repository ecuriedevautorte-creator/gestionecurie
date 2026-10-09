import { useEffect, useState } from 'preact/hooks';
import { synchroConfiguree } from '../config';
import { aujourdhui } from '../dates';
import { db, useLive } from '../db';
import { enregistrerCheval, enregistrerParametres } from '../ecriture';
import { estPresent, ID_PARAMETRES, type Cheval } from '../model';
import { reduirePhoto } from '../photo';
import { appliquerRepartitionInitiale, EMPLACEMENTS, nomEmplacement } from '../plan';

export function PagePlan({ utilisateur }: { utilisateur: string }) {
  const ref = aujourdhui();
  const d = useLive(async () => {
    const [parametres, chevaux] = await Promise.all([db.parametres.get(ID_PARAMETRES), db.chevaux.toArray()]);
    return { plan: parametres?.plan ?? null, chevaux: chevaux.filter((c) => !c.supprimeLe && estPresent(c, ref)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')) };
  });
  const [choisi, setChoisi] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const [erreur, setErreur] = useState('');

  // répartition des chevaux donnée par PAF, une seule fois (après une première synchronisation si la base partagée est branchée)
  useEffect(() => {
    void (async () => {
      if (synchroConfiguree && !(await db.reglages.get('synchro.derniere'))) return;
      await appliquerRepartitionInitiale(utilisateur);
    })();
  }, []);

  if (!d) return null;
  const parEmplacement = new Map<string, Cheval[]>();
  for (const c of d.chevaux) if (c.paddock) parEmplacement.set(c.paddock, [...(parEmplacement.get(c.paddock) ?? []), c]);
  const sansPlace = d.chevaux.filter((c) => !c.paddock);
  const occupes = EMPLACEMENTS.filter((e) => parEmplacement.has(e.id));

  const choisirPlan = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) return setErreur('Choisissez une image (JPG ou PNG) du plan.');
    try {
      await enregistrerParametres({ plan: await reduirePhoto(f, 1400, 0.82) }, utilisateur);
      setErreur('');
    } catch {
      setErreur("Cette image n'a pas pu être lue.");
    }
  };

  return (
    <div class="page">
      <h1>Plan</h1>

      {d.plan ? (
        <div class={zoom ? 'plan-cadre zoom' : 'plan-cadre'}>
          <div class="plan">
            <img src={d.plan} alt="Plan de l'écurie" />
            {occupes.map((e) => {
              const chevaux = parEmplacement.get(e.id)!;
              return (
                <button
                  class={choisi === e.id ? 'repere actif' : 'repere'}
                  style={{ left: `${e.x}%`, top: `${e.y}%` }}
                  onClick={() => setChoisi(choisi === e.id ? null : e.id)}
                  aria-label={`${e.nom} : ${chevaux.map((c) => c.nom).join(', ')}`}
                >
                  <span class="repere-nombre">{chevaux.length}</span>
                  {(zoom || choisi === e.id) && <span class="repere-noms">{chevaux.map((c) => c.nom).join(', ')}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <section class="carte">
          <p>Le plan n'est pas encore enregistré. Ajoutez l'image du plan : elle sera partagée avec l'autre gérant.</p>
        </section>
      )}
      <div class="actions-fiche">
        {d.plan && (
          <button class="bouton secondaire petit-bouton" onClick={() => setZoom((z) => !z)}>
            {zoom ? 'Vue d’ensemble' : '🔍 Agrandir'}
          </button>
        )}
        <label class="bouton secondaire petit-bouton">
          {d.plan ? 'Changer le plan' : 'Ajouter le plan'}
          <input type="file" accept="image/*" hidden onChange={choisirPlan} />
        </label>
      </div>
      {erreur && <p class="erreur">{erreur}</p>}

      <section class="carte">
        <h2>Chevaux présents par emplacement</h2>
        {occupes.map((e) => (
          <div class={choisi === e.id ? 'groupe-paddock actif' : 'groupe-paddock'} onClick={() => setChoisi(e.id)}>
            <h3>
              📍 {e.nom} <span class="discret petit">({parEmplacement.get(e.id)!.length})</span>
            </h3>
            <ul>
              {parEmplacement.get(e.id)!.map((c) => (
                <LigneCheval cheval={c} utilisateur={utilisateur} />
              ))}
            </ul>
          </div>
        ))}
        {sansPlace.length > 0 && (
          <div class="groupe-paddock">
            <h3>Sans emplacement</h3>
            <ul>
              {sansPlace.map((c) => (
                <LigneCheval cheval={c} utilisateur={utilisateur} />
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function LigneCheval({ cheval, utilisateur }: { cheval: Cheval; utilisateur: string }) {
  return (
    <li class="ligne-paddock">
      <a href={`#/cheval/${cheval.id}`}>{cheval.nom}</a>
      <ChoixEmplacement
        valeur={cheval.paddock ?? ''}
        onChange={(paddock) => enregistrerCheval({ ...cheval, paddock: paddock || null }, utilisateur)}
        libelle={`Emplacement de ${cheval.nom}`}
      />
    </li>
  );
}

export function ChoixEmplacement({ valeur, onChange, libelle }: { valeur: string; onChange: (v: string) => void; libelle: string }) {
  return (
    <select class="choix-paddock" aria-label={libelle} value={valeur} onChange={(e) => onChange((e.target as HTMLSelectElement).value)} onClick={(e) => e.stopPropagation()}>
      <option value="">—</option>
      {EMPLACEMENTS.map((e) => (
        <option value={e.id}>{e.nom}</option>
      ))}
    </select>
  );
}

export { nomEmplacement };
