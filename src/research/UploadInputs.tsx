import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui';

/** A file or signature picked on the form, uploaded only when the response is submitted. */
export interface PickedFile { blob: Blob; name: string; type: string; size: number }

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const IMAGE = 'image/jpeg,image/png,image/webp,image/heic,image/gif';
const DOCS = 'application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation';
const AUDIO = 'audio/mpeg,audio/mp4,audio/webm,audio/ogg,audio/wav';
export const UPLOAD_ACCEPT: Record<'image' | 'document' | 'any', string> = { image: IMAGE, document: DOCS, any: `${IMAGE},${DOCS},${AUDIO}` };
const KIND_TEXT = { image: 'a photo or image', document: 'a PDF, Word, Excel or text file', any: 'a photo, PDF, document or audio file' };

const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function FileInput({ id, labelId, accept, kind, value, onChange }: {
  id: string; labelId: string; accept: string; kind: 'image' | 'document' | 'any'; value?: PickedFile; onChange: (f: PickedFile | null) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const pick = (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) { setProblem(`This file is ${sizeText(file.size)}. The limit is 10 MB.`); return; }
    if (!accept.split(',').includes(file.type)) { setProblem(`Please choose ${KIND_TEXT[kind]}.`); return; }
    onChange({ blob: file, name: file.name.replace(/[/\\]/g, '_').slice(0, 150) || 'file', type: file.type, size: file.size });
  };
  return (
    <div data-testid="rh-file">
      {value ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span aria-hidden="true">📎</span>
          <span className="min-w-0 flex-1 break-all">{value.name} <span className="text-slate-500">· {sizeText(value.size)}</span></span>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Remove</Button>
        </div>
      ) : (
        <input id={id} aria-labelledby={labelId} type="file" accept={accept} onChange={(e) => pick(e.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-50" />
      )}
      <p className="mt-1 text-xs text-slate-500">Choose {KIND_TEXT[kind]}, up to 10 MB. It is sent when you submit.</p>
      {problem && <p className="mt-1 text-sm text-rose-700" role="alert">{problem}</p>}
    </div>
  );
}

/** Draw a signature with a finger, pen or mouse. Saved as a PNG when the response is submitted. */
export function SignaturePad({ id, labelId, value, onChange, disabled }: {
  id: string; labelId: string; value?: PickedFile; onChange: (f: PickedFile | null) => void; disabled?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(!value);

  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext('2d')!;
    const [x, y] = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d')!;
    const [x, y] = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    // A white background so the PNG reads well in any viewer.
    const src = ref.current!;
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    out.toBlob((b) => b && onChange({ blob: b, name: 'signature.png', type: 'image/png', size: b.size }), 'image/png');
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div data-testid="rh-signature">
      <canvas id={id} ref={ref} aria-labelledby={labelId} role="img" aria-label="Signature area" tabIndex={0}
        className="h-36 w-full touch-none rounded-lg border border-dashed border-slate-400 bg-white"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
        <span className="flex-1">{empty ? 'Sign above with your finger, a pen or the mouse.' : 'Signed.'}</span>
        {!empty && <Button size="sm" variant="ghost" onClick={clear}>Clear</Button>}
      </div>
    </div>
  );
}
