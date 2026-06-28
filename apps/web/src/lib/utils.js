import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// shadcn 慣例：合併 className 的工具
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
