export interface Client {
  id: string;
  name: string;
  phone?: string | null;
  company?: string | null;
  binIin?: string | null;
  category?: string | null;
  status: string; // LEAD, IN_NEGOTIATION, KP_SENT, PAYMENT_PENDING, IN_PROGRESS, WON, LOST
  stage: string;
  estimatedVolume?: number | null;
  estimatedAmount?: number | null;
  aiSummary?: string | null;
  aiSentiment?: string | null;
  aiObjections?: string | null;
  aiNextStep?: string | null;
  notes?: string | null;
  lastContactAt: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    conversations: number;
    deals: number;
    aiSuggestions: number;
  };
  conversations?: ConversationChunk[];
  deals?: Deal[];
  aiSuggestions?: AISuggestion[];
}

export interface Message {
  id: string;
  sender: 'CLIENT' | 'MANAGER' | 'SYSTEM';
  senderName?: string | null;
  content: string;
  timestamp?: string | null;
  createdAt: string;
  position: number;
  originalTime?: string | null;
}

export interface ConversationChunk {
  id: string;
  clientId: string;
  channel: string;
  rawText?: string | null;
  screenshotUrl?: string | null;
  summary?: string | null;
  extractedInfo?: string | null;
  source: string;
  createdAt: string;
  messages: Message[];
  _count?: { messages: number };
}

export interface AISuggestion {
  id: string;
  clientId: string;
  provider: string;
  promptType: string;
  query?: string | null;
  suggestedText: string;
  explanation?: string | null;
  knowledgeEvidence?: any;
  commercialEvidence?: any;
  createdAt: string;
}

export interface Deal {
  id: string;
  clientId: string;
  client?: Client;
  title: string;
  stage: string;
  amount?: number | null;
  codesCount?: number | null;
  services?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AIStatus {
  providers: {
    gemini: { configured: boolean; model: string; role: string; state: string; retryAt?: string | null };
    openai: { configured: boolean; model: string; role: string };
  };
  telegramBot: { configured: boolean; running: boolean; state: string; name: string };
  knowledgeBase: { tariffsLoaded: boolean; categoriesCount: number; jurisdiction: string };
}

export interface AdminUser {
  id: string;
  telegramChatId: string;
  telegramUsername?: string | null;
  role: string;
  lastLoginAt?: string;
}

export { api, ApiError } from './api-client';

