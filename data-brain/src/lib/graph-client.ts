export const GRAPH_IMMUTABLE_ID_PREFERENCE = 'IdType="ImmutableId"';
export const GRAPH_MARKER_PROPERTY_ID =
  'String {9d7b8c3f-36c3-4aa8-b1b5-0d71c11a9e8f} Name FundaeOpaqueMarker';

export interface GraphAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
}

export interface GraphDraftPayload {
  recipient: string;
  subject: string;
  htmlBody: string;
  marker: string;
  attachments: GraphAttachment[];
}

export interface GraphMessageEvidence {
  id: string;
  changeKey: string | null;
  isDraft: boolean | null;
  parentFolderId: string | null;
  internetMessageId: string | null;
  sentDateTime: string | null;
}

interface GraphCollection<T> {
  value?: T[];
}

interface GraphClientOptions {
  mailboxUserId: string;
  accessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  requestTimeoutMs?: number;
  readMaxAttempts?: number;
  maxRetryAfterMs?: number;
}

export class GraphRequestError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number | null,
    readonly ambiguous: boolean,
  ) {
    super(`Microsoft Graph ${operation} failed`);
  }
}

function validOpaque(value: unknown, maximum = 1024): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function normalizeMessage(value: unknown): GraphMessageEvidence {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (!validOpaque(item.id)) throw new GraphRequestError('parse_message', null, true);
  return {
    id: item.id,
    changeKey: validOpaque(item.changeKey) ? item.changeKey : null,
    isDraft: typeof item.isDraft === 'boolean' ? item.isDraft : null,
    parentFolderId: validOpaque(item.parentFolderId) ? item.parentFolderId : null,
    internetMessageId: validOpaque(item.internetMessageId, 2048) ? item.internetMessageId : null,
    sentDateTime: validOpaque(item.sentDateTime, 128) ? item.sentDateTime : null,
  };
}

function retryAfterMilliseconds(response: Response, maximum: number): number {
  const value = response.headers.get('retry-after');
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(maximum, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(maximum, Math.max(0, date - Date.now())) : 0;
}

export class MicrosoftGraphClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly readMaxAttempts: number;
  private readonly maxRetryAfterMs: number;
  private readonly mailboxPath: string;

  constructor(private readonly options: GraphClientOptions) {
    if (!validOpaque(options.mailboxUserId, 320)) throw new Error('Graph mailbox is invalid');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.timeoutMs = Math.max(250, options.requestTimeoutMs ?? 10_000);
    this.readMaxAttempts = Math.min(8, Math.max(1, options.readMaxAttempts ?? 4));
    this.maxRetryAfterMs = Math.min(60_000, Math.max(0, options.maxRetryAfterMs ?? 30_000));
    this.mailboxPath = `/users/${encodeURIComponent(options.mailboxUserId)}`;
  }

  private async requestOnce(
    operation: string,
    path: string,
    init: RequestInit,
    ambiguousOnFailure: boolean,
  ): Promise<Response> {
    const token = await this.options.accessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`https://graph.microsoft.com/v1.0${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: GRAPH_IMMUTABLE_ID_PREFERENCE,
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new GraphRequestError(operation, null, ambiguousOnFailure);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async read(operation: string, path: string): Promise<Response> {
    for (let attempt = 1; attempt <= this.readMaxAttempts; attempt += 1) {
      try {
        const response = await this.requestOnce(operation, path, { method: 'GET' }, false);
        if (response.ok || response.status === 404) return response;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === this.readMaxAttempts) {
          throw new GraphRequestError(operation, response.status, retryable);
        }
        const retryAfter = retryAfterMilliseconds(response, this.maxRetryAfterMs);
        await this.sleep(retryAfter || Math.min(this.maxRetryAfterMs, 250 * 2 ** (attempt - 1)));
      } catch (error) {
        if (!(error instanceof GraphRequestError) || error.status !== null || attempt === this.readMaxAttempts) {
          throw error;
        }
        await this.sleep(Math.min(this.maxRetryAfterMs, 250 * 2 ** (attempt - 1)));
      }
    }
    throw new GraphRequestError(operation, null, true);
  }

  async createDraft(payload: GraphDraftPayload): Promise<GraphMessageEvidence> {
    const response = await this.requestOnce('create_draft', `${this.mailboxPath}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: payload.subject,
        body: { contentType: 'HTML', content: payload.htmlBody },
        toRecipients: [{ emailAddress: { address: payload.recipient } }],
        attachments: payload.attachments.map((attachment) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: attachment.filename,
          contentType: attachment.contentType,
          contentBytes: attachment.contentBase64,
        })),
        singleValueExtendedProperties: [{
          id: GRAPH_MARKER_PROPERTY_ID,
          value: payload.marker,
        }],
      }),
    }, true);
    if (!response.ok) {
      throw new GraphRequestError(
        'create_draft',
        response.status,
        response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
      );
    }
    return normalizeMessage(await response.json());
  }

  async sendDraft(immutableId: string): Promise<void> {
    const response = await this.requestOnce(
      'send_draft',
      `${this.mailboxPath}/messages/${encodeURIComponent(immutableId)}/send`,
      { method: 'POST', headers: { 'Content-Length': '0' } },
      true,
    );
    if (response.status !== 202) {
      throw new GraphRequestError(
        'send_draft',
        response.status,
        response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
      );
    }
  }

  async findByMarker(marker: string): Promise<GraphMessageEvidence[]> {
    const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${GRAPH_MARKER_PROPERTY_ID}' and ep/value eq '${marker}')`;
    const query = new URLSearchParams({
      '$filter': filter,
      '$select': 'id,changeKey,isDraft,parentFolderId,internetMessageId,sentDateTime',
      '$top': '3',
    });
    const response = await this.read('find_marker', `${this.mailboxPath}/messages?${query.toString()}`);
    if (response.status === 404) return [];
    const body = await response.json() as GraphCollection<unknown>;
    return Array.isArray(body.value) ? body.value.map(normalizeMessage) : [];
  }

  async getMessage(immutableId: string): Promise<GraphMessageEvidence | null> {
    const query = new URLSearchParams({
      '$select': 'id,changeKey,isDraft,parentFolderId,internetMessageId,sentDateTime',
    });
    const response = await this.read(
      'get_message',
      `${this.mailboxPath}/messages/${encodeURIComponent(immutableId)}?${query.toString()}`,
    );
    if (response.status === 404) return null;
    return normalizeMessage(await response.json());
  }

  async getSentItemsFolderId(): Promise<string> {
    const response = await this.read(
      'get_sent_items',
      `${this.mailboxPath}/mailFolders/sentitems?$select=id`,
    );
    if (response.status === 404) throw new GraphRequestError('get_sent_items', 404, false);
    const body = await response.json() as Record<string, unknown>;
    if (!validOpaque(body.id)) throw new GraphRequestError('get_sent_items', null, true);
    return body.id;
  }
}
