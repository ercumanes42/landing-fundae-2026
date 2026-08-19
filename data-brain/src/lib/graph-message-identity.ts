import { createHash } from 'node:crypto';

/**
 * Correlation-safe digest shared by outbound Sent Items evidence and inbound
 * In-Reply-To/References processing. The provider Message-ID is never stored.
 */
export function hashInternetMessageId(internetMessageId: string): string {
  return createHash('sha256')
    .update(`internet-message-id-v1\0${internetMessageId.trim()}`, 'utf8')
    .digest('hex');
}
