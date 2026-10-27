// Types for format.mjs (plain JavaScript shared by the Edge Function, the local test stack and the app).
export interface ApiField { id: string; label: string; type: string; options: string[]; settings?: { rows?: string[] } | null }
export interface ApiResponse { id: string; submitted_at: string; answers: Record<string, unknown> }
export function questionKeys(fields: ApiField[]): { key: string; field: ApiField }[];
export function tableRows(fields: ApiField[], responses: ApiResponse[]): string[][];
export function toCsv(rows: unknown[][]): string;
export function toJson(form: { id: string; title: string }, fields: ApiField[], responses: ApiResponse[]): {
  form: { id: string; title: string };
  generated_at: string;
  questions: { key: string; id: string; label: string; type: string; options: string[]; rows?: string[] }[];
  responses: { number: number; id: string; submitted_at: string; answers: Record<string, unknown> }[];
};
export function webhookPayload(form: { id: string; title: string }, fields: ApiField[], response: ApiResponse, number: number): Record<string, unknown>;
export function checkWebhookUrl(raw: string, allowLocal?: boolean): string | null;
export function sha256Hex(text: string): Promise<string>;
export function hmacHex(secret: string, body: string): Promise<string>;
