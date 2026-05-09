export type IntentType = 'command' | 'create_reminder' | 'ai_query';

export interface ParsedMessage {
  intent: IntentType;
  normalized_text: string;
  keywords: string[];
  probable_date: Date | null;
  confidence: number;
  requires_clarification: boolean;
  clarification_reason: string | null;
}
