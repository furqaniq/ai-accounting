import { AttachmentStore } from './attachment-store';

interface MemoryObject {
  body: Buffer;
  contentType: string;
}

/**
 * Isolated test double for the object store. It lives in process memory so the
 * Jest suite can exercise the AttachmentStore lifecycle without MinIO.
 */
export class MemoryAttachmentStore implements AttachmentStore {
  private readonly objects = new Map<string, MemoryObject>();

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async getObject(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    if (!object) throw new Error('Attachment object not found');
    return Buffer.from(object.body);
  }

  async removeObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async presignedGetUrl(key: string, filename: string): Promise<string> {
    return `http://attachments.test/${encodeURIComponent(key)}?filename=${encodeURIComponent(filename)}`;
  }
}
