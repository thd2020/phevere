import { createHash } from 'crypto';

export function nodeSha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
