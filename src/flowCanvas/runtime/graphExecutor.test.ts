import { describe, expect, it } from 'vitest';
import { mergeImageReferences } from './graphExecutor';

describe('mergeImageReferences', () => {
  it('merges upstream and node references and removes duplicates', () => {
    const upstream = ['https://a.png', 'https://b.png'];
    const data = {
      referenceImages: ['https://b.png', 'https://c.png', '', null],
    };

    expect(mergeImageReferences(upstream, data)).toEqual([
      'https://a.png',
      'https://b.png',
      'https://c.png',
    ]);
  });

  it('handles missing referenceImages safely', () => {
    expect(mergeImageReferences(['https://a.png'], {})).toEqual(['https://a.png']);
    expect(mergeImageReferences([], null)).toEqual([]);
  });
});
