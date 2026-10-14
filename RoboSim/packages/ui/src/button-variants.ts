import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-brand-600 text-white hover:bg-brand-700',
        secondary: 'border border-line bg-surface-raised text-ink hover:bg-surface',
        ghost: 'text-ink hover:bg-surface',
      },
      size: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);
