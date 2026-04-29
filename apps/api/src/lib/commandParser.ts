export type Intent =
  | 'TODAY'
  | 'DONE'
  | 'POSTPONE'
  | 'WEEK'
  | 'EMAIL'
  | 'MORE_PROACTIVE'
  | 'LESS_PROACTIVE'
  | 'RESET_PREFS'
  | 'CONFIRM'
  | 'CANCEL'
  | 'ALIAS_SHORTCUT'
  | 'LIST_CONTACTS'
  | 'LIST_TASKS'
  | 'DELETE_CONTACT'
  | 'LIST_COMMANDS'
  | 'DESCRIBE_COMMAND'
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
    commandName?: string;
  };
}

export const COMMAND_REGISTRY = [
  { name: '/hoje', desc: 'Resumo do dia com tarefas urgentes e atrasadas' },
  { name: '/tarefas', desc: 'Lista todas as tarefas abertas' },
  { name: '/semana', desc: 'Relatório semanal de produtividade' },
  { name: '/email', desc: 'Lê e-mails não lidos importantes' },
  { name: '/contatos', desc: 'Lista todos os contatos cadastrados' },
  { name: '/adiar', desc: 'Adia uma tarefa para outra data', usage: '/adiar <id> <data>' },
  { name: '/done', desc: 'Marca uma tarefa como concluída', usage: '/done <id>' },
  { name: '/mais-proativo', desc: 'Aumenta a proatividade do Elvis' },
  { name: '/menos-proativo', desc: 'Diminui a proatividade do Elvis' },
  { name: '/corrigir', desc: 'Reseta suas preferências aprendidas' },
  { name: '/confirmar', desc: 'Confirma uma ação pendente', usage: '/confirmar <id>' },
  { name: '/cancelar', desc: 'Cancela uma ação pendente', usage: '/cancelar <id>' },
  { name: '/comandos', desc: 'Lista todos os comandos disponíveis' },
];

export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim();

  // /comandos
  if (/^\/comandos$/i.test(trimmed)) {
    return { intent: 'LIST_COMMANDS' };
  }

  // /<cmd> desc - AC3: Priority over ALIAS_SHORTCUT for known commands.
  // Refined per PR feedback to check existence in COMMAND_REGISTRY.
  const descMatch = /^(\/\S+)\s+desc$/i.exec(trimmed);
  if (descMatch) {
    const commandName = descMatch[1].toLowerCase();
    if (COMMAND_REGISTRY.some((c) => c.name === commandName)) {
      return {
        intent: 'DESCRIBE_COMMAND',
        args: { commandName },
      };
    }
  }

  // /contatos
  if (/^\/contatos$/i.test(trimmed)) {
    return { intent: 'LIST_CONTACTS' };
  }

  // /tarefas
  if (/^\/tarefas$/i.test(trimmed)) {
    return { intent: 'LIST_TASKS' };
  }

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

  // /alias <mensagem> — atalho de contato (ex: /linic olá)
  const aliasMatch = /^(\/\S+)\s+(.+)$/i.exec(trimmed);
  if (aliasMatch) {
    return {
      intent: 'ALIAS_SHORTCUT',
      args: { alias: aliasMatch[1].trim(), message: aliasMatch[2].trim() },
    };
  }

  // Anything else is UNKNOWN
  return {
    intent: 'UNKNOWN',
    args: { rawText: trimmed },
  };
}
