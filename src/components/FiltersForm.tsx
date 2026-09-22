import type { RefFilters, RefSort, SortKey } from '../lib/api/references';
import { SORT_LABELS } from '../lib/api/references';
import type { Facets, Stage, Tag } from '../lib/types';
import { Button, Input, Label, Select } from './ui';

export function FiltersForm({
  filters, setFilters, clearFilters, facets, tags, stage, idPrefix = 'f',
}: {
  filters: RefFilters; setFilters: (f: Partial<RefFilters>) => void; clearFilters: () => void;
  facets: Facets | undefined; tags: Tag[] | undefined; stage: Stage; idPrefix?: string;
}) {
  const id = (s: string) => `${idPrefix}-${s}`;
  return (
    <div className="grid gap-3 text-sm">
      <div>
        <Label htmlFor={id('status')}>Screening status {stage === 'full_text' ? '(full text)' : '(title/abstract)'}</Label>
        <Select id={id('status')} value={filters.status} onChange={(e) => setFilters({ status: e.target.value as RefFilters['status'] })}>
          <option value="all">All</option>
          <option value="unscreened">○ Unscreened</option>
          <option value="screened">Screened (any decision)</option>
          <option value="include">✓ Included</option>
          <option value="exclude">✕ Excluded</option>
          {stage === 'title_abstract' && <option value="maybe">? Maybe</option>}
        </Select>
      </div>
      <div>
        <Label htmlFor={id('source')}>Database</Label>
        <Select id={id('source')} value={filters.source} onChange={(e) => setFilters({ source: e.target.value })}>
          <option value="">All databases</option>
          {facets?.sources.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value="__none__">Not specified</option>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={id('yf')}>Year from</Label>
          <Input id={id('yf')} inputMode="numeric" placeholder={facets?.min_year ? String(facets.min_year) : ''} value={filters.yearFrom}
            onChange={(e) => setFilters({ yearFrom: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
        </div>
        <div>
          <Label htmlFor={id('yt')}>Year to</Label>
          <Input id={id('yt')} inputMode="numeric" placeholder={facets?.max_year ? String(facets.max_year) : ''} value={filters.yearTo}
            onChange={(e) => setFilters({ yearTo: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
        </div>
      </div>
      <div>
        <Label htmlFor={id('pt')}>Publication type</Label>
        <Select id={id('pt')} value={filters.pubType} onChange={(e) => setFilters({ pubType: e.target.value })}>
          <option value="">All types</option>
          {facets?.publication_types.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor={id('lang')}>Language</Label>
        <Select id={id('lang')} value={filters.language} onChange={(e) => setFilters({ language: e.target.value })}>
          <option value="">All languages</option>
          {facets?.languages.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      <fieldset>
        <legend className="mb-1 block text-sm font-medium text-slate-800">Tags {filters.tags.length > 1 && <span className="font-normal text-slate-500">(has all)</span>}</legend>
        {tags && tags.length ? (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => {
              const on = filters.tags.includes(t.name);
              return (
                <button key={t.id} type="button" aria-pressed={on}
                  onClick={() => setFilters({ tags: on ? filters.tags.filter((x) => x !== t.name) : [...filters.tags, t.name] })}
                  className={`rounded-md border px-2 py-0.5 text-xs ${on ? 'border-ink-900 bg-ink-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                  {on ? '✓ ' : '#'}{t.name}
                </button>
              );
            })}
          </div>
        ) : <p className="text-xs text-slate-500">No tags yet.</p>}
      </fieldset>
      <div>
        <Label htmlFor={id('dup')}>Duplicate status</Label>
        <Select id={id('dup')} value={filters.dup} onChange={(e) => setFilters({ dup: e.target.value as RefFilters['dup'] })}>
          <option value="active">Hide removed duplicates (default)</option>
          <option value="all">Everything, including removed duplicates</option>
          <option value="possible">Possible duplicates only</option>
          <option value="none">Not flagged</option>
          <option value="kept">Reviewed — kept</option>
          <option value="duplicate">Marked duplicate</option>
          <option value="merged">Merged</option>
        </Select>
      </div>
      <div>
        <Label htmlFor={id('fts')}>Full-text status</Label>
        <Select id={id('fts')} value={filters.ftStatus} onChange={(e) => setFilters({ ftStatus: e.target.value as RefFilters['ftStatus'] })}>
          <option value="">Any</option>
          <option value="not_available">Not available</option>
          <option value="available">Available</option>
          <option value="reviewed">Reviewed</option>
        </Select>
      </div>
      <div>
        <Label htmlFor={id('reason')}>Exclusion reason</Label>
        <Select id={id('reason')} value={filters.reason} onChange={(e) => setFilters({ reason: e.target.value })}>
          <option value="">Any</option>
          {facets?.reasons.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      <Button variant="ghost" size="sm" onClick={clearFilters}>Clear all filters</Button>
    </div>
  );
}

export function SortControl({ sort, setSort, id = 'sort' }: { sort: RefSort; setSort: (s: RefSort) => void; id?: string }) {
  return (
    <div className="flex items-center gap-1">
      <label htmlFor={id} className="sr-only">Sort by</label>
      <Select id={id} value={sort.key} onChange={(e) => setSort({ ...sort, key: e.target.value as SortKey })} className="py-1.5 text-xs">
        {Object.entries(SORT_LABELS).map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}
      </Select>
      <Button size="sm" variant="ghost" onClick={() => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
        aria-label={sort.dir === 'asc' ? 'Ascending — switch to descending' : 'Descending — switch to ascending'} title={sort.dir === 'asc' ? 'Ascending' : 'Descending'}>
        {sort.dir === 'asc' ? '↑' : '↓'}
      </Button>
    </div>
  );
}
