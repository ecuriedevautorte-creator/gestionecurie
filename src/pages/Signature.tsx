import { useEffect, useRef } from 'preact/hooks';

/**
 * Zone de signature : au doigt sur téléphone ou tablette, à la souris ou au stylet sur ordinateur.
 * La signature est rendue en image PNG (data URL) ; '' quand la zone est vide.
 */
export function PadSignature({ valeur, onChange }: { valeur: string; onChange: (v: string) => void }) {
  const toile = useRef<HTMLCanvasElement>(null);
  const trace = useRef(false);
  const dernier = useRef<{ x: number; y: number } | null>(null);

  // redessine la signature déjà enregistrée (modification d'un soin)
  useEffect(() => {
    const c = toile.current!;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (valeur) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = valeur;
    }
  }, []);

  const point = (e: PointerEvent) => {
    const c = toile.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };

  const debut = (e: PointerEvent) => {
    e.preventDefault();
    toile.current!.setPointerCapture(e.pointerId);
    trace.current = true;
    dernier.current = point(e);
  };
  const deplacer = (e: PointerEvent) => {
    if (!trace.current) return;
    e.preventDefault();
    const ctx = toile.current!.getContext('2d')!;
    const p = point(e);
    ctx.strokeStyle = '#1a2338';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(dernier.current!.x, dernier.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    dernier.current = p;
  };
  const fin = () => {
    if (!trace.current) return;
    trace.current = false;
    onChange(toile.current!.toDataURL('image/png'));
  };

  return (
    <div class="signature">
      <canvas
        ref={toile}
        width={600}
        height={220}
        aria-label="Zone de signature"
        onPointerDown={debut}
        onPointerMove={deplacer}
        onPointerUp={fin}
        onPointerCancel={fin}
        onPointerLeave={fin}
      />
      <div class="signature-pied">
        <span class="discret petit">{valeur ? 'Signé' : 'Signez dans le cadre avec le doigt ou la souris'}</span>
        {valeur && (
          <button
            type="button"
            class="bouton-texte"
            onClick={() => {
              const c = toile.current!;
              c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
              onChange('');
            }}
          >
            Effacer
          </button>
        )}
      </div>
    </div>
  );
}
