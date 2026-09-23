import { expect, it } from 'vitest';
import { termRegexPg } from '../../src/lib/api/references';

it('builds word-boundary PostgreSQL regexes for criteria terms', () => {
  expect(termRegexPg('deep learning')).toBe('\\mdeep[[:space:]-]+learning\\M');
  expect(termRegexPg('child*')).toBe('\\mchild');
  expect(termRegexPg('c++ (x)')).toBe('\\mc\\+\\+[[:space:]-]+\\(x\\)\\M');
});
