import type { ReactNode } from 'react';
import { svgDataUrl } from './svg.js';

/**
 * The Markdown subset guided-project steps are written in: paragraphs, `- ` lists, **bold**, *italic*,
 * `code`, and images `![alt](asset:name)` from the project's own SVG assets. Rendered as React elements
 * (never as HTML), so content cannot inject markup; unknown image sources are dropped.
 */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}.${i}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={k}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return (
        <code key={k} dir="ltr" className="rounded bg-surface-raised px-1 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={k}>{part.slice(1, -1)}</em>;
    return part;
  });
}

const IMAGE = /^!\[([^\]]*)\]\(asset:([a-z0-9-]+)\)$/;

export function Markdown({ text, assets }: { text: string; assets: Readonly<Record<string, string>> }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      {blocks.map((block, b) => {
        const key = String(b);
        const image = IMAGE.exec(block.trim());
        if (image) {
          const svg = assets[image[2] ?? ''];
          return svg ? (
            <img key={key} src={svgDataUrl(svg)} alt={image[1]} className="max-w-full self-center" />
          ) : null;
        }
        const lines = block.split('\n');
        if (lines.every((l) => l.startsWith('- ')))
          return (
            <ul key={key} className="list-disc ps-5">
              {lines.map((l, i) => (
                <li key={i}>{inline(l.slice(2), `${key}.${i}`)}</li>
              ))}
            </ul>
          );
        return <p key={key}>{inline(lines.join(' '), key)}</p>;
      })}
    </div>
  );
}
