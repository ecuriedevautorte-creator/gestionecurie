// Accès à la base partagée Supabase : connexion des gérants et échanges pour la synchronisation.

import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLE_PUBLIQUE, SUPABASE_URL } from './config';
import type { FicheServeur, JournalServeur, Serveur } from './synchro';

let client: Promise<SupabaseClient> | null = null;

export function supabase(): Promise<SupabaseClient> {
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_CLE_PUBLIQUE, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'vautorte-session' } }),
  );
  return client;
}

function verifier<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export const serveurSupabase: Serveur = {
  async generation() {
    const s = await supabase();
    const d = verifier(await s.from('etat').select('valeur').eq('cle', 'generation').single());
    return d!.valeur as string;
  },
  async toutEffacer() {
    const s = await supabase();
    return verifier(await s.rpc('tout_effacer')) as string;
  },
  async nombreFiches() {
    const s = await supabase();
    const r = await s.from('fiches').select('id', { count: 'exact', head: true });
    if (r.error) throw new Error(r.error.message);
    return r.count ?? 0;
  },
  async envoyer(entrees) {
    const s = await supabase();
    verifier(await s.rpc('appliquer_journal', { entrees }));
  },
  async fiches(apres, limite) {
    const s = await supabase();
    return verifier(
      await s.from('fiches').select('table_nom, id, donnees, revision').gt('revision', apres).order('revision').limit(limite),
    ) as FicheServeur[];
  },
  async journal(apres, jusqua, limite) {
    const s = await supabase();
    return verifier(
      await s
        .from('journal')
        .select('id, table_nom, fiche_id, operation, le, par, changements, revision')
        .gt('revision', apres)
        .lte('revision', jusqua)
        .order('revision')
        .limit(limite),
    ) as JournalServeur[];
  },
};
