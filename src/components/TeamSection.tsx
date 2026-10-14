import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addMember, listTeam, removeMember, xk } from '../lib/api/extraction';
import { friendlyError } from '../lib/errors';
import { useAuth } from '../auth/AuthProvider';
import { Alert, Button, Input, Label, Spinner } from './ui';
import { useToast } from './Toast';

const ROLE = { owner: 'Owner', reviewer: 'Reviewer', viewer: 'Viewer' } as const;

export function TeamSection({ projectId, ownerId }: { projectId: string; ownerId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const team = useQuery({ queryKey: xk.team(projectId), queryFn: () => listTeam(projectId) });
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = user?.id === ownerId;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addMember(projectId, email);
      await qc.invalidateQueries({ queryKey: xk.team(projectId) });
      setEmail('');
      toast('Co-reviewer added');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 text-sm" data-testid="team">
      <p className="text-slate-600">
        Co-reviewers can screen and extract data in this project. Their extraction answers stay hidden from you, and yours from them, until both of you have completed the same study.
      </p>
      {!team.data ? <Spinner /> : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {team.data.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 px-3 py-2" data-testid="team-member">
              <span className="min-w-0 flex-1 truncate">{m.email}{m.user_id === user?.id && <span className="text-slate-500"> (you)</span>}</span>
              <span className="text-xs text-slate-500">{ROLE[m.role]}</span>
              {isOwner && m.role !== 'owner' && (
                <Button size="sm" variant="ghost" onClick={async () => {
                  if (!window.confirm(`Remove ${m.email} from this project? Their extractions stay in the project.`)) return;
                  try { await removeMember(projectId, m.user_id); await qc.invalidateQueries({ queryKey: xk.team(projectId) }); } catch (err) { toast(friendlyError(err), { kind: 'error' }); }
                }}>Remove</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isOwner ? (
        <form onSubmit={add} className="space-y-2">
          <Label htmlFor="team-email" hint="They need a ScreenLab account first: ask them to sign up, then add the same email here.">Add a co-reviewer by email</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="team-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-sm" placeholder="name@university.edu" />
            <Button type="submit" variant="primary" loading={busy}>Add</Button>
          </div>
          {error && <Alert>{error}</Alert>}
        </form>
      ) : (
        <p className="text-slate-500">Only the project owner can add or remove team members.</p>
      )}
    </div>
  );
}
