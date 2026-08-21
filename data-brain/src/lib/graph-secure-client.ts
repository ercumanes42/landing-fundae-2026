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

export interface GraphDraftIntegrity extends GraphMessageEvidence {
  subject: string;
  htmlBody: string;
  recipients: string[];
  marker: string | null;
  attachments: GraphAttachment[];
  from?: string | null;
  sender?: string | null;
  replyTo?: string[] | null;
}

export interface GraphInboundMessage {
  id: string;
  conversationId: string | null;
  internetMessageId: string | null;
  receivedDateTime: string;
  subject: string;
  bodyPreview: string;
  uniqueBody: string | null;
  internetMessageHeaders: Array<{ name: string; value: string }>;
}

export interface GraphInboundDeltaPage {
  messages: GraphInboundMessage[];
  nextLink: string | null;
  deltaLink: string | null;
}

interface GraphClientOptions {
  mailboxUserId: string;
  mailboxAddress: string;
  accessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  requestTimeoutMs?: number;
  readMaxAttempts?: number;
  maxRetryDelayMs?: number;
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

function retryAfterMilliseconds(response: Response): number {
  const value = response.headers.get('retry-after');
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

export class SecureMicrosoftGraphClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly readMaxAttempts: number;
  private readonly maxRetryDelayMs: number;
  private readonly mailboxPath: string;
  private readonly mailboxAddress: string;

  constructor(private readonly options: GraphClientOptions) {
    if (!validOpaque(options.mailboxUserId, 320)) throw new Error('Graph mailbox is invalid');
    const mailboxAddress = options.mailboxAddress.trim().toLowerCase();
    if (!validOpaque(mailboxAddress, 320) || !/^[^\s@]+@[^\s@]+$/.test(mailboxAddress)) {
      throw new Error('Graph mailbox address is invalid');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.timeoutMs = Math.max(250, options.requestTimeoutMs ?? 10_000);
    this.readMaxAttempts = Math.min(8, Math.max(1, options.readMaxAttempts ?? 4));
    this.maxRetryDelayMs = Math.max(0, options.maxRetryDelayMs ?? 30_000);
    this.mailboxPath = `/users/${encodeURIComponent(options.mailboxUserId)}`;
    this.mailboxAddress = mailboxAddress;
  }

  private async requestOnce(
    operation: string,
    path: string,
    init: RequestInit,
    ambiguousOnFailure: boolean,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const token = await this.options.accessToken();
      if (!validOpaque(token, 16_384)) throw new Error('Graph access token is unavailable');
      return await this.fetchImpl(`https://graph.microsoft.com/v1.0${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: GRAPH_IMMUTABLE_ID_PREFERENCE,
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      if (error instanceof GraphRequestError) throw error;
      throw new GraphRequestError(operation, null, ambiguousOnFailure);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async read(operation: string, path: string, requestHeaders: Record<string, string> = {}): Promise<Response> {
    for (let attempt = 1; attempt <= this.readMaxAttempts; attempt += 1) {
      try {
        const response = await this.requestOnce(operation, path, { method: 'GET', headers: requestHeaders }, false);
        if (response.ok || response.status === 404) return response;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === this.readMaxAttempts) {
          throw new GraphRequestError(operation, response.status, retryable);
        }
        const retryAfter = retryAfterMilliseconds(response);
        if (retryAfter > this.maxRetryDelayMs) {
          throw new GraphRequestError(operation, response.status, true);
        }
        await this.sleep(retryAfter || Math.min(this.maxRetryDelayMs, 250 * 2 ** (attempt - 1)));
      } catch (error) {
        if (!(error instanceof GraphRequestError) || error.status !== null || attempt === this.readMaxAttempts) {
          throw error;
        }
        await this.sleep(Math.min(this.maxRetryDelayMs, 250 * 2 ** (attempt - 1)));
      }
    }
    throw new GraphRequestError(operation, null, true);
  }

  async createDraft(payload: GraphDraftPayload): Promise<GraphMessageEvidence> {
    if (!/^[a-f0-9]{64}$/.test(payload.marker)) throw new Error('Graph marker is invalid');
    const response = await this.requestOnce('create_draft', `${this.mailboxPath}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: payload.subject,
        body: { contentType: 'HTML', content: payload.htmlBody },
        toRecipients: [{ emailAddress: { address: payload.recipient } }],
        from: { emailAddress: { address: this.mailboxAddress } },
        sender: { emailAddress: { address: this.mailboxAddress } },
        replyTo: [{ emailAddress: { address: this.mailboxAddress } }],
        attachments: payload.attachments.map((attachment) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: attachment.filename,
          contentType: attachment.contentType,
          contentBytes: attachment.contentBase64,
        })),
        singleValueExtendedProperties: [{ id: GRAPH_MARKER_PROPERTY_ID, value: payload.marker }],
      }),
    }, true);
    if (response.status !== 201) {
      throw new GraphRequestError(
        'create_draft',
        response.status,
        response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
      );
    }
    try {
      return normalizeMessage(await response.json());
    } catch {
      throw new GraphRequestError('create_draft', response.status, true);
    }
  }

  async sendDraft(immutableId: string): Promise<void> {
    if (!validOpaque(immutableId)) throw new Error('Graph immutable ID is invalid');
    const response = await this.requestOnce(
      'send_draft',
      `${this.mailboxPath}/messages/${encodeURIComponent(immutableId)}/send`,
      { method: 'POST', headers: { 'Content-Length': '0' } },
      true,
    );
    if (response.status !== 202) {
      throw new GraphRequestError('send_draft', response.status, true);
    }
  }

  async findByMarker(marker: string): Promise<GraphMessageEvidence[]> {
    if (!/^[a-f0-9]{64}$/.test(marker)) throw new Error('Graph marker is invalid');
    const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${GRAPH_MARKER_PROPERTY_ID}' and ep/value eq '${marker}')`;
    const query = new URLSearchParams({
      '$filter': filter,
      '$select': 'id,changeKey,isDraft,parentFolderId,internetMessageId,sentDateTime',
      '$top': '3',
    });
    const response = await this.read('find_marker', `${this.mailboxPath}/messages?${query.toString()}`);
    if (response.status === 404) return [];
    const body = await response.json() as GraphCollection<unknown>;
    if (!Array.isArray(body.value)) throw new GraphRequestError('find_marker', null, true);
    return body.value.map(normalizeMessage);
  }

  async getMessage(immutableId: string): Promise<GraphMessageEvidence | null> {
    if (!validOpaque(immutableId)) throw new Error('Graph immutable ID is invalid');
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

  async getDraftIntegrity(immutableId: string): Promise<GraphDraftIntegrity | null> {
    if (!validOpaque(immutableId)) throw new Error('Graph immutable ID is invalid');
    const query = new URLSearchParams({
      '$select': 'id,changeKey,isDraft,parentFolderId,internetMessageId,sentDateTime,subject,body,toRecipients,from,sender,replyTo',
      '$expand': `singleValueExtendedProperties($filter=id eq '${GRAPH_MARKER_PROPERTY_ID}'),attachments($select=name,contentType,contentBytes)`,
    });
    const response = await this.read(
      'get_draft_integrity',
      `${this.mailboxPath}/messages/${encodeURIComponent(immutableId)}?${query.toString()}`,
    );
    if (response.status === 404) return null;
    const body = await response.json() as Record<string, unknown>;
    const evidence = normalizeMessage(body);
    const content = body.body && typeof body.body === 'object'
      ? body.body as Record<string, unknown>
      : {};
    const recipients = Array.isArray(body.toRecipients) ? body.toRecipients.map((recipient) => {
      const emailAddress = recipient && typeof recipient === 'object'
        ? (recipient as Record<string, unknown>).emailAddress
        : null;
      const address = emailAddress && typeof emailAddress === 'object'
        ? (emailAddress as Record<string, unknown>).address
        : null;
      return typeof address === 'string' ? address : '';
    }) : [];
    const mailboxAddress = (value: unknown, field: string): string | null => {
      if (value === undefined || value === null) return null;
      const emailAddress = value && typeof value === 'object'
        ? (value as Record<string, unknown>).emailAddress
        : null;
      const address = emailAddress && typeof emailAddress === 'object'
        ? (emailAddress as Record<string, unknown>).address
        : null;
      if (!validOpaque(address, 320) || !/^[^\s@]+@[^\s@]+$/.test(address)) {
        throw new GraphRequestError(`get_draft_integrity_${field}`, null, true);
      }
      return address;
    };
    let replyTo: string[] | null = null;
    if (body.replyTo !== undefined && body.replyTo !== null) {
      if (!Array.isArray(body.replyTo) || body.replyTo.length > 10) {
        throw new GraphRequestError('get_draft_integrity_reply_to', null, true);
      }
      replyTo = body.replyTo.map((recipient) => {
        const address = mailboxAddress(recipient, 'reply_to');
        if (!address) throw new GraphRequestError('get_draft_integrity_reply_to', null, true);
        return address;
      });
    }
    const properties = Array.isArray(body.singleValueExtendedProperties)
      ? body.singleValueExtendedProperties as Array<Record<string, unknown>>
      : [];
    const markerProperty = properties.find((property) => property.id === GRAPH_MARKER_PROPERTY_ID);
    const attachments = Array.isArray(body.attachments) ? body.attachments.map((attachment) => {
      const item = attachment && typeof attachment === 'object'
        ? attachment as Record<string, unknown>
        : {};
      if (!validOpaque(item.name, 200) || !validOpaque(item.contentType, 200) ||
          typeof item.contentBytes !== 'string') {
        throw new GraphRequestError('get_draft_integrity', null, true);
      }
      return { filename: item.name, contentType: item.contentType, contentBase64: item.contentBytes };
    }) : [];
    if (typeof body.subject !== 'string' || typeof content.content !== 'string') {
      throw new GraphRequestError('get_draft_integrity', null, true);
    }
    return {
      ...evidence,
      subject: body.subject,
      htmlBody: content.content,
      recipients,
      marker: typeof markerProperty?.value === 'string' ? markerProperty.value : null,
      attachments,
      from: mailboxAddress(body.from, 'from'),
      sender: mailboxAddress(body.sender, 'sender'),
      replyTo,
    };
  }

  async deleteDraft(immutableId: string): Promise<void> {
    if (!validOpaque(immutableId)) throw new Error('Graph immutable ID is invalid');
    const response = await this.requestOnce(
      'delete_draft',
      `${this.mailboxPath}/messages/${encodeURIComponent(immutableId)}`,
      { method: 'DELETE' },
      true,
    );
    if (response.status !== 204) throw new GraphRequestError('delete_draft', response.status, true);
  }

  async getSentItemsFolderId(): Promise<string> {
    const response = await this.read('get_sent_items', `${this.mailboxPath}/mailFolders/sentitems?$select=id`);
    if (response.status === 404) throw new GraphRequestError('get_sent_items', 404, false);
    const body = await response.json() as Record<string, unknown>;
    if (!validOpaque(body.id)) throw new GraphRequestError('get_sent_items', null, true);
    return body.id;
  }

  async listInboxDelta(cursor?: string | null, bootstrapFrom?: string): Promise<GraphInboundDeltaPage> {
    let path: string;
    if (cursor) {
      let url: URL;
      try { url = new URL(cursor); } catch { throw new GraphRequestError('inbox_delta_cursor', null, true); }
      if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith(`/v1.0${this.mailboxPath}/mailFolders/inbox/messages/delta`)) {
        throw new GraphRequestError('inbox_delta_cursor', null, true);
      }
      path = `${url.pathname.slice('/v1.0'.length)}${url.search}`;
    } else {
      if (!bootstrapFrom || !Number.isFinite(Date.parse(bootstrapFrom))) {
        throw new GraphRequestError('inbox_delta_bootstrap', null, true);
      }
      const query = new URLSearchParams({
        '$select': 'id,conversationId,internetMessageId,receivedDateTime,subject,bodyPreview,uniqueBody,internetMessageHeaders',
        '$top': '50',
        '$filter': `receivedDateTime ge ${new Date(bootstrapFrom).toISOString()}`,
        changeType: 'created',
      });
      path = `${this.mailboxPath}/mailFolders/inbox/messages/delta?${query.toString()}`;
    }
    const response = await this.read('inbox_delta', path, {
      Prefer: `${GRAPH_IMMUTABLE_ID_PREFERENCE}, outlook.body-content-type="text"`,
    });
    const body = await response.json() as GraphCollection<Record<string, unknown>> & {
      '@odata.nextLink'?: unknown;
      '@odata.deltaLink'?: unknown;
    };
    if (!Array.isArray(body.value)) throw new GraphRequestError('inbox_delta', null, true);
    const messages = body.value.filter((item) => !('@removed' in item)).map((item) => {
      if (!validOpaque(item.id) || !validOpaque(item.receivedDateTime, 128) ||
          typeof item.subject !== 'string' || typeof item.bodyPreview !== 'string') {
        throw new GraphRequestError('inbox_delta_parse', null, true);
      }
      const headers = Array.isArray(item.internetMessageHeaders)
        ? item.internetMessageHeaders.map((header) => {
            const value = header && typeof header === 'object' ? header as Record<string, unknown> : {};
            if (!validOpaque(value.name, 128) || typeof value.value !== 'string' || value.value.length > 8_192) {
              throw new GraphRequestError('inbox_delta_parse', null, true);
            }
            return { name: value.name, value: value.value };
          })
        : [];
      const uniqueBody = item.uniqueBody && typeof item.uniqueBody === 'object'
        ? item.uniqueBody as Record<string, unknown>
        : null;
      return {
        id: item.id,
        conversationId: validOpaque(item.conversationId) ? item.conversationId : null,
        internetMessageId: validOpaque(item.internetMessageId, 2_048) ? item.internetMessageId : null,
        receivedDateTime: new Date(item.receivedDateTime).toISOString(),
        subject: item.subject.slice(0, 1_024),
        bodyPreview: item.bodyPreview.slice(0, 4_096),
        uniqueBody: uniqueBody && typeof uniqueBody.content === 'string'
          ? uniqueBody.content.slice(0, 8_192)
          : null,
        internetMessageHeaders: headers,
      };
    });
    const link = (value: unknown) => typeof value === 'string' && value.length <= 16_384 ? value : null;
    return { messages, nextLink: link(body['@odata.nextLink']), deltaLink: link(body['@odata.deltaLink']) };
  }
}

interface GraphCollection<T> { value?: T[] }
