import { describe, expect, it } from 'vitest';
import { isTypingTarget } from '@/lib/keyboard-utils';

// Tests run in the node env, so targets are stubbed with the shape the helper reads.
function target(props: { tagName?: string; type?: string; isContentEditable?: boolean }) {
  return props as unknown as EventTarget;
}

describe('isTypingTarget', () => {
  it('returns false for a null target', () => {
    expect(isTypingTarget(null)).toBe(false);
  });

  it('treats text-entry inputs as typing', () => {
    expect(isTypingTarget(target({ tagName: 'INPUT', type: 'text' }))).toBe(true);
    expect(isTypingTarget(target({ tagName: 'INPUT', type: 'number' }))).toBe(true);
    expect(isTypingTarget(target({ tagName: 'INPUT', type: 'search' }))).toBe(true);
  });

  it('does not treat sliders, checkboxes, or radios as typing', () => {
    expect(isTypingTarget(target({ tagName: 'INPUT', type: 'range' }))).toBe(false);
    expect(isTypingTarget(target({ tagName: 'INPUT', type: 'checkbox' }))).toBe(false);
    expect(isTypingTarget(target({ tagName: 'INPUT', type: 'radio' }))).toBe(false);
  });

  it('treats textarea and select as typing', () => {
    expect(isTypingTarget(target({ tagName: 'TEXTAREA' }))).toBe(true);
    expect(isTypingTarget(target({ tagName: 'SELECT' }))).toBe(true);
  });

  it('treats contenteditable as typing regardless of tag', () => {
    expect(isTypingTarget(target({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
  });

  it('returns false for ordinary elements', () => {
    expect(isTypingTarget(target({ tagName: 'DIV' }))).toBe(false);
    expect(isTypingTarget(target({ tagName: 'BUTTON' }))).toBe(false);
    expect(isTypingTarget(target({ tagName: 'BODY' }))).toBe(false);
  });
});
