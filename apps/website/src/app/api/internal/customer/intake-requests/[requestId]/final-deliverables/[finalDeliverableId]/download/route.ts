import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getFinalDeliverableDownload } from '@/lib/intake/final-deliverable.service';
import { getIntakeServiceActorUserId,getIntakeServiceRequestId,intakeServiceUnauthorizedResponse,isValidIntakeServiceRequest,reportInternalError } from '@/lib/intake/http';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const idSchema=z.string().uuid();

export async function GET(request:Request,{params}:{params:Promise<{requestId:string;finalDeliverableId:string}>}){
  const correlationId=getIntakeServiceRequestId(request);
  if(!isValidIntakeServiceRequest(request))return intakeServiceUnauthorizedResponse(correlationId);
  const actorUserId=getIntakeServiceActorUserId(request);
  const values=await params;
  const requestId=idSchema.safeParse(values.requestId);
  const finalDeliverableId=idSchema.safeParse(values.finalDeliverableId);
  if(!actorUserId||!requestId.success||!finalDeliverableId.success)return NextResponse.json({error:'File not found.',requestId:correlationId},{status:404});
  try{
    const result=await getFinalDeliverableDownload(requestId.data,finalDeliverableId.data,actorUserId);
    if(!result)return NextResponse.json({error:'File not found.',requestId:correlationId},{status:404});
    return NextResponse.json({...result,requestId:correlationId},{headers:{'Cache-Control':'no-store, private'}});
  }catch(error){
    reportInternalError(error,{requestId:correlationId,route:'GET customer final-deliverable download',errorCategory:'upload_signing',statusCode:500});
    return NextResponse.json({error:'Something went wrong.',requestId:correlationId},{status:500});
  }
}
