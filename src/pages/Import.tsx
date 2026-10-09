import { useState } from 'preact/hooks';
import { aujourdhui } from '../dates';
import { db, enregistrerImport, useLive } from '../db';
import { importerClasseur, type ResultatImport } from '../import/excel';
import type { Anomalie } from '../model';

const GROUPES: [Anomalie['gravite'], string, string][] = [
  ['a-trancher', 'À trancher', "Données importées telles quelles, avec un bandeau « À vérifier » sur la fiche. Rien n'a été modifié."],
  ['corrige', 'Corrigé automatiquement', 'Petites corrections faites à l’import. Dis-moi si l’une d’elles est fausse.'],
  ['info', 'Pour information', ''],
];

export function PageImport({ utilisateur }: { utilisateur: string }) {
  const [etat, setEtat] = useState<'attente' | 'lecture' | 'pret' | 'fait' | 'erreur'>('attente');
  const [resultat, setResultat] = useState<ResultatImport | null>(null);
  const [erreur, setErreur] = useState('');
  const dejaLa = useLive(async () => ({ chevaux: await db.chevaux.count(), anomalies: await db.anomalies.toArray() }));

  const lire = async (f: File) => {
    setEtat('lecture');
    try {
      const r = await importerClasseur(await f.arrayBuffer(), { auteur: `${utilisateur} (import Excel)`, maintenant: new Date().toISOString(), ref: aujourdhui() });
      setResultat(r);
      setEtat('pret');
    } catch (e) {
      setErreur(String(e));
      setEtat('erreur');
    }
  };

  const valider = async () => {
    if (!resultat) return;
    if (dejaLa && dejaLa.chevaux > 0 && !confirm('Remplacer toutes les données actuelles par celles de ce fichier ?')) return;
    await enregistrerImport(resultat);
    setEtat('fait');
  };

  const rapport = resultat?.anomalies ?? dejaLa?.anomalies ?? [];

  return (
    <div class="page">
      <h1>Import du classeur Excel</h1>
      <section class="carte">
        <p>Choisis le fichier Gestion_Ecurie.xlsx. L'application le lit, te montre ce qu'elle a trouvé, et n'enregistre rien avant ta validation.</p>
        <label class="bouton">
          Choisir le fichier
          <input type="file" accept=".xlsx" hidden onChange={(e) => (e.target as HTMLInputElement).files?.[0] && lire((e.target as HTMLInputElement).files![0])} />
        </label>
        {etat === 'lecture' && <p>Lecture en cours…</p>}
        {etat === 'erreur' && <p class="erreur">Le fichier n'a pas pu être lu : {erreur}</p>}
        {etat === 'fait' && (
          <p class="succes">
            Import terminé. <a href="#/">Voir les chevaux</a>
          </p>
        )}
      </section>

      {resultat && etat === 'pret' && (
        <section class="carte">
          <h2>Contenu trouvé</h2>
          <ul class="repartition">
            <li>
              <span>Chevaux</span>
              <span>{resultat.chevaux.length}</span>
            </li>
            <li>
              <span>Propriétaires</span>
              <span>{resultat.proprietaires.length}</span>
            </li>
            <li>
              <span>Soins</span>
              <span>{resultat.soins.length}</span>
            </li>
            <li>
              <span>Suivis de poulinières</span>
              <span>{resultat.saillies.length}</span>
            </li>
            <li>
              <span>Lignes vides ou de formules ignorées</span>
              <span>{Object.values(resultat.lignesIgnorees).reduce((a, b) => a + b, 0)}</span>
            </li>
          </ul>
          <button class="bouton large" onClick={valider}>
            Importer ces données
          </button>
        </section>
      )}

      {rapport.length > 0 && (
        <section class="carte">
          <h2>{resultat ? 'Rapport de lecture' : 'Rapport du dernier import'}</h2>
          {GROUPES.map(([g, titre, aide]) => {
            const liste = rapport.filter((a) => a.gravite === g);
            if (!liste.length) return null;
            return (
              <div class={`rapport rapport-${g}`}>
                <h3>
                  {titre} ({liste.length})
                </h3>
                {aide && <p class="discret petit">{aide}</p>}
                <ul>
                  {liste.map((a) => (
                    <li>
                      <span class="discret petit">
                        {a.onglet}
                        {a.ligne ? `, ligne ${a.ligne}` : ''}
                        {a.cheval ? ` · ${a.cheval}` : ''}
                      </span>
                      <br />
                      {a.message}
                      {a.correction && <span class="correction"> → {a.correction}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
