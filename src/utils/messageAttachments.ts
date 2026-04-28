export interface MessageAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
  publicId?: string;
  resourceType?: 'image' | 'file';
}

const parseMaybeJson = (value: string): any => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const toAttachment = (item: any): MessageAttachment | null => {
  if (!item) return null;

  const parsed = typeof item === 'string' ? parseMaybeJson(item) : item;
  const candidate = parsed && typeof parsed === 'object' ? parsed : null;

  if (!candidate?.url || typeof candidate.url !== 'string') {
    return null;
  }

  return {
    url: candidate.url,
    name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name : 'file',
    type: typeof candidate.type === 'string' && candidate.type.trim() ? candidate.type : 'application/octet-stream',
    size: typeof candidate.size === 'number' ? candidate.size : Number(candidate.size) || 0,
    ...(typeof candidate.publicId === 'string' ? { publicId: candidate.publicId } : {}),
    ...(candidate.resourceType === 'image' || candidate.resourceType === 'file' ? { resourceType: candidate.resourceType } : {}),
  };
};

export const normalizeMessageAttachments = (value: unknown): MessageAttachment[] => {
  if (!Array.isArray(value)) return [];
  return value.map(toAttachment).filter((a): a is MessageAttachment => Boolean(a));
};
