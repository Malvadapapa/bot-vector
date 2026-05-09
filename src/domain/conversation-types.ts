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
