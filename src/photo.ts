/** Réduit une photo (au plus 800 px de côté, JPEG) pour qu'elle tienne dans la fiche et se partage vite. */
export async function reduirePhoto(fichier: Blob, cote = 800, qualite = 0.8): Promise<string> {
  const image = await createImageBitmap(fichier, { imageOrientation: 'from-image' });
  const echelle = Math.min(1, cote / Math.max(image.width, image.height));
  const toile = document.createElement('canvas');
  toile.width = Math.round(image.width * echelle);
  toile.height = Math.round(image.height * echelle);
  toile.getContext('2d')!.drawImage(image, 0, 0, toile.width, toile.height);
  image.close();
  return toile.toDataURL('image/jpeg', qualite);
}
