export interface PendingConfirmation {
  id?: number;
  user_id: string;
  state: string;
  intent: string;
  pending_payload_json: string;
  expires_at: Date;
}

export type ConversationActionType =
  | 'none'
  | 'ask_date_clarification'
  | 'ask_confirmation'
  | 'saved'
  | 'cancelled';

export interface ConversationAction {
  action_type: ConversationActionType;
  response_text: string | null;
}
