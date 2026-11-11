import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { route, AppError } from '../../lib/errors';
import { clientInput, clientStatuses, categories, idSchema, pagination, statusToStage } from '../../lib/validation';
import { deleteClientCompletely } from './client-deletion.service';
export const getClients = route(async (req, res) => {
  const { skip, take } = pagination(req.query);
  const where: Prisma.ClientWhereInput = {};
  if (req.query.status && req.query.status !== 'ALL') where.status = z.enum(clientStatuses).parse(req.query.status);
  if (req.query.category && req.query.category !== 'ALL') where.category = z.enum(categories).parse(req.query.category);
  if (req.query.search) {
    const search = z.string().max(200).parse(req.query.search);
    where.OR = ['name','phone','company','binIin'].map(field => ({ [field]: { contains: search, mode: 'insensitive' } }));
  }
  const [clients, total] = await prisma.$transaction([
    prisma.client.findMany({ where, skip, take, orderBy: req.query.sort === 'oldest' ? [{createdAt:'asc'},{id:'asc'}] : [{lastContactAt:'desc'},{id:'asc'}], include: { _count: { select: { conversations: true, deals: true, aiSuggestions: true } } } }),
    prisma.client.count({ where }),
  ]);
  res.json({ clients, total, offset: skip, limit: take });
});
export const getClientById = route(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const client = await prisma.client.findUnique({ where: { id }, include: {
    conversations: { orderBy: [{createdAt:'desc'},{id:'asc'}], take: 20, include: { messages: { orderBy: [{position:'desc'},{id:'desc'}], take: 100 }, _count: {select:{messages:true}} } },
    deals: { orderBy: {createdAt:'desc'}, take: 50 }, aiSuggestions: { orderBy:{createdAt:'desc'}, take:10 },
    _count: { select: { conversations: true } },
  } });
  if (!client) throw new AppError(404, 'Клиент не найден');
  client.conversations.forEach(c => c.messages.reverse());
  res.json({ client });
});
export const createClient = route(async (req, res) => {
  const data = clientInput.extend({ name: z.string().trim().min(1).max(200) }).parse(req.body);
  const client = await prisma.$transaction(async tx => {
    const client = await tx.client.create({ data: { ...data, status: data.status || 'LEAD' } });
    await tx.deal.create({ data: { clientId: client.id, title: 'Заказ: ' + client.name, stage: statusToStage[client.status], amount: client.estimatedAmount, codesCount: client.estimatedVolume } });
    return client;
  });
  res.status(201).json({ client });
});
export const updateClient = route(async (req, res) => {
  const id = idSchema.parse(req.params.id), data = clientInput.parse(req.body);
  if (!Object.keys(data).length) throw new AppError(400, 'Нет полей для изменения');
  const client = await prisma.$transaction(async tx => {
    const client = await tx.client.update({ where: {id}, data });
    // A client-level status is an explicit update of its current order.
    if (data.status) {
      const deal = await tx.deal.findFirst({ where:{clientId:id}, orderBy:{updatedAt:'desc'} });
      if (deal) await tx.deal.update({ where:{id:deal.id}, data:{stage:statusToStage[data.status]} });
    }
    return client;
  });
  res.json({ client });
});
export const deleteClient = route(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const result = await deleteClientCompletely(id);
  res.status(result.cleanupPending ? 202 : 200).json(result);
});
export const getStatsSummary = route(async (_req,res) => {
  const [totalClients,totalConversations,totalAiSuggestions,groups] = await prisma.$transaction([
    prisma.client.count(), prisma.conversationChunk.count(), prisma.aISuggestion.count(), prisma.client.groupBy({by:['status'],orderBy:{status:'asc'},_count:true}),
  ]);
  res.json({totalClients,totalConversations,totalAiSuggestions,funnel:Object.fromEntries(groups.map(g=>[g.status,g._count]))});
});
