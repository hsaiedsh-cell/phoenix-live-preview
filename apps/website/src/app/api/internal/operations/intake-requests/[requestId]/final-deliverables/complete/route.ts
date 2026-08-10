import { NextResponse } from 'next/server';
import { z } from 'zod';
import { completeFinalDeliverable } from '@/lib/intake/final-deliverable.service';
import { getIntakeServiceRequestId,intakeServiceUnauthorizedResponse,isValidIntakeServiceRequest,readBoundedJsonBody,requireJsonContentType } from '@/lib/intake/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
const schema=z.object({finalDeliverableId:z.string().uuid(),storageObjectKey:z.string().min(1).max(500)}).strict();
export async function POST(request:Request,{params}:{params:Promise<{requestId:string}>}){const correlationId=getIntakeServiceRequestId(request);if(!isValidIntakeServiceRequest(request))return intakeServiceUnauthorizedResponse(correlationId);const requestId=z.string().uuid().safeParse((await params).requestId);const body=await readBoundedJsonBody(request);const parsed=body.ok?schema.safeParse(body.body):null;if(!requestId.success||!parsed?.success||!requireJsonContentType(request))return NextResponse.json({error:'Invalid final delivery completion.',requestId:correlationId},{status:400});try{return NextResponse.json({...await completeFinalDeliverable({requestId:requestId.data,...parsed.data}),requestId:correlationId});}catch{return NextResponse.json({error:'Final delivery could not be verified.',requestId:correlationId},{status:409});}}
