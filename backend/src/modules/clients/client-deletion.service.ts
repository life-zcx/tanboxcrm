import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { env } from '../../config/env';
import { imageFilename } from '../../lib/files';

export function screenshotReference(url: string): Prisma.ConversationChunkWhereInput {
  return { OR: [
    { screenshotUrl: url },
    { screenshotUrl: { startsWith: url + ',' } },
    { screenshotUrl: { endsWith: ',' + url } },
    { screenshotUrl: { contains: ',' + url + ',' } },
  ] };
}

// The durable queue is committed with the cascade deletion. A filesystem failure
// must not orphan a private screenshot or turn a partial deletion into a success.
export async function flushFileDeletions(filenames?: string[], limit = 50) {
  const jobs = await prisma.fileDeletion.findMany({
    where: filenames ? { filename: { in: filenames } } : { nextAttemptAt: { lte: new Date() } },
    take: limit,
    orderBy: [{ nextAttemptAt: 'asc' }, { filename: 'asc' }],
  });
  for (const job of jobs) {
    const url = '/uploads/' + job.filename;
    try {
      if (imageFilename(url) !== job.filename) throw Object.assign(new Error('Invalid filename'), { code: 'INVALID_PATH' });
      // Older data may share a screenshot. Keep files still owned by another card.
      const reference = await prisma.conversationChunk.findFirst({ where: screenshotReference(url), select: { id: true } });
      if (!reference) {
        try { await fs.unlink(path.join(env.UPLOADS_DIR, job.filename)); }
        catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      }
      await prisma.fileDeletion.deleteMany({ where: { filename: job.filename } });
    } catch (error: any) {
      const attempts = job.attempts + 1;
      await prisma.fileDeletion.updateMany({
        where: { filename: job.filename },
        data: {
          attempts,
          errorCode: typeof error?.code === 'string' ? error.code.slice(0, 50) : 'CLEANUP_FAILED',
          nextAttemptAt: new Date(Date.now() + Math.min(3600_000, 30_000 * 2 ** Math.min(attempts - 1, 7))),
        },
      });
    }
  }
}

export async function deleteClientCompletely(id: string) {
  const result = await prisma.$transaction(async tx => {
    const client = await tx.client.findUnique({ where: { id }, include: { _count: { select: { conversations: true, deals: true, aiSuggestions: true } } } });
    if (!client) {
      const jobs=await tx.fileDeletion.findMany({where:{clientId:id},select:{filename:true}});
      return { alreadyDeleted: true, filenames: jobs.map(j=>j.filename), deleted: { conversations: 0, deals: 0, aiSuggestions: 0, messages: 0 } };
    }
    const [chunks, messages] = await Promise.all([
      tx.conversationChunk.findMany({ where: { clientId: id }, select: { screenshotUrl: true } }),
      tx.message.count({ where: { chunk: { clientId: id } } }),
    ]);
    const filenames = [...new Set(chunks.flatMap(c => (c.screenshotUrl || '').split(',').map(u => imageFilename(u.trim())).filter((v): v is string => !!v)))];
    await tx.client.delete({ where: { id } });
    for(let index=0;index<filenames.length;index+=500)await tx.fileDeletion.createMany({ data: filenames.slice(index,index+500).map(filename => ({ filename,clientId:id })), skipDuplicates: true });
    return { alreadyDeleted: false, filenames, deleted: { ...client._count, messages } };
  },{maxWait:10000,timeout:15000});
  if (result.filenames.length) await flushFileDeletions(result.filenames, Math.min(50, result.filenames.length));
  const cleanupPending = result.filenames.length ? await prisma.fileDeletion.count({ where: { filename: { in: result.filenames } } }) : 0;
  return { success: true, alreadyDeleted: result.alreadyDeleted, deleted: result.deleted, cleanupPending };
}
