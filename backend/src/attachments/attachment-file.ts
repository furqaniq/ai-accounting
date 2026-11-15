import { BadRequestException } from '@nestjs/common';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

interface FileKind {
  contentType: string;
  extensions: readonly string[];
  matches: (buffer: Buffer) => boolean;
}

const startsWith = (buffer: Buffer, bytes: readonly number[]): boolean =>
  buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);

const FILE_KINDS: readonly FileKind[] = [
  {
    contentType: 'application/pdf',
    extensions: ['.pdf'],
    matches: (buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-',
  },
  {
    contentType: 'image/png',
    extensions: ['.png'],
    matches: (buffer) => startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    contentType: 'image/jpeg',
    extensions: ['.jpg', '.jpeg'],
    matches: (buffer) => startsWith(buffer, [0xff, 0xd8, 0xff]),
  },
  {
    contentType: 'image/webp',
    extensions: ['.webp'],
    matches: (buffer) =>
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

export interface ValidatedAttachmentFile {
  filename: string;
  contentType: string;
  size: number;
}

function extensionOf(filename: string): string {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

export function safeAttachmentFilename(originalName: string): string {
  const base = originalName.replace(/\\/g, '/').split('/').pop() ?? '';
  const extension = extensionOf(base);
  const stem = (extension ? base.slice(0, -extension.length) : base)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._ -]+/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .slice(0, 80);
  return `${stem || 'attachment'}${extension}`;
}

export function validateAttachmentFile(file: {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer?: Buffer;
}): ValidatedAttachmentFile {
  const buffer = file.buffer;
  const originalName = file.originalname?.trim() ?? '';
  if (!buffer || buffer.length === 0) {
    throw new BadRequestException('Choose a non-empty file to attach');
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new BadRequestException('Attachments must be 10 MB or smaller');
  }
  if (!originalName) {
    throw new BadRequestException('The attachment needs a filename');
  }

  const extension = extensionOf(originalName);
  const kind = FILE_KINDS.find((candidate) => candidate.extensions.includes(extension));
  if (!kind) {
    throw new BadRequestException('Attach a PDF, PNG, JPEG, or WebP file');
  }
  const declared = file.mimetype?.toLowerCase() === 'image/jpg'
    ? 'image/jpeg'
    : file.mimetype?.toLowerCase();
  if (declared !== kind.contentType) {
    throw new BadRequestException('The file type does not match its extension');
  }
  if (!kind.matches(buffer)) {
    throw new BadRequestException('The file contents do not match its declared type');
  }

  return {
    filename: safeAttachmentFilename(originalName),
    contentType: kind.contentType,
    size: buffer.length,
  };
}
