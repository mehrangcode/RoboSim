import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown.js';

describe('step markdown', () => {
  it('renders the subset as elements, never as HTML', () => {
    const { container } = render(
      <Markdown
        text={
          'Use **bold**, *italic* and `code`.\n\n- one\n- two\n\n![The board](asset:board)\n\n![gone](asset:missing)\n\n<b>raw</b>'
        }
        assets={{ board: '<svg xmlns="http://www.w3.org/2000/svg"/>' }}
      />,
    );
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelector('em')).toHaveTextContent('italic');
    expect(container.querySelector('code')).toHaveTextContent('code');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['one', 'two']);
    expect(screen.getByRole('img', { name: 'The board' }).getAttribute('src')).toMatch(
      /^data:image\/svg\+xml/,
    );
    expect(screen.queryByRole('img', { name: 'gone' })).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('<b>raw</b>')).toBeInTheDocument();
  });
});
