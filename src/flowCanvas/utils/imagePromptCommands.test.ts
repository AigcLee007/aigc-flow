import { describe, expect, it } from 'vitest';
import {
  applySlashCommandToPrompt,
  extractMentionQuery,
  extractSlashQuery,
} from './imagePromptCommands';

describe('imagePromptCommands', () => {
  it('extracts mention and slash queries near caret', () => {
    const text = '做一张海报 @猪猪 /电影';
    expect(extractMentionQuery(text, text.indexOf('/') - 1)).toBe('猪猪');
    expect(extractSlashQuery(text, text.length)).toBe('电影');
  });

  it('returns null when no active token exists', () => {
    expect(extractMentionQuery('hello world', 5)).toBeNull();
    expect(extractSlashQuery('hello world', 5)).toBeNull();
  });

  it('injects slash prompt with newline when prompt already exists', () => {
    expect(applySlashCommandToPrompt('', '命令内容')).toBe('命令内容');
    expect(applySlashCommandToPrompt('已有描述', '命令内容')).toBe('已有描述\n命令内容');
  });
});
