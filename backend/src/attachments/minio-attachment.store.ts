import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Client } from 'minio';
import { AttachmentStore } from './attachment-store';

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === '1' || value === 'true' || value === 'yes';
}

@Injectable()
export class MinioAttachmentStore implements AttachmentStore, OnModuleInit {
  private readonly logger = new Logger(MinioAttachmentStore.name);
  private readonly bucket = env('MINIO_BUCKET', 'daybook-attachments');
  private readonly client = new Client({
    endPoint: env('MINIO_ENDPOINT', 'localhost'),
    port: Number(env('MINIO_PORT', '9000')),
    useSSL: boolEnv('MINIO_USE_SSL', false),
    region: env('MINIO_REGION', 'us-east-1'),
    accessKey: env('MINIO_ACCESS_KEY', env('MINIO_ROOT_USER', 'daybook')),
    secretKey: env('MINIO_SECRET_KEY', env('MINIO_ROOT_PASSWORD', 'daybook-minio')),
  });
  private readonly publicClient = new Client({
    endPoint: env('MINIO_PUBLIC_ENDPOINT', env('MINIO_ENDPOINT', 'localhost')),
    port: Number(env('MINIO_PUBLIC_PORT', env('MINIO_PORT', '9000'))),
    useSSL: boolEnv('MINIO_PUBLIC_USE_SSL', boolEnv('MINIO_USE_SSL', false)),
    region: env('MINIO_REGION', 'us-east-1'),
    accessKey: env('MINIO_ACCESS_KEY', env('MINIO_ROOT_USER', 'daybook')),
    secretKey: env('MINIO_SECRET_KEY', env('MINIO_ROOT_PASSWORD', 'daybook-minio')),
  });
  private bucketReady: Promise<void> | null = null;

  onModuleInit(): void {
    void this.ensureBucket().catch((error: unknown) => {
      this.logger.warn(`MinIO bucket is not ready yet: ${String(error)}`);
    });
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    try {
      await this.client.putObject(this.bucket, key, body, body.length, {
        'Content-Type': contentType,
      });
    } catch (error) {
      this.bucketReady = null;
      this.logger.error(`MinIO upload failed: ${String(error)}`);
      throw new ServiceUnavailableException('Attachment storage is unavailable');
    }
  }

  async getObject(key: string): Promise<Buffer> {
    try {
      const stream = await this.client.getObject(this.bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(`MinIO download failed: ${String(error)}`);
      throw new ServiceUnavailableException('Attachment file is unavailable');
    }
  }

  async removeObject(key: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, key);
    } catch (error) {
      this.logger.error(`MinIO delete failed: ${String(error)}`);
      throw new ServiceUnavailableException('Attachment storage is unavailable');
    }
  }

  async presignedGetUrl(
    key: string,
    filename: string,
    contentType: string,
  ): Promise<string> {
    try {
      return await this.publicClient.presignedGetObject(this.bucket, key, 15 * 60, {
        'response-content-disposition': `attachment; filename="${filename}"`,
        'response-content-type': contentType,
      });
    } catch (error) {
      this.logger.error(`MinIO presign failed: ${String(error)}`);
      throw new ServiceUnavailableException('Attachment storage is unavailable');
    }
  }

  private ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        const exists = await this.client.bucketExists(this.bucket);
        if (!exists) {
          await this.client.makeBucket(this.bucket);
        }
      })().catch((error: unknown) => {
        this.bucketReady = null;
        throw error;
      });
    }
    return this.bucketReady;
  }
}
