// Mirrors backend/app/schemas/*.py exactly.
export type Uuid = string;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface MessageResponse {
  message: string;
}

// ---- auth ----
export interface User {
  id: Uuid;
  email: string;
  display_name: string;
  created_at: string;
}
export interface AuthOut {
  user: User;
  access_token: string;
  token_type: string;
  expires_at: string;
}

// ---- documents ----
export type DocStatus = "queued" | "processing" | "ready" | "failed";
export interface DocumentOut {
  id: Uuid;
  title: string;
  original_filename: string;
  file_ext: string;
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  chunk_count: number;
  status: DocStatus;
  progress: number;
  stage: string;
  error_message: string | null;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
  collection_ids: Uuid[];
}
export interface UploadItem {
  filename: string;
  status: "created" | "duplicate" | "rejected";
  document: DocumentOut | null;
  existing_document_id: Uuid | null;
  error: string | null;
  error_code: string | null;
}
export interface UploadResponse {
  items: UploadItem[];
}
export interface ChunkOut {
  id: Uuid;
  chunk_index: number;
  text: string;
  page_number: number | null;
  section: string | null;
  token_count: number;
}
export interface JobOut {
  id: Uuid;
  document_id: Uuid;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  max_attempts: number;
  progress: number;
  stage: string;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  document_title?: string | null;
}
export interface CollectionOut {
  id: Uuid;
  name: string;
  description: string;
  document_count: number;
  created_at: string;
}

// ---- chat ----
export type Mode = "qa" | "research" | "synthesis";
export interface SourceOut {
  id: Uuid | null;
  label: string;
  chunk_id: Uuid | null;
  document_id: Uuid | null;
  document_title: string;
  page_number: number | null;
  section: string | null;
  chunk_index: number | null;
  excerpt: string;
  chunk_text: string;
  score: number;
  vector_score: number;
  keyword_score: number;
  cited: boolean;
}
export interface RetrievalMeta {
  insufficient_evidence?: boolean;
  citation_check?: "ok" | "no_citations";
  retrieved?: number;
  candidates?: number;
  top_k?: number;
  score_threshold?: number;
  retrieval_ms?: number;
  generation_ms?: number;
  invalid_citations_removed?: string[];
  [k: string]: unknown;
}
export interface MessageOut {
  id: Uuid;
  conversation_id: Uuid;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "stopped" | "error" | string;
  mode: string;
  provider: string | null;
  model: string | null;
  error: string | null;
  retrieval_meta: RetrievalMeta;
  created_at: string;
  citations: SourceOut[];
}
export interface ConversationOut {
  id: Uuid;
  title: string;
  collection_id: Uuid | null;
  document_ids: Uuid[];
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_preview: string;
}
export interface ConversationDetail extends ConversationOut {
  messages: MessageOut[];
}
export interface ChatRequest {
  question: string;
  conversation_id?: Uuid | null;
  document_ids: Uuid[];
  collection_id?: Uuid | null;
  mode: Mode;
}
export interface FollowUps {
  suggestions: string[];
}
export interface SearchRequest {
  query: string;
  document_ids: Uuid[];
  collection_id?: Uuid | null;
  top_k?: number | null;
  score_threshold?: number | null;
}
export interface SearchResponse {
  query: string;
  results: SourceOut[];
  candidates: number;
  latency_ms: number;
}
export type TaskName = "summarize" | "questions" | "findings" | "compare";
export interface TaskRequest {
  document_ids: Uuid[];
  focus?: string | null;
  length: "short" | "medium" | "detailed";
  count: number;
}
export interface TaskResponse {
  task: string;
  content: string;
  citations: SourceOut[];
  provider: string;
  model: string;
  insufficient_evidence: boolean;
}
export interface NoteOut {
  id: Uuid;
  title: string;
  content: string;
  source_message_id: Uuid | null;
  citations: Array<{ label: string; document_id: Uuid | null; document_title: string; page_number: number | null; excerpt: string }>;
  tags: string[];
  created_at: string;
  updated_at: string;
}
export interface NoteIn {
  title: string;
  content: string;
  source_message_id?: Uuid | null;
  tags: string[];
}

// ---- settings / meta ----
export interface ProviderInfo {
  id: "groq" | "ollama" | "mock";
  label: string;
  configured: boolean;
}
export interface SettingsOut {
  theme: "light" | "dark" | "system";
  llm_provider: string;
  llm_model: string;
  top_k: number;
  score_threshold: number;
  context_token_budget: number;
  hybrid_search: boolean;
  embedding_provider: string;
  embedding_model: string;
  embedding_dim: number;
  chunk_size_tokens: number;
  chunk_overlap_tokens: number;
  providers: ProviderInfo[];
  overrides: Record<string, boolean>;
}
export interface SettingsUpdate {
  theme?: "light" | "dark" | "system";
  llm_provider?: "groq" | "ollama" | "mock" | null;
  llm_model?: string | null;
  top_k?: number | null;
  score_threshold?: number | null;
  context_token_budget?: number | null;
  hybrid_search?: boolean | null;
  reset?: string[];
}
export interface ProviderTestOut {
  ok: boolean;
  provider: string;
  model: string;
  detail: string;
  latency_ms: number;
}
export interface Dashboard {
  documents: { total: number; ready: number; processing: number; failed: number };
  conversations: number;
  questions_asked: number;
  notes: number;
  collections: number;
  storage_bytes: number;
  popular_documents: Array<{ id: Uuid; title: string; access_count: number }>;
  queries_last_14_days: Array<{ date: string; count: number }>;
  queries_by_kind: Record<string, number>;
  avg_query_latency_ms: number | null;
  recent_activity: Array<{ type: "document" | "conversation"; id: Uuid; title: string; detail: string; at: string }>;
}
export interface Readiness {
  status: "ready" | "degraded";
  version: string;
  checks: Record<string, Record<string, unknown>>;
}

// ---- SSE events ----
export type ChatEvent =
  | { type: "meta"; conversation_id: Uuid; user_message_id: Uuid }
  | { type: "sources"; sources: SourceOut[] }
  | { type: "token"; text: string }
  | { type: "done"; message: MessageOut }
  | { type: "error"; code: string; message: string; message_id?: Uuid };
