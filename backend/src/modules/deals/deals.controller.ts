import { z } from 'zod';
import { prisma } from '../../config/db';
import { route } from '../../lib/errors';
import { idSchema, text, numberField, dealStages, pagination, stageToStatus } from '../../lib/validation';
const dealInput = z.object({
  stage: z.enum(dealStages).optional(),
  amount: numberField,
  codesCount: z.number().int().nonnegative().max(1e9).nullable().optional(),
  lossReason: z.string().trim().max(500).optional(),
}).strict();
export const getDeals = route(async (req,res) => {
  const {skip,take}=pagination(req.query);
  const stage = req.query.stage ? z.enum(dealStages).parse(req.query.stage) : undefined;
  const where = {stage};
  const [deals,total,amount] = await prisma.$transaction([
    prisma.deal.findMany({where,skip,take,orderBy:[{updatedAt:'desc'},{id:'asc'}],include:{client:true}}), prisma.deal.count({where}), prisma.deal.aggregate({where,_sum:{amount:true}}),
  ]);
  res.json({deals,total,offset:skip,limit:take,amountTotal:amount._sum.amount || 0});
});
export const createDeal = route(async (req,res) => {
  const input = dealInput.extend({clientId:idSchema,title:text(300),services:z.array(text(200)).max(30).optional()}).parse(req.body);
  const deal = await prisma.$transaction(async tx => {
    const deal = await tx.deal.create({data:{...input,services:input.services ? JSON.stringify(input.services) : null},include:{client:true}});
    await tx.client.update({where:{id:deal.clientId},data:{status:stageToStatus[deal.stage]}});
    return deal;
  });
  res.status(201).json({deal});
});
export const updateDealStage = route(async (req,res) => {
  const id=idSchema.parse(req.params.id), data=dealInput.parse(req.body);
  const {lossReason, ...dealData} = data;
  const deal=await prisma.$transaction(async tx => {
    const deal=await tx.deal.update({where:{id},data:dealData});
    if (dealData.stage) {
      const clientUpdate: Record<string, unknown> = { status: stageToStatus[dealData.stage] };
      if (dealData.stage === 'CLOSED_LOST' && lossReason) {
        clientUpdate.aiObjections = lossReason;
        const currentClient = await tx.client.findUnique({ where: { id: deal.clientId }, select: { notes: true } });
        const existingNotes = currentClient?.notes ? `${currentClient.notes}\n` : '';
        clientUpdate.notes = `${existingNotes}[Причина отказа: ${lossReason}]`;
      }
      await tx.client.update({where:{id:deal.clientId},data:clientUpdate});
    }
    return tx.deal.findUniqueOrThrow({where:{id},include:{client:true}});
  });
  res.json({deal});
});
