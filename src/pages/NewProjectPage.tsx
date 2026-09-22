import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { createProject } from '../lib/api/projects';
import { friendlyError } from '../lib/errors';
import { qk } from '../lib/hooks';
import { Card } from '../components/ui';
import { ProjectForm } from '../components/ProjectForm';

export function NewProjectPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-semibold text-ink-900">Create a review</h1>
      <Card className="p-5">
        <ProjectForm
          submitLabel="Create review"
          onCancel={() => nav('/projects')}
          onSubmit={async (v) => {
            try {
              const p = await createProject(v);
              await qc.invalidateQueries({ queryKey: qk.projects });
              nav(`/p/${p.id}`);
            } catch (e) {
              throw new Error(friendlyError(e));
            }
          }}
        />
      </Card>
    </div>
  );
}
