import { useState } from 'preact/hooks';
import { aujourdhui, formater } from '../dates';
import { db, useLive } from '../db';
import { ajouterDocument, analyserZip, importerZip, obtenirFichier, restaurerDocument, supprimerDocument, tailleLisible, type FichierZip } from '../documents';
import { proposer } from '../export/cheval';
import { cleNom } from '../import/excel';
import { CORBEILLE_JOURS, estPresent, type DocumentCheval } from '../model';

const icone = (d: DocumentCheval) => (d.typeMime === 'application/pdf' ? '📄' : d.typeMime.startsWith('image/') ? '🖼️' : '📎');

export function PageDocuments({ utilisateur }: { utilisateur: string }) {
  const ref = aujourdhui();
  const donnees = useLive(async () => {
    const [chevaux, documents] = await Promise.all([db.chevaux.toArray(), db.documents.toArray()]);
    return { chevaux: chevaux.filter((c) => !c.supprimeLe), documents: documents.filter((d) => !d.supprimeLe) };
  });
  const [recherche, setRecherche] = useState('');
  const [voirSortis, setVoirSortis] = useState(false);
  if (!donnees) return null;

  const nb = new Map<string, number>();
  for (const d of donnees.documents) nb.set(d.chevalId, (nb.get(d.chevalId) ?? 0) + 1);
  const q = cleNom(recherche);
  const dossiers = donnees.chevaux
    .filter((c) => (q ? cleNom(c.nom).includes(q) : voirSortis || estPresent(c, ref) || nb.has(c.id)))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  return (
    <div class="page">
      <h1>Documents</h1>

      <section class="carte">
        <h2>Registre d'élevage</h2>
        <p class="discret petit">Modèle SIRE, rempli avec les chevaux présents et sortis et tous les soins saisis.</p>
        <BoutonRegistre />
      </section>

      <section class="carte">
        <h2>Dossiers des chevaux</h2>
        <input type="search" class="recherche" placeholder="Rechercher un cheval…" value={recherche} onInput={(e) => setRecherche((e.target as HTMLInputElement).value)} />
        <ul class="dossiers">
          {dossiers.map((c) => (
            <li>
              <a class="dossier" href={`#/documents/${c.id}`}>
                <span aria-hidden="true">📁</span>
                <span class="dossier-nom">{c.nom}</span>
                <span class="discret petit">{nb.get(c.id) ? `${nb.get(c.id)} document${nb.get(c.id)! > 1 ? 's' : ''}` : 'vide'}</span>
              </a>
            </li>
          ))}
        </ul>
        {!q && (
          <button class="bouton-texte" onClick={() => setVoirSortis((v) => !v)}>
            {voirSortis ? 'Masquer les chevaux sortis sans document' : 'Afficher aussi les chevaux sortis'}
          </button>
        )}
      </section>

      <ImportZip utilisateur={utilisateur} />
    </div>
  );
}

function BoutonRegistre() {
  const [enCours, setEnCours] = useState(false);
  return (
    <button
      class="bouton"
      disabled={enCours}
      onClick={async () => {
        setEnCours(true);
        try {
          await (await import('../export/registre')).exporterRegistre();
        } catch (e) {
          console.error(e);
          alert("Le registre n'a pas pu être préparé.");
        }
        setEnCours(false);
      }}
    >
      {enCours ? 'Préparation…' : "📄 Télécharger le registre d'élevage (PDF)"}
    </button>
  );
}

/** Range d'un coup un dossier zippé contenant un sous-dossier par cheval. */
function ImportZip({ utilisateur }: { utilisateur: string }) {
  const [analyse, setAnalyse] = useState<FichierZip[] | null>(null);
  const [etat, setEtat] = useState('');
  const chevaux = useLive(() => db.chevaux.toArray());
  const nomDe = new Map((chevaux ?? []).map((c) => [c.id, c.nom]));
  const aImporter = analyse?.filter((f) => f.chevalId && !f.doublon) ?? [];
  return (
    <section class="carte">
      <h2>Ranger un dossier zippé</h2>
      <p class="discret petit">Un sous-dossier par cheval, nommé comme le cheval (ex. « Quercus de Vautorte »). Chaque fichier est rangé dans le dossier du cheval correspondant.</p>
      <label class="bouton secondaire">
        Choisir un fichier .zip
        <input
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={async (e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            (e.target as HTMLInputElement).value = '';
            if (!f) return;
            setEtat('Lecture…');
            try {
              setAnalyse(await analyserZip(f));
              setEtat('');
            } catch {
              setEtat("Ce fichier n'a pas pu être ouvert.");
            }
          }}
        />
      </label>
      {etat && <p class="discret">{etat}</p>}
      {analyse && (
        <>
          <ul class="repartition petit">
            {analyse.map((f) => (
              <li>
                <span>{f.nom}</span>
                <span class={f.chevalId && !f.doublon ? '' : 'discret'}>
                  {!f.chevalId ? `dossier « ${f.dossier} » : cheval introuvable` : f.doublon ? `déjà dans ${nomDe.get(f.chevalId)}` : `→ ${nomDe.get(f.chevalId)}`}
                </span>
              </li>
            ))}
          </ul>
          {aImporter.length > 0 ? (
            <button
              class="bouton large"
              onClick={async () => {
                const total = aImporter.length;
                const n = await importerZip(analyse, utilisateur, (fait) => setEtat(`Rangement : ${fait} / ${total}`));
                setAnalyse(null);
                setEtat(`${n} document${n > 1 ? 's' : ''} rangé${n > 1 ? 's' : ''}.`);
              }}
            >
              Ranger {aImporter.length} document{aImporter.length > 1 ? 's' : ''}
            </button>
          ) : (
            <p class="discret">Rien de nouveau à ranger.</p>
          )}
        </>
      )}
    </section>
  );
}

export function PageDossier({ id, utilisateur }: { id: string; utilisateur: string }) {
  const d = useLive(async () => {
    const cheval = await db.chevaux.get(id);
    const documents = await db.documents.where('chevalId').equals(id).toArray();
    return { cheval, documents };
  }, [id]);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState('');
  const [image, setImage] = useState<{ url: string; nom: string } | null>(null);
  if (!d) return null;
  if (!d.cheval) return <p class="page">Ce cheval n'existe pas.</p>;
  const limite = new Date(Date.now() - CORBEILLE_JOURS * 86400000).toISOString();
  const actifs = d.documents.filter((x) => !x.supprimeLe).sort((a, b) => b.creeLe.localeCompare(a.creeLe));
  const supprimes = d.documents.filter((x) => x.supprimeLe && x.supprimeLe > limite);

  const ouvrir = async (doc: DocumentCheval) => {
    setErreur('');
    try {
      const blob = await obtenirFichier(doc);
      const url = URL.createObjectURL(blob);
      if (doc.typeMime.startsWith('image/')) return setImage({ url, nom: doc.nom });
      const fenetre = window.open(url, '_blank');
      if (!fenetre) await proposer(blob, doc.nom);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setErreur((e as Error).message);
    }
  };

  return (
    <div class="page">
      <a href="#/documents" class="retour">
        ← Documents
      </a>
      <h1>📁 {d.cheval.nom}</h1>
      <p class="discret petit">
        <a href={`#/cheval/${id}`}>Voir la fiche du cheval</a>
      </p>

      <label class="bouton large">
        {envoi || '+ Ajouter des documents'}
        <input
          type="file"
          multiple
          accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.txt"
          hidden
          onChange={async (e) => {
            const input = e.target as HTMLInputElement;
            const fichiers = [...(input.files ?? [])];
            input.value = '';
            setErreur('');
            for (const [i, f] of fichiers.entries()) {
              setEnvoi(`Ajout ${i + 1} / ${fichiers.length}…`);
              try {
                await ajouterDocument(id, f, utilisateur);
              } catch (err) {
                setErreur((err as Error).message);
              }
            }
            setEnvoi('');
          }}
        />
      </label>
      <p class="discret petit">PDF, photos (prises avec le téléphone ou depuis la galerie), Word, Excel. 25 Mo maximum par fichier.</p>
      {erreur && <p class="erreur">{erreur}</p>}

      <section class="carte">
        {actifs.length === 0 ? (
          <p class="discret">Aucun document pour l'instant.</p>
        ) : (
          <ul class="documents">
            {actifs.map((doc) => (
              <li>
                <button class="document" onClick={() => ouvrir(doc)}>
                  <span class="document-icone" aria-hidden="true">
                    {icone(doc)}
                  </span>
                  <span class="document-texte">
                    <strong>{doc.nom}</strong>
                    <span class="discret petit">
                      {tailleLisible(doc.taille)} · ajouté le {formater(doc.creeLe.slice(0, 10))} par {doc.creePar}
                    </span>
                  </span>
                </button>
                <button
                  class="bouton-texte supprimer"
                  aria-label={`Supprimer ${doc.nom}`}
                  onClick={() => confirm(`Mettre « ${doc.nom} » à la corbeille ? (récupérable ${CORBEILLE_JOURS} jours)`) && supprimerDocument(doc, utilisateur)}
                >
                  🗑️
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {supprimes.length > 0 && (
        <details class="carte">
          <summary>Corbeille ({supprimes.length})</summary>
          <ul class="repartition">
            {supprimes.map((doc) => (
              <li>
                <span>{doc.nom}</span>
                <button class="bouton-texte" onClick={() => restaurerDocument(doc, utilisateur)}>
                  Récupérer
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {image && (
        <div class="visionneuse" role="dialog" aria-label={image.nom} onClick={(e) => e.target === e.currentTarget && setImage(null)}>
          <img src={image.url} alt={image.nom} />
          <div class="visionneuse-actions">
            <button
              class="bouton secondaire"
              onClick={async () => {
                const blob = await (await fetch(image.url)).blob();
                await proposer(blob, image.nom);
              }}
            >
              Télécharger
            </button>
            <button
              class="bouton"
              onClick={() => {
                URL.revokeObjectURL(image.url);
                setImage(null);
              }}
            >
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
