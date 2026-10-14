// Enforces FR-I18N-02: layouts must use logical (start/end) Tailwind utilities so Persian RTL mirrors correctly.

const REPLACEMENTS = [
  [/^m([lr])(-|$)/, (m) => `m${m[1] === 'l' ? 's' : 'e'}${m[2]}`],
  [/^p([lr])(-|$)/, (m) => `p${m[1] === 'l' ? 's' : 'e'}${m[2]}`],
  [/^scroll-([mp])([lr])(-|$)/, (m) => `scroll-${m[1]}${m[2] === 'l' ? 's' : 'e'}${m[3]}`],
  [/^(left|right)(-|$)/, (m) => `${m[1] === 'left' ? 'start' : 'end'}${m[2]}`],
  [/^border-([lr])(-|$)/, (m) => `border-${m[1] === 'l' ? 's' : 'e'}${m[2]}`],
  [/^rounded-([lr])(-|$)/, (m) => `rounded-${m[1] === 'l' ? 's' : 'e'}${m[2]}`],
  [
    /^rounded-([tb])([lr])(-|$)/,
    (m) => `rounded-${m[1] === 't' ? 's' : 'e'}${m[2] === 'l' ? 's' : 'e'}${m[3]}`,
  ],
  [/^(text|float|clear)-(left|right)$/, (m) => `${m[1]}-${m[2] === 'left' ? 'start' : 'end'}`],
];

const CLASS_HELPERS = new Set(['cn', 'clsx', 'cva', 'twMerge', 'tv']);

/** Returns the logical replacement for a physical utility, or null when the class is fine. */
export function logicalReplacement(token) {
  const parts = token.split(':');
  const last = parts.pop() ?? '';
  const prefix = last.match(/^[!-]*/)?.[0] ?? '';
  const utility = last.slice(prefix.length);
  for (const [pattern, replace] of REPLACEMENTS) {
    const match = utility.match(pattern);
    if (match) return [...parts, prefix + utility.replace(pattern, replace(match))].join(':');
  }
  return null;
}

function isClassContext(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i];
    if (node.type === 'JSXAttribute') return node.name?.name === 'className' || node.name?.name === 'class';
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier')
      return CLASS_HELPERS.has(node.callee.name);
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow physical left/right Tailwind utilities; use logical start/end utilities (RTL support).',
    },
    messages: { physical: "'{{token}}' breaks RTL layouts; use '{{replacement}}' instead." },
    schema: [],
  },
  create(context) {
    function check(node, text) {
      if (!isClassContext(context.sourceCode.getAncestors(node))) return;
      for (const token of text.split(/\s+/).filter(Boolean)) {
        const replacement = logicalReplacement(token);
        if (replacement) context.report({ node, messageId: 'physical', data: { token, replacement } });
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};
