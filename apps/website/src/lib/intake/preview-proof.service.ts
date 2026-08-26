import { randomUUID } from 'node:crypto';
import { getStorageAdapter } from './adapters';
import { intakeQuery, withIntakeTransaction } from './db';
import { customerCanAccessRequest } from './repositories/customer-portal.repository';

type ProofRow = { id:string; request_id:string; quote_offer_id:string; version:number; original_filename:string; storage_object_key:string; content_type:string; size_bytes:string; status:'uploading'|'ready'|'superseded'; created_at:Date; completed_at:Date|null };
type DecisionRow = { id:string; preview_proof_id:string; decision:'approved'|'revision_requested'; reason:string|null; created_at:Date };

export async function signPreviewProof(input:{requestId:string;filename:string;contentType:string;sizeBytes:number;actorUserId:string}) {
  const rows = await withIntakeTransaction(async query => {
    const fulfillment = await query<{quote_offer_id:string;status:string}>(`SELECT quote_offer_id,status FROM public_intake_fulfillments WHERE request_id=$1 FOR UPDATE`,[input.requestId]);
    if (!fulfillment[0] || !['in_progress','preview_ready'].includes(fulfillment[0].status)) throw new Error('preview_not_allowed');
    const inserted = await query<ProofRow>(`INSERT INTO public_intake_preview_proofs(request_id,quote_offer_id,version,original_filename,storage_object_key,content_type,size_bytes,uploaded_by_actor_user_id)
      SELECT $1,$2,COALESCE(MAX(version),0)+1,$3,$4,$5,$6,$7 FROM public_intake_preview_proofs WHERE request_id=$1 RETURNING *`,[input.requestId,fulfillment[0].quote_offer_id,input.filename,`previews/${input.requestId}/${randomUUID()}`,input.contentType,input.sizeBytes,input.actorUserId]);
    return inserted[0];
  });
  const signed=await getStorageAdapter().createSignedUploadUrl(rows.storage_object_key);
  return {previewProofId:rows.id,uploadUrl:signed.uploadUrl,storageObjectKey:rows.storage_object_key};
}

export async function completePreviewProof(input:{requestId:string;previewProofId:string;storageObjectKey:string}) {
  const rows=await intakeQuery<ProofRow>(`SELECT * FROM public_intake_preview_proofs WHERE id=$1 AND request_id=$2 AND storage_object_key=$3`,[input.previewProofId,input.requestId,input.storageObjectKey]);
  const row=rows[0]; if(!row) throw new Error('preview_not_found');
  const verified=await getStorageAdapter().verifyObjectExists(row.storage_object_key);
  if(!verified || verified.sizeBytes!==Number(row.size_bytes) || verified.contentType!==row.content_type) throw new Error('preview_verification_failed');
  await withIntakeTransaction(async query=>{
    await query(`UPDATE public_intake_preview_proofs SET status='superseded' WHERE request_id=$1 AND status='ready'`,[input.requestId]);
    await query(`UPDATE public_intake_preview_proofs SET status='ready',completed_at=now() WHERE id=$1`,[row.id]);
  });
  return {status:'ready' as const};
}

export async function getPreviewProofs(requestId:string, customerUserId?:string) {
  if(customerUserId && !(await customerCanAccessRequest(requestId,customerUserId))) return null;
  const [proofs,decisions]=await Promise.all([
    intakeQuery<ProofRow>(`SELECT * FROM public_intake_preview_proofs WHERE request_id=$1 AND status IN ('ready','superseded') ORDER BY version DESC`,[requestId]),
    intakeQuery<DecisionRow>(`SELECT * FROM public_intake_preview_decisions WHERE request_id=$1 ORDER BY created_at ASC`,[requestId]),
  ]);
  return {proofs:await Promise.all(proofs.map(async p=>({previewProofId:p.id,version:p.version,filename:p.original_filename,contentType:p.content_type,sizeBytes:Number(p.size_bytes),status:p.status,createdAt:p.created_at.toISOString(),...(customerUserId ? {} : {downloadUrl:await getStorageAdapter().createSignedDownloadUrl(p.storage_object_key,600)})}))),decisions:decisions.map(d=>({decisionId:d.id,previewProofId:d.preview_proof_id,decision:d.decision,reason:d.reason,createdAt:d.created_at.toISOString()}))};
}

export async function getPreviewProofDownload(requestId:string,previewProofId:string,customerUserId:string) {
  if (!(await customerCanAccessRequest(requestId,customerUserId))) return null;
  const rows=await intakeQuery<ProofRow>(`SELECT * FROM public_intake_preview_proofs WHERE id=$1 AND request_id=$2 AND status IN ('ready','superseded') LIMIT 1`,[previewProofId,requestId]);
  const row=rows[0];
  if(!row) return null;
  const ttlSeconds=600;
  return {downloadUrl:await getStorageAdapter().createSignedDownloadUrl(row.storage_object_key,ttlSeconds),expiresAt:new Date(Date.now()+ttlSeconds*1000).toISOString()};
}

export async function decidePreview(input:{requestId:string;previewProofId:string;customerUserId:string;decision:'approved'|'revision_requested';reason?:string}) {
  if(!(await customerCanAccessRequest(input.requestId,input.customerUserId))) throw new Error('preview_access_denied');
  return withIntakeTransaction(async query=>{
    const proof=await query<ProofRow>(`SELECT * FROM public_intake_preview_proofs WHERE id=$1 AND request_id=$2 AND status='ready' FOR UPDATE`,[input.previewProofId,input.requestId]);
    if(!proof[0]) throw new Error('preview_not_found');
    const rows=await query<DecisionRow>(`INSERT INTO public_intake_preview_decisions(preview_proof_id,request_id,customer_user_id,decision,reason) VALUES($1,$2,$3,$4,$5) RETURNING *`,[input.previewProofId,input.requestId,input.customerUserId,input.decision,input.reason??null]);
    return {decisionId:rows[0].id,decision:rows[0].decision,createdAt:rows[0].created_at.toISOString()};
  });
}
