export type Intent =
  | 'CREATE_TASK'
  | 'TODAY'
  | 'DONE'
  | 'POSTPONE'
  | 'WEEK'
  | 'EMAIL'
  | 'MORE_PROACTIVE'
  | 'LESS_PROACTIVE'
  | 'RESET_PREFS'
  | 'SEND_TO'
  | 'CONFIRM'
  | 'CANCEL'
  | 'ALIAS_SHORTCUT'
  | 'UNKNOWN';

export interface ParsedCommand {
  intent: Intent;
  args?: {
    rawText?: string;
    taskId?: string;
    to?: string;
    contactName?: string;
    message?: string;
    communication_id?: string;
    alias?: string;
  };
}

export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim();

  // /hoje
  if (/^\/hoje$/i.test(trimmed)) {
    return { intent: 'TODAY' };
  }

  // /done <id>
  const doneMatch = /^\/done\s+(.+)$/i.exec(trimmed);
  if (doneMatch) {
    return {
      intent: 'DONE',
      args: { taskId: doneMatch[1].trim() },
    };
  }

  // /adiar <id> <to>
  const postponeMatch = /^\/adiar\s+(\S+)\s+(.+)$/i.exec(trimmed);
  if (postponeMatch) {
    return {
      intent: 'POSTPONE',
      args: {
        taskId: postponeMatch[1].trim(),
        to: postponeMatch[2].trim(),
      },
    };
  }

  // /semana
  if (/^\/semana$/i.test(trimmed)) {
    return { intent: 'WEEK' };
  }

  // /email
  if (/^\/email$/i.test(trimmed)) {
    return { intent: 'EMAIL' };
  }

  // /mais-proativo
  if (/^\/mais-proativo$/i.test(trimmed)) {
    return { intent: 'MORE_PROACTIVE' };
  }

  // /menos-proativo
  if (/^\/menos-proativo$/i.test(trimmed)) {
    return { intent: 'LESS_PROACTIVE' };
  }

  // /corrigir
  if (/^\/corrigir$/i.test(trimmed)) {
    return { intent: 'RESET_PREFS' };
  }

  // 1 ou /confirmar <id>
  if (/^1$/.test(trimmed) || /^\/confirmar$/i.test(trimmed)) {
    return { intent: 'CONFIRM', args: {} };
  }
  const confirmMatch = /^\/confirmar\s+(.+)$/i.exec(trimmed);
  if (confirmMatch) {
    return {
      intent: 'CONFIRM',
      args: { communication_id: confirmMatch[1].trim() },
    };
  }

  // 2 ou /cancelar <id>
  if (/^2$/.test(trimmed) || /^\/cancelar$/i.test(trimmed)) {
    return { intent: 'CANCEL', args: {} };
  }
  const cancelMatch = /^\/cancelar\s+(.+)$/i.exec(trimmed);
  if (cancelMatch) {
    return {
      intent: 'CANCEL',
      args: { communication_id: cancelMatch[1].trim() },
    };
  }

  // Linguagem natural de áudio: "manda <msg> pra/para/pro <nome>[.]"
  // ex: "Manda um oi pra Amanda." / "manda um abraço para João"
  const sendToNaturalMatch = /^manda(?:r)?\s+(.+?)\s+(?:pra|para|pro)\s+([^\s,.:]+)[.,]?$/i.exec(trimmed);
  if (sendToNaturalMatch) {
    return {
      intent: 'SEND_TO',
      args: {
        contactName: sendToNaturalMatch[2].trim(),
        message: sendToNaturalMatch[1].trim(),
      },
    };
  }

  // manda para <nome>: <msg> | fala com <nome> que <msg> | avisa <nome>: <msg>
  const sendToMatch = /^(?:manda(?:r)? (?:para|pro|pra)|fala com|avisa) (.+?)(?::|,| que | dizendo ) (.+)$/i.exec(trimmed);
  if (sendToMatch) {
    return {
      intent: 'SEND_TO',
      args: {
        contactName: sendToMatch[1].trim(),
        message: sendToMatch[2].trim(),
      },
    };
  }

  // /alias <mensagem> — atalho de contato (ex: /linic olá)
  const aliasMatch = /^(\/\S+)\s+(.+)$/i.exec(trimmed);
  if (aliasMatch) {
    return {
      intent: 'ALIAS_SHORTCUT',
      args: { alias: aliasMatch[1].trim(), message: aliasMatch[2].trim() },
    };
  }

  // Anything else is CREATE_TASK
  return {
    intent: 'CREATE_TASK',
    args: { rawText: trimmed },
  };
}
