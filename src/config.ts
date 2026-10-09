// Adresse de la base partagée Supabase et sa clé publique (faite pour être visible : l'accès
// aux données exige en plus l'un des deux comptes créés dans Supabase).
// Tant que ces deux valeurs sont vides, l'application fonctionne seule sur l'appareil.
export const SUPABASE_URL = 'https://lgoxsglmnainkipfziry.supabase.co';
export const SUPABASE_CLE_PUBLIQUE = 'sb_publishable_5kx_o8tqtYIkCnz226nHGg_Ks_9_ig0';

export const synchroConfiguree = Boolean(SUPABASE_URL && SUPABASE_CLE_PUBLIQUE);

/** Prénom affiché pour chaque compte (alias Gmail de ecuriedevautorte@gmail.com). */
export function prenomDuCompte(email: string): string {
  const e = email.toLowerCase();
  if (e.includes('+pa@') || e.includes('+pierre')) return 'Pierre-Alexandre';
  if (e.includes('+chloe@') || e.includes('+chlo')) return 'Chloé';
  return email.split('@')[0];
}
