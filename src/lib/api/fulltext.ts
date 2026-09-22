import { supabase, PDF_BUCKET } from '../supabase';
import { must } from '../errors';
import type { FullTextFile } from '../types';
import { logActivity } from './projects';

export const MAX_PDF_BYTES = 50 * 1024 * 1024;

export async function listFiles(referenceId: string): Promise<FullTextFile[]> {
  return must(await supabase.from('full_text_files').select('*').eq('reference_id', referenceId)
    .order('uploaded_at', { ascending: false })) as FullTextFile[];
}

export async function uploadPdf(projectId: string, referenceId: string, file: File): Promise<FullTextFile> {
  if (file.type && file.type !== 'application/pdf') throw { code: '22023', message: 'Only PDF files can be uploaded.' };
  if (file.size > MAX_PDF_BYTES) throw { code: '22023', message: 'The PDF is larger than 50 MB.' };
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-120) || 'full-text.pdf';
  const path = `${projectId}/${referenceId}/${Date.now()}-${safe}`;
  const up = await supabase.storage.from(PDF_BUCKET).upload(path, file, { contentType: 'application/pdf', upsert: false });
  if (up.error) throw up.error;
  const row = await supabase.from('full_text_files').insert({
    project_id: projectId, reference_id: referenceId, storage_path: path, file_name: file.name,
    file_size: file.size, content_type: 'application/pdf',
  }).select('*').single();
  if (row.error) {
    await supabase.storage.from(PDF_BUCKET).remove([path]);
    throw row.error;
  }
  await supabase.from('study_references').update({ full_text_status: 'available' })
    .eq('id', referenceId).eq('full_text_status', 'not_available');
  await logActivity(projectId, 'full_text', `Uploaded PDF "${file.name}"`, undefined, referenceId);
  return row.data as FullTextFile;
}

export async function signedPdfUrl(f: FullTextFile): Promise<string> {
  const res = await supabase.storage.from(PDF_BUCKET).createSignedUrl(f.storage_path, 60 * 60);
  if (res.error) throw res.error;
  return res.data.signedUrl;
}

export async function deletePdf(f: FullTextFile): Promise<void> {
  const rm = await supabase.storage.from(PDF_BUCKET).remove([f.storage_path]);
  if (rm.error) throw rm.error;
  must(await supabase.from('full_text_files').delete().eq('id', f.id));
  await logActivity(f.project_id, 'full_text', `Deleted PDF "${f.file_name ?? ''}"`, undefined, f.reference_id);
}
