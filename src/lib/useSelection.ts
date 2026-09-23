import { useCallback, useEffect, useState } from 'react';
import type { Decision } from './types';

/**
 * Multi-selection of references: individual ticks (remembered across pages)
 * or "all records matching the current view". Cleared whenever `resetKey`
 * (stage / filters / sort) changes, so a selection never silently covers
 * records the user cannot see.
 */
export function useSelection(resetKey: string) {
  const [picked, setPicked] = useState<Map<string, Decision | null>>(new Map());
  const [allMatching, setAllMatching] = useState(false);

  const clear = useCallback(() => {
    setPicked(new Map());
    setAllMatching(false);
  }, []);

  useEffect(() => clear(), [resetKey, clear]);

  const toggle = useCallback((id: string, decision: Decision | null) => {
    setAllMatching(false);
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(id)) n.delete(id);
      else n.set(id, decision);
      return n;
    });
  }, []);

  const setMany = useCallback((rows: { id: string; decision: Decision | null }[], on: boolean) => {
    setAllMatching(false);
    setPicked((m) => {
      const n = new Map(m);
      for (const r of rows) {
        if (on) n.set(r.id, r.decision);
        else n.delete(r.id);
      }
      return n;
    });
  }, []);

  return {
    picked,
    allMatching,
    selectAllMatching: () => setAllMatching(true),
    has: (id: string) => allMatching || picked.has(id),
    toggle,
    setMany,
    clear,
    count: (matching: number) => (allMatching ? matching : picked.size),
    active: allMatching || picked.size > 0,
  };
}
