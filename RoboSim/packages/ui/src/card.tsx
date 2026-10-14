import type { HTMLAttributes } from 'react';
import { cn } from './cn.js';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('rounded-lg border border-line bg-surface-raised p-6 shadow-sm', className)}
      {...props}
    />
  );
}
