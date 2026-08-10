import { randomUUID } from 'node:crypto';
import { getStorageAdapter } from './adapters';
import { intakeQuery, withIntakeTransaction } from './db';
import { customerCanAccessRequest } from './repositories/customer-portal.repository';

type DeliverableRow = { id:string; request_id:string; quote_offer_id:string; original_filename:string; storage_object_key:string; content_type:string; size_bytes:string; status:'uploading'|'ready'; created_at:Date; completed_at:Date|null };

export async function signFinalDeliverable(input:{requestId:string;filename:string;contentType:string;sizeBytes:number;actorUserId:string}) {
  const row=await withIntakeTransaction(async query=>{
    const fulfillment=await query<{quote_offer_id:string;status:string}>(`SELECT quote_offer_id,status FROM public_intake_fulfillments WHERE request_id=$1 FOR UPDATE`,[input.requestId]);
    if(!fulfillment[0]||fulfillment[0].status!=='paid') throw new Error('final_delivery_not_allowed');
    const inserted=await query<DeliverableRow>(`INSERT INTO public_intake_final_deliverables(request_id,quote_offer_id,original_filename,storage_object_key,content_type,size_bytes,uploaded_by_actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[input.requestId,fulfillment[0].quote_offer_id,input.filename,`final-deliverables/${input.requestId}/${randomUUID()}`,input.contentType,input.sizeBytes,input.actorUserId]);
    return inserted[0];
  });
  const signed=await getStorageAdapter().createSignedUploadUrl(row.storage_object_key);
  return {finalDeliverableId:row.id,uploadUrl:signed.uploadUrl,storageObjectKey:row.storage_object_key};
}

export async function completeFinalDeliverable(input:{requestId:string;finalDeliverableId:string;storageObjectKey:string}) {
  const rows=await intakeQuery<DeliverableRow>(`SELECT * FROM public_intake_final_deliverables WHERE id=$1 AND request_id=$2 AND storage_object_key=$3`,[input.finalDeliverableId,input.requestId,input.storageObjectKey]);
  const row=rows[0];if(!row)throw new Error('final_delivery_not_found');
  const verified=await getStorageAdapter().verifyObjectExists(row.storage_object_key);
  if(!verified||verified.sizeBytes!==Number(row.size_bytes)||verified.contentType!==row.content_type)throw new Error('final_delivery_verification_failed');
  await intakeQuery(`UPDATE public_intake_final_deliverables SET status='ready',completed_at=now() WHERE id=$1`,[row.id]);
  return {status:'ready' as const};
}

export async function getFinalDeliverables(requestId:string,customerUserId?:string){
  if(customerUserId&&!(await customerCanAccessRequest(requestId,customerUserId)))return null;
  const rows=await intakeQuery<DeliverableRow>(`SELECT * FROM public_intake_final_deliverables WHERE request_id=$1 AND status='ready' ORDER BY created_at DESC`,[requestId]);
  return Promise.all(rows.map(async row=>({finalDeliverableId:row.id,filename:row.original_filename,contentType:row.content_type,sizeBytes:Number(row.size_bytes),createdAt:row.created_at.toISOString(),downloadUrl:await getStorageAdapter().createSignedDownloadUrl(row.storage_object_key,600)})));
}
