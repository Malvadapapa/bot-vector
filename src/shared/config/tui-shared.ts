import { TerminalTui } from '../../interfaces/tui/terminal-tui.js';

export let terminalTuiInstance: TerminalTui | undefined;

export function setTerminalTui(instance: TerminalTui | undefined) {
  terminalTuiInstance = instance;
}

export function logTuiChatMessage(sender: string, text: string, type: 'user' | 'bot', contextLabel?: string, recipientInfo?: string) {
  terminalTuiInstance?.appendChatMessage(sender, text, type, contextLabel, recipientInfo);
}

export function logTuiProcessTrace(trace: string) {
  terminalTuiInstance?.appendProcessTrace(trace);
}
