export const ATTACHMENT_STORE = Symbol('ATTACHMENT_STORE');

export interface AttachmentStore {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  removeObject(key: string): Promise<void>;
  presignedGetUrl(key: string, filename: string, contentType: string): Promise<string>;
}
