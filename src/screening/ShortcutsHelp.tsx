import { Kbd, Modal } from '../components/ui';

const ROWS: [string, string][] = [
  ['I', 'Include'], ['E', 'Exclude (then 1–9 to pick a reason)'], ['M', 'Maybe (title/abstract only)'],
  ['N', 'Next article in list'], ['P', 'Previous article in list'], ['U', 'Undo last decision'],
  ['/', 'Search'], ['C', 'Show review criteria'], ['L', 'Show article list (small screens)'], ['?', 'This help'], ['Esc', 'Close panel / cancel'],
];

export function ShortcutsHelp({ open, onClose, enabled, onToggle }: { open: boolean; onClose: () => void; enabled: boolean; onToggle: (v: boolean) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <table className="w-full text-sm">
        <tbody>
          {ROWS.map(([k, d]) => (
            <tr key={k} className="border-b border-slate-100 last:border-0">
              <td className="w-16 py-1.5"><Kbd>{k}</Kbd></td>
              <td className="py-1.5">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        Enable keyboard shortcuts for this project
      </label>
      <p className="mt-2 text-xs text-slate-500">Shortcuts are ignored while you are typing in a text box.</p>
    </Modal>
  );
}
